import type { BatchJobExecutionCoordinator } from '../../batch-scheduler/batch-job-execution-coordinator.js';
import type { BatchScheduler } from '../../batch-scheduler/batch-scheduler.js';

export function executionCoordinator(scheduler: BatchScheduler): BatchJobExecutionCoordinator {
  return (scheduler as unknown as { jobExecutionCoordinator: BatchJobExecutionCoordinator }).jobExecutionCoordinator;
}
