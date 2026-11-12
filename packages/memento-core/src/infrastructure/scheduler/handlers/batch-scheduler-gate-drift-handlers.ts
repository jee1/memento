import { countActiveMemoryItems } from '../../../domains/memory/index.js';
import {
  checkRejectionGateDrift,
  recordRejectionGateDriftVerdict,
} from '../../../domains/telemetry/index.js';
import { mementoConfig } from '../../../shared/config/index.js';
import { createEmptyBatchJobResult, finalizeBatchJobTiming } from '../batch-scheduler/batch-scheduler-internal-helpers.js';
import type { BatchJobResult } from '../batch-scheduler/batch-scheduler-types.js';
import type { BatchSchedulerRunContext } from './batch-scheduler-run-context.js';

/**
 * #1681: 기각 게이트 드리프트 점검. LLM 이나 외부 API 를 부르지 않고 텔레메트리와 기준 기록만 읽는다.
 * 알림은 재측정이 필요하다는 신호이지 임계값을 바꾸지 않는다.
 */
export async function runRejectionGateDriftCheck(ctx: BatchSchedulerRunContext): Promise<BatchJobResult> {
  const result = createEmptyBatchJobResult('rejection_gate_drift_check');
  try {
    if (mementoConfig.searchRejectionGate === 'off') {
      result.success = true;
      result.warnings.push('disabled');
      result.details = { status: 'skipped', reason: 'SEARCH_REJECTION_GATE=off' };
      return result;
    }
    if (!ctx.db) {
      result.errors.push('Database is not available');
      return result;
    }

    const verdict = checkRejectionGateDrift(ctx.db, new Date(), countActiveMemoryItems);
    result.success = true;
    if (!verdict) {
      result.details = { status: 'skipped', reason: 'no_baseline' };
      return result;
    }
    recordRejectionGateDriftVerdict(ctx.db, verdict);
    result.processed = 1;
    result.details = verdict;
    if (verdict.alert) {
      result.warnings.push(
        `gate drift alert (scale=${verdict.scale.alert}, band=${verdict.band.outcome}): 재측정 필요, 판정기 드리프트 확정 아님`,
      );
    }
    ctx.log('rejection_gate_drift_check finished', result.details);
  } catch (error) {
    result.success = false;
    result.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    finalizeBatchJobTiming(result);
  }
  return result;
}
