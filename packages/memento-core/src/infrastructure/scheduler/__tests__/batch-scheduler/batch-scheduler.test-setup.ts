import type { BatchJobExecutionCoordinator } from '../../batch-job-execution-coordinator.js';
import type { BatchScheduler } from '../../batch-scheduler.js';

export function executionCoordinator(scheduler: BatchScheduler): BatchJobExecutionCoordinator {
  return (scheduler as unknown as { jobExecutionCoordinator: BatchJobExecutionCoordinator }).jobExecutionCoordinator;
}

export const DEFAULT_SCHEDULER_CONFIG = {
  cleanupInterval: 60000,
  monitoringInterval: 10000,
  healthCheckInterval: 10000,
  memoryReviewCandidatesInterval: 60000,
  maxBatchSize: 100,
  enableLogging: false,
  enableNotifications: false,
  enableMetrics: false,
  maxConcurrentJobs: 2,
  jobTimeout: 5000,
  retryAttempts: 2,
  retryDelay: 100,
} as const;
