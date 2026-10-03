import type { BatchJobConfig } from './batch-scheduler-types.js';

export function isJobTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes('timeout');
}

/** Resolves coordinator timeout per queued job name. */
export function resolveBatchJobTimeout(_jobName: string, config: BatchJobConfig): number {
  return config.jobTimeout;
}
