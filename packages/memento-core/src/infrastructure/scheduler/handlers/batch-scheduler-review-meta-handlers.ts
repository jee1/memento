import type Database from 'better-sqlite3';
import { MetaMemoryIntrospectionService } from '../../../domains/memory/services/meta-memory-introspection-service.js';
import { selectMemoryReviewCandidates } from '../../../domains/memory/services/memory-review-candidate-selection-service.js';
import { upsertPendingMemoryReviewCandidates } from '../../../domains/memory/services/memory-review-candidate-persistence-service.js';
import { recordMemoryReviewQueueHealthSnapshot } from '../../../domains/memory/services/memory-review-queue-health-service.js';
import { resolveValidatedNumber } from '../../../shared/config/environment.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import type { BatchJobResult } from '../batch-scheduler-types.js';
import {
  assertSchedulerDbOpen,
  createEmptyBatchJobResult,
  finalizeBatchJobTiming
} from '../batch-scheduler-internal-helpers.js';
import type { BatchSchedulerRunContext } from './batch-scheduler-run-context.js';

export function buildMemoryReviewCandidateUpsertInputs(db: Database.Database): {
  inputs: Array<{
    memory_id: string;
    priority: number;
    reason: string;
    due_at: string;
    metadata_json: string;
  }>;
  nowIso: string;
  selectedCount: number;
} {
  const items = selectMemoryReviewCandidates(db);
  const dueDays = resolveValidatedNumber(
    'MEMORY_REVIEW_CANDIDATE_DUE_DAYS',
    14,
    n => n >= 1 && n <= 366,
    '1-366'
  );
  const nowIso = new Date().toISOString();
  const dueAt = new Date(Date.now() + dueDays * 86_400_000).toISOString();
  const inputs = items.map(i => ({
    memory_id: i.memory_id,
    priority: i.priority,
    reason: i.reason,
    due_at: dueAt,
    metadata_json: JSON.stringify({ score_breakdown: i.score_breakdown })
  }));
  return { inputs, nowIso, selectedCount: items.length };
}

export async function runMemoryReviewCandidatesJob(ctx: BatchSchedulerRunContext): Promise<BatchJobResult> {
  const result = createEmptyBatchJobResult('memory_review_candidates');

  try {
    assertSchedulerDbOpen(ctx.db);

    const { inputs, nowIso, selectedCount } = buildMemoryReviewCandidateUpsertInputs(ctx.db!);
    const upsert = upsertPendingMemoryReviewCandidates(ctx.db!, inputs, nowIso);
    result.success = true;
    result.processed = inputs.length;
    result.details = { inserted: upsert.inserted, updated: upsert.updated };

    ctx.log('Memory review candidates batch completed', {
      selected: selectedCount,
      inserted: upsert.inserted,
      updated: upsert.updated
    });
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
    ctx.log('Memory review candidates batch failed', {
      error: error instanceof Error ? error.message : String(error)
    }, 'error');
  } finally {
    try {
      if (ctx.db && DatabaseUtils.isOpen(ctx.db)) {
        recordMemoryReviewQueueHealthSnapshot(ctx.db);
      }
    } catch {
      /* best-effort: snapshots optional until migration 34 */
    }
    finalizeBatchJobTiming(result);
    await ctx.emitMemoryReviewCandidatesRunRecord(result);
  }

  return result;
}

export async function runMetaMemoryIntrospection(ctx: BatchSchedulerRunContext): Promise<BatchJobResult> {
  const startTime = new Date();
  const result: BatchJobResult = {
    jobType: 'meta_memory_introspection',
    startTime,
    endTime: new Date(),
    duration: 0,
    success: false,
    processed: 0,
    errors: [],
    warnings: []
  };

  try {
    if (!ctx.db) {
      throw new Error('Database not initialized');
    }

    const scanResult = await MetaMemoryIntrospectionService.runScan(ctx.db, {});
    result.endTime = new Date();
    result.duration = result.endTime.getTime() - startTime.getTime();
    result.success = true;
    result.processed =
      scanResult.lowConfidenceMemoryIds.length + scanResult.highFailureMemoryIds.length;
    result.details = {
      lowConfidenceMemoryIds: scanResult.lowConfidenceMemoryIds,
      highFailureMemoryIds: scanResult.highFailureMemoryIds,
      summary: scanResult.summary
    };

    ctx.lastExecution.set('meta_memory_introspection', new Date());
    ctx.totalExecutions.set(
      'meta_memory_introspection',
      (ctx.totalExecutions.get('meta_memory_introspection') || 0) + 1
    );

    ctx.introspectionScanCache?.set(scanResult, result.endTime.toISOString());

    ctx.log('Meta memory introspection scan completed', {
      duration: result.duration,
      lowConfidenceCount: scanResult.lowConfidenceMemoryIds.length,
      highFailureCount: scanResult.highFailureMemoryIds.length,
      summary: scanResult.summary
    });
    return result;
  } catch (error) {
    result.endTime = new Date();
    result.duration = result.endTime.getTime() - startTime.getTime();
    result.success = false;
    result.errors.push(error instanceof Error ? error.message : String(error));
    ctx.log('Meta memory introspection scan error', {
      duration: result.duration,
      error: error instanceof Error ? error.message : String(error)
    }, 'error');
    return result;
  }
}
