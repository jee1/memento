import type { BatchJobResult } from './batch-scheduler-types.js';
import {
  runHealthCheck,
  runMemoryCleanup,
  runMonitoring
} from '../handlers/batch-scheduler-maintenance-handlers.js';
import {
  runMemoryReviewCandidatesJob,
  runMetaMemoryIntrospection
} from '../handlers/batch-scheduler-review-meta-handlers.js';
import {
  runConsolidationScoreFullSweep,
  runConsolidationScoreIncremental,
  runLogRotation,
  runWeeklyRelationValidation
} from '../handlers/batch-scheduler-consolidation-relation-handlers.js';
import {
  runQualityMeasurementBatch,
  runTripleExtractionBatch
} from '../handlers/batch-scheduler-augmentation-handlers.js';
import {
  runSleepConsolidationBatch,
  runTelemetryCleanupBatch,
  runForgettingEventCleanupBatch,
  runJobRunCleanupBatch
} from '../handlers/batch-scheduler-sleep-telemetry-handlers.js';
import { runAnchorAutoRefresh } from '../handlers/batch-scheduler-anchor-handlers.js';
import {
  buildBatchSchedulerRunContext,
  type BatchSchedulerContextSource
} from './batch-scheduler-context.js';

/**
 * All registered schedule job names that can be Run-now / pause / resume (Issue #834).
 * Aliases match `batch-recurring-schedules.ts` interval keys.
 */
export const REGISTERED_MANUAL_BATCH_JOB_TYPES = [
  'cleanup',
  'monitoring',
  'healthcheck',
  'consolidation_score_incremental',
  'consolidation_score_full_sweep',
  'weekly_relation_validation',
  'log_rotation',
  'triple_extraction_batch',
  'quality_measurement_batch',
  'meta_memory_introspection',
  'memory_review_candidates',
  'sleep_consolidation_batch',
  'telemetry_cleanup_batch',
  'forgetting_event_cleanup_batch',
  'job_run_cleanup_batch',
  'anchor_auto_refresh',
] as const;

export type ManualBatchSchedulerJobType = (typeof REGISTERED_MANUAL_BATCH_JOB_TYPES)[number];

const REGISTERED_SET = new Set<string>(REGISTERED_MANUAL_BATCH_JOB_TYPES);

export function isRegisteredManualBatchJobType(value: unknown): value is ManualBatchSchedulerJobType {
  return typeof value === 'string' && REGISTERED_SET.has(value);
}

export function createBatchSchedulerJobRunners(source: BatchSchedulerContextSource) {
  const ctx = () => buildBatchSchedulerRunContext(source);
  return {
    runMemoryCleanup: () => runMemoryCleanup(ctx()),
    runMemoryReviewCandidatesJob: () => runMemoryReviewCandidatesJob(ctx()),
    runMonitoring: () => runMonitoring(ctx()),
    runHealthCheck: () => runHealthCheck(ctx()),
    runConsolidationScoreIncremental: () => runConsolidationScoreIncremental(ctx()),
    runWeeklyRelationValidation: () => runWeeklyRelationValidation(ctx()),
    runConsolidationScoreFullSweep: () => runConsolidationScoreFullSweep(ctx()),
    runTripleExtractionBatch: () => runTripleExtractionBatch(ctx()),
    runMetaMemoryIntrospection: () => runMetaMemoryIntrospection(ctx()),
    runQualityMeasurementBatch: () => runQualityMeasurementBatch(ctx()),
    runLogRotation: () => runLogRotation(ctx()),
    runSleepConsolidationBatch: () => runSleepConsolidationBatch(ctx()),
    runTelemetryCleanupBatch: () => runTelemetryCleanupBatch(ctx()),
    runForgettingEventCleanupBatch: () => runForgettingEventCleanupBatch(ctx()),
    runJobRunCleanupBatch: () => runJobRunCleanupBatch(ctx()),
    runAnchorAutoRefresh: () => runAnchorAutoRefresh(ctx())
  };
}

export type BatchSchedulerJobRunners = ReturnType<typeof createBatchSchedulerJobRunners>;

function wrapVoidRunner(
  jobType: ManualBatchSchedulerJobType,
  run: () => Promise<void>
): Promise<BatchJobResult> {
  const startTime = new Date();
  return run()
    .then(() => {
      const endTime = new Date();
      return {
        jobType,
        startTime,
        endTime,
        duration: endTime.getTime() - startTime.getTime(),
        success: true,
        processed: 0,
        errors: [] as string[],
        warnings: [] as string[],
      };
    })
    .catch((error: unknown) => {
      const endTime = new Date();
      const message = error instanceof Error ? error.message : String(error);
      return {
        jobType,
        startTime,
        endTime,
        duration: endTime.getTime() - startTime.getTime(),
        success: false,
        processed: 0,
        errors: [message],
        warnings: [] as string[],
      };
    });
}

/**
 * Dispatch map: schedule job name → runner. Kept in sync with createBatchSchedulerJobRunners.
 */
function dispatchManualJob(
  jobType: ManualBatchSchedulerJobType,
  runners: BatchSchedulerJobRunners
): Promise<BatchJobResult> {
  switch (jobType) {
    case 'cleanup':
      return runners.runMemoryCleanup();
    case 'monitoring':
      return runners.runMonitoring();
    case 'healthcheck':
      return runners.runHealthCheck();
    case 'consolidation_score_incremental':
      return runners.runConsolidationScoreIncremental();
    case 'consolidation_score_full_sweep':
      return runners.runConsolidationScoreFullSweep();
    case 'weekly_relation_validation':
      return runners.runWeeklyRelationValidation();
    case 'log_rotation':
      return runners.runLogRotation();
    case 'triple_extraction_batch':
      return runners.runTripleExtractionBatch();
    case 'quality_measurement_batch':
      return runners.runQualityMeasurementBatch();
    case 'meta_memory_introspection':
      return runners.runMetaMemoryIntrospection();
    case 'memory_review_candidates':
      return runners.runMemoryReviewCandidatesJob();
    case 'sleep_consolidation_batch':
      return runners.runSleepConsolidationBatch();
    case 'telemetry_cleanup_batch':
      return wrapVoidRunner(jobType, () => runners.runTelemetryCleanupBatch());
    case 'forgetting_event_cleanup_batch':
      return wrapVoidRunner(jobType, () => runners.runForgettingEventCleanupBatch());
    case 'job_run_cleanup_batch':
      return wrapVoidRunner(jobType, () => runners.runJobRunCleanupBatch());
    case 'anchor_auto_refresh':
      return runners.runAnchorAutoRefresh();
    default:
      throw new Error(`Unknown job type: ${jobType satisfies never}`);
  }
}

export async function runManualBatchSchedulerJob(
  jobType: ManualBatchSchedulerJobType,
  runners: BatchSchedulerJobRunners
): Promise<BatchJobResult> {
  return dispatchManualJob(jobType, runners);
}
