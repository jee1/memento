import type { RuntimeDiagnosticsLogger } from '../../../domains/monitoring/services/runtime-diagnostics-logger.js';
import type { BatchJobResult } from '../batch-scheduler-types.js';
import { buildMemoryReviewCandidatesRunDiagnosticsPayload } from '../memory-review-candidates-run-diagnostics.js';
import type { BatchSchedulerLogMethod } from '../handlers/batch-scheduler-run-context.js';

export async function writeBatchSchedulerDiagnosticsEvent(
  diagnosticsLogger: Pick<RuntimeDiagnosticsLogger, 'writeEvent'> | undefined,
  event: Record<string, unknown>
): Promise<void> {
  if (!diagnosticsLogger) {
    return;
  }

  try {
    await diagnosticsLogger.writeEvent({
      timestamp: new Date().toISOString(),
      ...event
    });
  } catch {
    return;
  }
}

/**
 * Issue 293: memory_review_candidates 실행 메타(고정 키)를 diagnostics에 기록한다.
 * diagnostics가 꺼져 있으면 동일 스키마로 앱 로그에 남겨 운영에서 grep/후처리할 수 있게 한다.
 */
export async function emitMemoryReviewCandidatesRunRecord(
  deps: {
    diagnosticsLogger?: Pick<RuntimeDiagnosticsLogger, 'writeEvent'>;
    log: BatchSchedulerLogMethod;
    writeDiagnosticsEvent: (event: Record<string, unknown>) => Promise<void>;
  },
  result: BatchJobResult
): Promise<void> {
  const payload = buildMemoryReviewCandidatesRunDiagnosticsPayload(result);
  await deps.writeDiagnosticsEvent(payload);
  if (!deps.diagnosticsLogger) {
    deps.log('memory_review_candidates_run', payload, 'info');
  }
}
