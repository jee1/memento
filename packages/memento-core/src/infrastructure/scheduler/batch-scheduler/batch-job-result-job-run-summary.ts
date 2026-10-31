import type { BatchJobResult } from './batch-scheduler-types.js';

/** Issue #1559: keep job_run.details_json bounded — no unbounded arrays or raw blobs. */
const MAX_DETAILS_JSON_CHARS = 8192;
const MAX_DETAIL_ARRAY_ITEMS = 32;
const MAX_DETAIL_STRING_CHARS = 512;
const MAX_DETAIL_DEPTH = 6;

export interface JobRunSummaryFields {
  processed: number | null;
  error_count: number | null;
  details_json: string | null;
}

export function isBatchJobResultLike(value: unknown): value is BatchJobResult {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as { success?: unknown; errors?: unknown; processed?: unknown };
  return typeof record.success === 'boolean' && Array.isArray(record.errors);
}

function sanitizeDetailsValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DETAIL_DEPTH) {
    return '[max-depth]';
  }
  if (value == null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.length <= MAX_DETAIL_STRING_CHARS
      ? value
      : `${value.slice(0, MAX_DETAIL_STRING_CHARS)}…`;
  }
  if (Array.isArray(value)) {
    const slice = value.slice(0, MAX_DETAIL_ARRAY_ITEMS).map(item => sanitizeDetailsValue(item, depth + 1));
    if (value.length > MAX_DETAIL_ARRAY_ITEMS) {
      return { items: slice, truncatedCount: value.length - MAX_DETAIL_ARRAY_ITEMS };
    }
    return slice;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sanitizeDetailsValue(nested, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function serializeJobRunDetailsJson(details: unknown): string | null {
  if (details == null) {
    return null;
  }
  try {
    const sanitized = sanitizeDetailsValue(details, 0);
    let json = JSON.stringify(sanitized);
    if (json.length <= MAX_DETAILS_JSON_CHARS) {
      return json;
    }
    json = JSON.stringify({ truncated: true, byteLength: json.length });
    return json.length <= MAX_DETAILS_JSON_CHARS ? json : null;
  } catch {
    return null;
  }
}

/**
 * Maps a batch job return value (or schedule failure) to job_run summary columns.
 * Manual and schedule paths share this helper (#1559).
 */
export function jobRunSummaryFieldsFromOutcome(
  jobOk: boolean,
  outcome: unknown,
  failureMessage?: string
): JobRunSummaryFields {
  if (isBatchJobResultLike(outcome)) {
    return {
      processed: Number.isFinite(outcome.processed) ? outcome.processed : null,
      error_count: outcome.errors.length,
      details_json: serializeJobRunDetailsJson(outcome.details),
    };
  }

  if (!jobOk) {
    const message = failureMessage ?? 'job failed';
    return {
      processed: null,
      error_count: 1,
      details_json: JSON.stringify({ error: message }),
    };
  }

  return {
    processed: outcome === undefined ? 0 : null,
    error_count: 0,
    details_json: null,
  };
}

export function jobRunSummaryFieldsFromBatchJobResult(result: BatchJobResult): JobRunSummaryFields {
  return jobRunSummaryFieldsFromOutcome(result.success, result);
}
