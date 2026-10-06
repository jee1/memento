import type { BatchJobConfig } from './batch-scheduler-types.js';

/**
 * `BatchScheduler` 생성·갱신 시 설정 일관성 검증.
 */
export function validateBatchJobConfig(config: BatchJobConfig): void {
  for (const [name, value] of [
    ['walCheckpointInterval', config.walCheckpointInterval],
    ['lockMonitorInterval', config.lockMonitorInterval],
    ['reflexionCleanupInterval', config.reflexionCleanupInterval],
    ['reflexionHealthCheckInterval', config.reflexionHealthCheckInterval],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be a positive finite number`);
    }
  }

  if (config.cleanupInterval < 60000) {
    throw new Error('cleanupInterval must be at least 1 minute');
  }
  if (config.monitoringInterval < 10000) {
    throw new Error('monitoringInterval must be at least 10 seconds');
  }
  if (config.healthCheckInterval < 10000) {
    throw new Error('healthCheckInterval must be at least 10 seconds');
  }
  if (config.maxBatchSize < 1) {
    throw new Error('maxBatchSize must be at least 1');
  }
  if (config.maxConcurrentJobs < 1) {
    throw new Error('maxConcurrentJobs must be at least 1');
  }
  if (config.jobTimeout < 1000) {
    throw new Error('jobTimeout must be at least 1 second');
  }
  if (config.metaMemoryIntrospectionInterval < 60000) {
    throw new Error('metaMemoryIntrospectionInterval must be at least 1 minute');
  }
  if (config.sleepConsolidationInterval < 60000) {
    throw new Error('sleepConsolidationInterval must be at least 1 minute');
  }
  if (config.telemetryCleanupInterval < 60000) {
    throw new Error('telemetryCleanupInterval must be at least 1 minute');
  }
  if (config.forgettingEventCleanupInterval < 60000) {
    throw new Error('forgettingEventCleanupInterval must be at least 1 minute');
  }
  if (config.jobRunCleanupInterval < 60000) {
    throw new Error('jobRunCleanupInterval must be at least 1 minute');
  }
  if (config.memoryReviewCandidatesInterval < 60000) {
    throw new Error('memoryReviewCandidatesInterval must be at least 1 minute');
  }
}
