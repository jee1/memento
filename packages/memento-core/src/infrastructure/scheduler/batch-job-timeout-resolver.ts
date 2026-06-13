import type { BatchJobConfig } from './batch-scheduler-types.js';

export const TRIPLE_EXTRACTION_JOB_NAME_PREFIX = 'triple_extraction_';

export function isTripleExtractionQueueJob(jobName: string): boolean {
  return jobName.startsWith(TRIPLE_EXTRACTION_JOB_NAME_PREFIX);
}

export function isJobTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes('timeout');
}

/**
 * Resolves coordinator timeout per queued job name.
 * Per-memory triple extraction jobs need longer LLM-bound timeouts than generic batch jobs.
 */
export function resolveBatchJobTimeout(jobName: string, config: BatchJobConfig): number {
  if (isTripleExtractionQueueJob(jobName)) {
    return config.tripleExtractionJobTimeout ?? config.jobTimeout;
  }

  return config.jobTimeout;
}
