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
  runForgettingEventCleanupBatch
} from '../handlers/batch-scheduler-sleep-telemetry-handlers.js';
import { runAnchorAutoRefresh } from '../handlers/batch-scheduler-anchor-handlers.js';
import {
  buildBatchSchedulerRunContext,
  type BatchSchedulerContextSource
} from './batch-scheduler-context.js';

export type ManualBatchSchedulerJobType =
  | 'cleanup'
  | 'monitoring'
  | 'healthcheck'
  | 'meta_memory_introspection'
  | 'memory_review_candidates'
  | 'anchor_auto_refresh';

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
    runAnchorAutoRefresh: () => runAnchorAutoRefresh(ctx())
  };
}

export type BatchSchedulerJobRunners = ReturnType<typeof createBatchSchedulerJobRunners>;

export async function runManualBatchSchedulerJob(
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
    case 'meta_memory_introspection':
      return runners.runMetaMemoryIntrospection();
    case 'memory_review_candidates':
      return runners.runMemoryReviewCandidatesJob();
    case 'anchor_auto_refresh':
      return runners.runAnchorAutoRefresh();
    default:
      throw new Error(`Unknown job type: ${jobType satisfies never}`);
  }
}
