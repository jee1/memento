/**
 * Triple extraction source-status metadata builders (canonical key sets).
 * Shared by episodic→semantic conversion coordinator and batch job tests/helpers.
 */

/**
 * success 상태 전이 canonical metadata.
 * `confidenceAvg`가 finite일 때만 `confidence_avg`를 포함한다.
 */
export function buildTripleExtractionSuccessMetadata(
  now: Date,
  tripleCount: number,
  confidenceAvg?: number
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    triple_count: tripleCount,
    extracted_at: now.toISOString()
  };
  if (typeof confidenceAvg === 'number' && Number.isFinite(confidenceAvg)) {
    metadata.confidence_avg = confidenceAvg;
  }
  return metadata;
}

/**
 * failed 상태 전이 canonical metadata (`next_retry_after_days` 포함).
 */
export function buildTripleExtractionFailedMetadata(
  now: Date,
  failureReason: string,
  retryCount: number,
  nextRetryAfterDays: number
): Record<string, unknown> {
  return {
    failureReason,
    retry_count: retryCount,
    last_attempt: now.toISOString(),
    next_retry_after_days: nextRetryAfterDays
  };
}

/**
 * abandoned 상태 전이 canonical metadata (next-retry 키 없음).
 */
export function buildTripleExtractionAbandonedMetadata(
  now: Date,
  failureReason: string,
  retryCount: number
): Record<string, unknown> {
  const nowIso = now.toISOString();
  return {
    failureReason,
    retry_count: retryCount,
    last_attempt: nowIso,
    abandoned_at: nowIso
  };
}
