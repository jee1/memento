import type { BatchJobResult } from './batch-scheduler-types.js';
import type { JobQueue } from '../job-queue.js';
import type { BatchSchedulerLogMethod } from '../handlers/batch-scheduler-run-context.js';
import {
  scheduleAnchorAutoRefresh,
  scheduleCleanupJob,
  scheduleConsolidationScoreFullSweep,
  scheduleConsolidationScoreIncremental,
  scheduleForgettingEventCleanup,
  scheduleHealthcheckJob,
  scheduleJobRunCleanup,
  scheduleLogRotation,
  scheduleMemoryReviewCandidatesInterval,
  scheduleMetaMemoryIntrospection,
  scheduleMonitoringJob,
  scheduleQualityMeasurement,
  scheduleSleepConsolidation,
  scheduleTelemetryCleanup,
  scheduleTripleExtractionBatch,
  scheduleWeeklyRelationValidation,
  type BatchRecurringScheduleContext
} from './batch-recurring-schedules.js';
import {
  buildBatchSchedulerRecurringScheduleContextFromSource,
  getBatchSchedulerRecurringContextSource,
  type BatchSchedulerRecurringCallbacks,
  type BatchSchedulerRecurringState,
  type BatchSchedulerServiceState
} from './batch-scheduler-service-wiring.js';
import {
  isRegisteredManualBatchJobType,
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

type RestartHandler = (ctx: BatchRecurringScheduleContext) => void;

/**
 * schedule-name → schedule* handler registry (Issue #834).
 * Mirrors registerAllRecurringJobs / per-job schedule helpers.
 */
function buildRestartHandlers(): Record<string, RestartHandler> {
  return {
    cleanup: scheduleCleanupJob,
    monitoring: scheduleMonitoringJob,
    healthcheck: scheduleHealthcheckJob,
    consolidation_score_incremental: scheduleConsolidationScoreIncremental,
    consolidation_score_full_sweep: scheduleConsolidationScoreFullSweep,
    weekly_relation_validation: scheduleWeeklyRelationValidation,
    log_rotation: scheduleLogRotation,
    triple_extraction_batch: scheduleTripleExtractionBatch,
    quality_measurement_batch: scheduleQualityMeasurement,
    meta_memory_introspection: scheduleMetaMemoryIntrospection,
    memory_review_candidates: scheduleMemoryReviewCandidatesInterval,
    sleep_consolidation_batch: scheduleSleepConsolidation,
    telemetry_cleanup_batch: scheduleTelemetryCleanup,
    forgetting_event_cleanup_batch: scheduleForgettingEventCleanup,
    job_run_cleanup_batch: scheduleJobRunCleanup,
    anchor_auto_refresh: scheduleAnchorAutoRefresh
  };
}

/** Test helper: list restart registry keys without invoking handlers. */
export function buildRestartHandlerNamesForTest(): string[] {
  return Object.keys(buildRestartHandlers());
}

function canRestartJob(
  state: BatchSchedulerServiceState,
  ctx: BatchRecurringScheduleContext,
  jobName: string,
  log: BatchSchedulerLogMethod
): boolean {
  if (jobName === 'memory_review_candidates' && !state.config.memoryReviewCandidatesSchedulerEnabled) {
    log(
      'restartJob(memory_review_candidates): periodic schedule is disabled; enable MEMORY_REVIEW_CANDIDATES_SCHEDULER_ENABLED or use runJob',
      { level: 'warn' }
    );
    return false;
  }
  if (jobName === 'anchor_auto_refresh' && (!state.config.anchorAutoRefreshEnabled || !ctx.hasAnchorManager)) {
    log('restartJob(anchor_auto_refresh): disabled or AnchorManager not available', { level: 'warn' });
    return false;
  }
  if (
    (jobName === 'consolidation_score_incremental' || jobName === 'consolidation_score_full_sweep') &&
    (!ctx.consolidationScoreEnabled || !ctx.hasConsolidationScoreWorker)
  ) {
    log(`restartJob(${jobName}): consolidation score disabled or worker missing`, { level: 'warn' });
    return false;
  }
  if (jobName === 'sleep_consolidation_batch' && !ctx.hasSleepConsolidation) {
    log('restartJob(sleep_consolidation_batch): SleepConsolidationService not available', { level: 'warn' });
    return false;
  }
  if (jobName === 'telemetry_cleanup_batch' && !ctx.hasTelemetryCleanup) {
    log('restartJob(telemetry_cleanup_batch): telemetry cleanup repository not available', { level: 'warn' });
    return false;
  }
  if (jobName === 'forgetting_event_cleanup_batch' && !ctx.hasForgettingEventCleanup) {
    log('restartJob(forgetting_event_cleanup_batch): db not available', { level: 'warn' });
    return false;
  }
  if (jobName === 'job_run_cleanup_batch' && !ctx.hasJobRunCleanup) {
    log('restartJob(job_run_cleanup_batch): db not available', { level: 'warn' });
    return false;
  }
  return true;
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

  const handlers = buildRestartHandlers();
  const handler = handlers[jobName];
  if (!handler) {
    log(`Unknown job type for restart: ${jobName}`);
    return false;
  }

  if (!canRestartJob(state, ctx, jobName, log)) {
    return false;
  }

  // Idempotent resume: clear existing interval before re-scheduling.
  stopBatchSchedulerJob(ctx.intervals, () => {}, jobName);
  handler(ctx);
  log(`Restarted job: ${jobName}`);
  return true;
}

/**
 * Pause = stop schedule interval + track in paused set. Does not kill in-flight (Q6).
 * Idempotent: already paused / no interval → still records paused and returns ok.
 */
export function pauseBatchSchedulerJob(
  intervals: Map<string, ReturnType<typeof setInterval>>,
  pausedJobs: Set<string>,
  log: BatchSchedulerLogMethod,
  jobName: string
): { ok: boolean; reason?: string } {
  if (!isRegisteredManualBatchJobType(jobName)) {
    return { ok: false, reason: 'unknown_job' };
  }
  stopBatchSchedulerJob(intervals, log, jobName);
  pausedJobs.add(jobName);
  log(`Paused job: ${jobName}`);
  return { ok: true };
}

/**
 * Resume = restart via schedule registry + remove from paused set.
 * Idempotent when already active (handler re-schedules after clear).
 */
export function resumeBatchSchedulerJob(
  state: BatchSchedulerServiceState,
  recurringState: BatchSchedulerRecurringState,
  callbacks: BatchSchedulerRecurringCallbacks,
  log: BatchSchedulerLogMethod,
  emitMemoryReviewCandidatesRunRecordFn: (result: BatchJobResult) => Promise<void>,
  pausedJobs: Set<string>,
  jobName: string
): { ok: boolean; reason?: string } {
  if (!isRegisteredManualBatchJobType(jobName)) {
    return { ok: false, reason: 'unknown_job' };
  }
  const restarted = restartBatchSchedulerJob(
    state,
    recurringState,
    callbacks,
    log,
    emitMemoryReviewCandidatesRunRecordFn,
    jobName
  );
  if (!restarted) {
    return { ok: false, reason: 'config_disabled' };
  }
  pausedJobs.delete(jobName);
  return { ok: true };
}

export function isBatchSchedulerJobQueued(jobQueue: JobQueue, name: string): boolean {
  return jobQueue.isQueued(name);
}

export function isBatchSchedulerJobRunning(jobQueue: JobQueue, name: string): boolean {
  return jobQueue.isRunning(name);
}

export type { ManualBatchSchedulerJobType };
