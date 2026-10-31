import { randomUUID } from 'node:crypto';
import { resolveSupersedeLlm } from '../../../domains/memory/supersede/supersede-llm-resolver.js';
import { SupersedeCandidateService } from '../../../domains/memory/supersede/supersede-candidate-service.js';
import { createEmptyBatchJobResult, finalizeBatchJobTiming } from '../batch-scheduler/batch-scheduler-internal-helpers.js';
import type { BatchJobResult } from '../batch-scheduler/batch-scheduler-types.js';
import type { BatchSchedulerRunContext } from './batch-scheduler-run-context.js';

/**
 * #1548: 대체 후보 판정. 꺼져 있으면 LLM 설정도 호출도 하지 않는다.
 * 429, 미설정, 개별 판정 실패는 job 실패가 아니라 경고다. 남은 쌍은 다음 run 이 맡는다.
 */
export async function runSupersedeCandidateScan(ctx: BatchSchedulerRunContext): Promise<BatchJobResult> {
  const result = createEmptyBatchJobResult('supersede_candidate_scan');
  try {
    if (!ctx.config.supersedeCandidateScanEnabled) {
      result.success = true;
      result.warnings.push('disabled');
      result.details = { status: 'skipped', reason: 'SUPERSEDE_CANDIDATE_SCAN_ENABLED=false' };
      return result;
    }
    if (!ctx.db) {
      result.errors.push('Database is not available');
      return result;
    }

    const llm = await resolveSupersedeLlm();
    const runId = randomUUID();
    const summary = await new SupersedeCandidateService({
      db: ctx.db,
      port: llm?.port ?? null,
      model: llm?.model ?? null,
    }).scan({ runId });

    result.success = true;
    result.processed = summary.judged;
    result.details = { ...summary, runId };
    if (summary.status !== 'completed') {
      result.warnings.push(summary.status);
    }
    if (summary.failed > 0) {
      result.warnings.push(`${summary.failed} pairs failed and will be retried next run`);
    }
    ctx.log('supersede_candidate_scan finished', result.details);
  } catch (error) {
    result.success = false;
    result.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    finalizeBatchJobTiming(result);
  }
  return result;
}
