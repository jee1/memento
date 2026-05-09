/**
 * In-memory ring buffer for manual POST /admin/batch/run executions (#295).
 * Per-process only; resets on server restart.
 */

export const BATCH_RUN_HISTORY_DEFAULT_LIMIT = 50;
export const BATCH_RUN_HISTORY_MAX_STORED = 100;

export interface BatchRunHistoryRecord {
  jobType: string;
  requestedAt: string;
  completedAt: string;
  durationMs: number;
  success: boolean;
  processed: number;
  errorCount: number;
  warningCount: number;
  errorsPreview: string;
  /** JSON-safe snapshot of scheduler result */
  result: Record<string, unknown> | null;
  failureMessage?: string;
}

const entries: BatchRunHistoryRecord[] = [];

function trimEntries(): void {
  while (entries.length > BATCH_RUN_HISTORY_MAX_STORED) {
    entries.pop();
  }
}

function jsonSafeDetails(details: unknown): unknown {
  if (details === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(JSON.stringify(details)) as unknown;
  } catch {
    return String(details);
  }
}

/** Minimal shape from BatchScheduler.runJob return value */
export function recordManualBatchRunSuccess(
  jobType: string,
  requestedAt: Date,
  result: {
    jobType: string;
    startTime: Date;
    endTime: Date;
    duration: number;
    success: boolean;
    processed: number;
    errors: string[];
    warnings: string[];
    details?: unknown;
    retryCount?: number;
  }
): void {
  const errorsPreview =
    result.errors.length > 0
      ? result.errors
          .slice(0, 3)
          .join('; ')
          .slice(0, 400)
      : '';

  const serialized: Record<string, unknown> = {
    jobType: result.jobType,
    startTime: result.startTime.toISOString(),
    endTime: result.endTime.toISOString(),
    duration: result.duration,
    success: result.success,
    processed: result.processed,
    errors: result.errors,
    warnings: result.warnings,
    retryCount: result.retryCount
  };
  const details = jsonSafeDetails(result.details);
  if (details !== undefined) {
    serialized.details = details;
  }

  entries.unshift({
    jobType,
    requestedAt: requestedAt.toISOString(),
    completedAt: result.endTime.toISOString(),
    durationMs: result.duration,
    success: result.success,
    processed: result.processed,
    errorCount: result.errors.length,
    warningCount: result.warnings.length,
    errorsPreview,
    result: serialized
  });
  trimEntries();
}

export function recordManualBatchRunFailure(
  jobType: string,
  requestedAt: Date,
  completedAt: Date,
  message: string
): void {
  entries.unshift({
    jobType,
    requestedAt: requestedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: Math.max(0, completedAt.getTime() - requestedAt.getTime()),
    success: false,
    processed: 0,
    errorCount: 1,
    warningCount: 0,
    errorsPreview: message.slice(0, 400),
    result: null,
    failureMessage: message
  });
  trimEntries();
}

export function getManualBatchRunHistory(limit: number): BatchRunHistoryRecord[] {
  const n = Math.min(Math.max(1, Math.floor(limit)), BATCH_RUN_HISTORY_MAX_STORED);
  return entries.slice(0, n);
}

export function resetBatchRunHistoryForTests(): void {
  entries.length = 0;
}
