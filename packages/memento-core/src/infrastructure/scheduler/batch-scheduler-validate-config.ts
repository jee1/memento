import type { BatchJobConfig } from './batch-scheduler-types.js';

/**
 * `BatchScheduler` 생성·갱신 시 설정 일관성 검증.
 */
export function validateBatchJobConfig(config: BatchJobConfig): void {
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
  if (config.tripleExtractionInterval < 60000) {
    throw new Error('tripleExtractionInterval must be at least 1 minute');
  }
  if (
    config.tripleExtractionHour !== undefined &&
    (config.tripleExtractionHour < 0 || config.tripleExtractionHour > 23)
  ) {
    throw new Error('tripleExtractionHour must be between 0 and 23');
  }
  if (config.tripleExtractionBatchSize < 1) {
    throw new Error('tripleExtractionBatchSize must be at least 1');
  }
  if (config.tripleExtractionTimeout < 1000) {
    throw new Error('tripleExtractionTimeout must be at least 1 second');
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
  if (config.memoryReviewCandidatesInterval < 60000) {
    throw new Error('memoryReviewCandidatesInterval must be at least 1 minute');
  }
  if (config.weeklyRelationValidationTimeout !== undefined) {
    if (
      typeof config.weeklyRelationValidationTimeout !== 'number' ||
      Number.isNaN(config.weeklyRelationValidationTimeout) ||
      config.weeklyRelationValidationTimeout <= 0
    ) {
      throw new Error('weeklyRelationValidationTimeout must be a positive number (at least 1 second)');
    }
    if (config.weeklyRelationValidationTimeout < 1000) {
      throw new Error('weeklyRelationValidationTimeout must be at least 1 second');
    }
  }
}
