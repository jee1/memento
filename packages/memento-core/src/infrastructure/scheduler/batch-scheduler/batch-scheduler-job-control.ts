import type { BatchJobResult } from '../batch-scheduler-types.js';
import type { JobQueue } from '../job-queue.js';
import type { BatchSchedulerLogMethod } from '../handlers/batch-scheduler-run-context.js';
import {
  scheduleCleanupJob,
  scheduleHealthcheckJob,
  scheduleMemoryReviewCandidatesInterval,
  scheduleMonitoringJob
} from '../batch-recurring-schedules.js';
import {
  buildBatchSchedulerRecurringScheduleContextFromSource,
  getBatchSchedulerRecurringContextSource,
  type BatchSchedulerRecurringCallbacks,
  type BatchSchedulerRecurringState,
  type BatchSchedulerServiceState
} from './batch-scheduler-service-wiring.js';
import {
  runManualBatchSchedulerJob,
  type ManualBatchSchedulerJobType
} from './batch-scheduler-job-runners.js';
import { createBatchSchedulerJobRunnerCallbacks } from './batch-scheduler-job-processor.js';
import type { BatchSchedulerContextSource } from './batch-scheduler-context.js';

export function runBatchSchedulerJob(
  jobType: ManualBatchSchedulerJobType,
  contextSource: BatchSchedulerContextSource,
  lastExecution: Map<string, Date>,
  totalExecutions: Map<string, number>,
  lastJobRunMeta: Map<string, { at: Date; success: boolean; durationMs: number }>
): Promise<BatchJobResult> {
  const runners = createBatchSchedulerJobRunnerCallbacks(contextSource);
  return runManualBatchSchedulerJob(jobType, runners).then(result => {
    lastExecution.set(jobType, new Date());
    totalExecutions.set(jobType, (totalExecutions.get(jobType) || 0) + 1);

    if (jobType === 'memory_review_candidates') {
      lastJobRunMeta.set(jobType, {
        at: result.endTime,
        success: result.success,
        durationMs: result.duration
      });
    }

    return result;
  });
}

export function stopBatchSchedulerJob(
  intervals: Map<string, ReturnType<typeof setInterval>>,
  log: BatchSchedulerLogMethod,
  jobName: string
): boolean {
  const interval = intervals.get(jobName);
  if (interval) {
    clearInterval(interval);
    intervals.delete(jobName);
    log(`Stopped job: ${jobName}`);
    return true;
  }
  return false;
}

export function restartBatchSchedulerJob(
  state: BatchSchedulerServiceState,
  recurringState: BatchSchedulerRecurringState,
  callbacks: BatchSchedulerRecurringCallbacks,
  log: BatchSchedulerLogMethod,
  emitMemoryReviewCandidatesRunRecordFn: (result: BatchJobResult) => Promise<void>,
  jobName: string
): boolean {
  const ctx = buildBatchSchedulerRecurringScheduleContextFromSource(
    getBatchSchedulerRecurringContextSource(
      state,
      recurringState,
      callbacks,
      log,
      emitMemoryReviewCandidatesRunRecordFn
    )
  );

  if (jobName === 'cleanup') {
    scheduleCleanupJob(ctx);
  } else if (jobName === 'monitoring') {
    scheduleMonitoringJob(ctx);
  } else if (jobName === 'healthcheck') {
    scheduleHealthcheckJob(ctx);
  } else if (jobName === 'memory_review_candidates') {
    if (!state.config.memoryReviewCandidatesSchedulerEnabled) {
      log('restartJob(memory_review_candidates): periodic schedule is disabled; enable MEMORY_REVIEW_CANDIDATES_SCHEDULER_ENABLED or use runJob', {
        level: 'warn'
      });
      return false;
    }
    scheduleMemoryReviewCandidatesInterval(ctx);
  } else {
    log(`Unknown job type for restart: ${jobName}`);
    return false;
  }

  log(`Restarted job: ${jobName}`);
  return true;
}

export function isBatchSchedulerJobQueued(jobQueue: JobQueue, name: string): boolean {
  return jobQueue.isQueued(name);
}

export function isBatchSchedulerJobRunning(jobQueue: JobQueue, name: string): boolean {
  return jobQueue.isRunning(name);
}

export type { ManualBatchSchedulerJobType };
