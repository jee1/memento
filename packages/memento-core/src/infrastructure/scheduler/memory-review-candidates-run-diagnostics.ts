import type { BatchJobResult } from './batch-scheduler-types.js';

/** Issue #293: diagnostics / log aggregation용 고정 타입 */
export const MEMORY_REVIEW_CANDIDATES_RUN_EVENT_TYPE = 'memory_review_candidates_run' as const;

function readInsertedUpdated(details: unknown): { inserted: number; updated: number } {
  if (!details || typeof details !== 'object') {
    return { inserted: 0, updated: 0 };
  }
  const d = details as Record<string, unknown>;
  const inserted = Number(d.inserted);
  const updated = Number(d.updated);
  return {
    inserted: Number.isFinite(inserted) ? inserted : 0,
    updated: Number.isFinite(updated) ? updated : 0
  };
}

/**
 * `memory_review_candidates` 1회 실행에 대한 표준 메타(성공/실패 동일 키).
 * Canonical 소비 경로: RuntimeDiagnosticsLogger `app-events.jsonl` (writeEvent).
 */
export function buildMemoryReviewCandidatesRunDiagnosticsPayload(
  result: BatchJobResult
): Record<string, unknown> {
  const { inserted, updated } = readInsertedUpdated(result.details);
  const errorCount = result.errors.length;
  const firstError =
    errorCount > 0 ? String(result.errors[0] ?? '').slice(0, 2000) : null;

  return {
    type: MEMORY_REVIEW_CANDIDATES_RUN_EVENT_TYPE,
    schema_version: 1,
    job_name: 'memory_review_candidates',
    started_at: result.startTime.toISOString(),
    finished_at: result.endTime.toISOString(),
    duration_ms: result.duration,
    result: result.success ? 'success' : 'failure',
    inserted,
    updated,
    error_count: errorCount,
    selected_count: result.processed,
    first_error: firstError
  };
}
