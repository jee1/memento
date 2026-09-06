import type { BatchJobExecutionCoordinator } from './batch-job-execution-coordinator.js';
import type { JobQueue } from '../job-queue.js';
import type { BatchSchedulerLogMethod } from '../handlers/batch-scheduler-run-context.js';
import {
  scheduleBatchJob,
  waitForRunningBatchJobs
} from './batch-scheduler-interval.js';
import {
  createBatchSchedulerJobRunners,
  type ManualBatchSchedulerJobType
} from './batch-scheduler-job-runners.js';
import type { BatchSchedulerContextSource } from './batch-scheduler-context.js';
import type { BatchSchedulerRecurringState } from './batch-scheduler-service-wiring.js';

export interface BatchSchedulerJobProcessorState {
  jobProcessorInterval: ReturnType<typeof setInterval> | null;
}

export function getBatchSchedulerJobRunners(source: BatchSchedulerContextSource) {
  return createBatchSchedulerJobRunners(source);
}

export function createBatchSchedulerJobRunnerCallbacks(source: BatchSchedulerContextSource) {
  const runners = getBatchSchedulerJobRunners(source);
  return {
    runMemoryCleanup: () => runners.runMemoryCleanup(),
    runMemoryReviewCandidatesJob: () => runners.runMemoryReviewCandidatesJob(),
    runMonitoring: () => runners.runMonitoring(),
    runHealthCheck: () => runners.runHealthCheck(),
    runConsolidationScoreIncremental: () => runners.runConsolidationScoreIncremental(),
    runWeeklyRelationValidation: () => runners.runWeeklyRelationValidation(),
    runConsolidationScoreFullSweep: () => runners.runConsolidationScoreFullSweep(),
    runTripleExtractionBatch: () => runners.runTripleExtractionBatch(),
    runMetaMemoryIntrospection: () => runners.runMetaMemoryIntrospection(),
    runQualityMeasurementBatch: () => runners.runQualityMeasurementBatch(),
    runLogRotation: () => runners.runLogRotation(),
    runSleepConsolidationBatch: () => runners.runSleepConsolidationBatch(),
    runTelemetryCleanupBatch: () => runners.runTelemetryCleanupBatch(),
    runForgettingEventCleanupBatch: () => runners.runForgettingEventCleanupBatch(),
    runJobRunCleanupBatch: () => runners.runJobRunCleanupBatch(),
    runAnchorAutoRefresh: () => runners.runAnchorAutoRefresh()
  };
}

export function addBatchSchedulerJob(
  jobExecutionCoordinator: BatchJobExecutionCoordinator,
  processorState: BatchSchedulerJobProcessorState,
  name: string,
  job: () => Promise<void>,
  priority: number = 10,
  retryCount: number = 0
): boolean {
  const added = jobExecutionCoordinator.addJobToQueue(name, job, priority, retryCount);
  jobExecutionCoordinator.afterEnqueueAttempt(name, added, processorState.jobProcessorInterval);
  return added;
}

export function scheduleBatchSchedulerJob(
  recurringState: BatchSchedulerRecurringState,
  jobQueue: JobQueue,
  log: BatchSchedulerLogMethod,
  name: string,
  interval: number,
  job: () => Promise<void>,
  priority: number
): void {
  scheduleBatchJob(
    {
      jobExecutionCoordinator: recurringState.jobExecutionCoordinator,
      intervals: recurringState.intervals,
      jobQueue,
      log
    },
    name,
    interval,
    job,
    priority
  );
}

export function startBatchSchedulerJobProcessor(
  jobExecutionCoordinator: BatchJobExecutionCoordinator,
  processorState: BatchSchedulerJobProcessorState
): void {
  processorState.jobProcessorInterval = jobExecutionCoordinator.startJobProcessor();
}

export async function waitForBatchSchedulerJobs(
  recurringState: BatchSchedulerRecurringState,
  jobQueue: JobQueue,
  log: BatchSchedulerLogMethod
): Promise<void> {
  await waitForRunningBatchJobs({
    jobExecutionCoordinator: recurringState.jobExecutionCoordinator,
    intervals: recurringState.intervals,
    jobQueue,
    log
  });
}

export function clearBatchSchedulerJobProcessorInterval(
  processorState: BatchSchedulerJobProcessorState
): void {
  if (processorState.jobProcessorInterval) {
    clearInterval(processorState.jobProcessorInterval);
    processorState.jobProcessorInterval = null;
  }
}

export type { ManualBatchSchedulerJobType };
