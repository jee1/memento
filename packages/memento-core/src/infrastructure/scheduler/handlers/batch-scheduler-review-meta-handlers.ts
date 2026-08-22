import type Database from 'better-sqlite3';
import { MetaMemoryIntrospectionService } from '../../../domains/memory/introspection/meta-memory-introspection-service.js';
import { parseMemoryReviewQueueControlEnv } from '../../../domains/memory/review/memory-review-candidate-selection-env.js';
import { selectMemoryReviewCandidates } from '../../../domains/memory/review/memory-review-candidate-selection-service.js';
import {
  bulkUpdatePendingMemoryReviewCandidates,
  countPendingMemoryReviewCandidates,
  upsertPendingMemoryReviewCandidates
} from '../../../domains/memory/review/memory-review-candidate-persistence-service.js';
import { recordMemoryReviewQueueHealthSnapshot } from '../../../domains/memory/review/memory-review-queue-health-service.js';
import { resolveValidatedNumber } from '../../../shared/config/environment.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import type { BatchJobResult } from '../batch-scheduler/batch-scheduler-types.js';
import {
  assertSchedulerDbOpen,
  createEmptyBatchJobResult,
  finalizeBatchJobTiming
} from '../batch-scheduler/batch-scheduler-internal-helpers.js';
import type { BatchSchedulerRunContext } from './batch-scheduler-run-context.js';

export function buildMemoryReviewCandidateUpsertInputs(
  db: Database.Database,
  maxCandidates?: number
): {
  inputs: Array<{
    memory_id: string;
    priority: number;
    reason: string;
    due_at: string;
    metadata_json: string;
  }>;
  selectedCount: number;
} {
  const items = selectMemoryReviewCandidates(
    db,
    maxCandidates === undefined ? undefined : { maxCandidates }
  );
  const dueDays = resolveValidatedNumber(
    'MEMORY_REVIEW_CANDIDATE_DUE_DAYS',
    14,
    n => n >= 1 && n <= 366,
    '1-366'
  );
  const dueAt = new Date(Date.now() + dueDays * 86_400_000).toISOString();
  const inputs = items.map(i => ({
    memory_id: i.memory_id,
    priority: i.priority,
    reason: i.reason,
    due_at: dueAt,
    metadata_json: JSON.stringify({ score_breakdown: i.score_breakdown })
  }));
  return { inputs, selectedCount: items.length };
}

export async function runMemoryReviewCandidatesJob(ctx: BatchSchedulerRunContext): Promise<BatchJobResult> {
  const result = createEmptyBatchJobResult('memory_review_candidates');

  try {
    assertSchedulerDbOpen(ctx.db);

    const nowIso = new Date().toISOString();
    const queueControl = parseMemoryReviewQueueControlEnv();
    const expired =
      queueControl.candidateTtlDays > 0
        ? bulkUpdatePendingMemoryReviewCandidates(
            ctx.db!,
            'expire',
            { older_than_days: queueControl.candidateTtlDays },
            nowIso
          ).updated
        : 0;
    const pendingBefore = countPendingMemoryReviewCandidates(ctx.db!);
    const skippedForBacklog =
      queueControl.maxBacklog > 0 && pendingBefore >= queueControl.maxBacklog;

    if (skippedForBacklog) {
      result.success = true;
      result.details = {
        inserted: 0,
        updated: 0,
        expired,
        pendingBefore,
        pendingAfter: pendingBefore,
        skippedForBacklog: true,
        ...queueControl
      };
      ctx.log('Memory review candidates batch skipped at backlog limit', {
        expired,
        pending: pendingBefore,
        maxBacklog: queueControl.maxBacklog
      });
      return result;
    }

    const remainingCapacity =
      queueControl.maxBacklog === 0 ? undefined : queueControl.maxBacklog - pendingBefore;
    const { inputs, selectedCount } = buildMemoryReviewCandidateUpsertInputs(
      ctx.db!,
      remainingCapacity
    );
    const upsert = upsertPendingMemoryReviewCandidates(ctx.db!, inputs, nowIso);
    const pendingAfter = countPendingMemoryReviewCandidates(ctx.db!);
    result.success = true;
    result.processed = inputs.length;
    result.details = {
      inserted: upsert.inserted,
      updated: upsert.updated,
      expired,
      pendingBefore,
      pendingAfter,
      skippedForBacklog: false,
      ...queueControl
    };

    ctx.log('Memory review candidates batch completed', {
      selected: selectedCount,
      inserted: upsert.inserted,
      updated: upsert.updated,
      expired,
      pendingBefore,
      pendingAfter
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
