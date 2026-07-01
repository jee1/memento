import type Database from 'better-sqlite3';
import { mementoConfig } from '../../../shared/config/index.js';
import type { ForgettingPolicyService } from '../../../domains/forgetting/services/forgetting-policy-service.js';
import type { PerformanceMonitor } from '../../../domains/monitoring/services/performance-monitor.js';
import type { IntrospectionScanCache } from '../../../domains/memory/services/introspection-scan-cache.js';
import type { SleepConsolidationService } from '../../../domains/consolidation/services/sleep-consolidation-service.js';
import type { TelemetryRepository } from '../../../domains/telemetry/repositories/telemetry-repository.js';
import type { AnchorManager } from '../../../domains/anchor/services/anchor/anchor-manager.js';
import type { ConsolidationScoreWorker } from '../../../workers/consolidation-score-worker.js';
import type { BatchJobConfig, BatchJobResult } from '../batch-scheduler-types.js';
import type { BatchJobExecutionCoordinator } from '../batch-job-execution-coordinator.js';
import type { JobQueue } from '../job-queue.js';
import type { HealthChecker } from '../health-checker.js';
import type { FileLogger } from '../file-logger.js';
import type { RelationValidatorExecutor } from '../relation-validator-executor.js';
import type { TripleExtractionBatchJob } from '../jobs/triple-extraction-batch-job.js';
import type { QualityMeasurementBatchJob } from '../jobs/quality-measurement-batch-job.js';
import type { SleepConsolidationBatchJob } from '../jobs/sleep-consolidation-batch-job.js';
import type { TelemetryCleanupBatchJob } from '../jobs/telemetry-cleanup-batch-job.js';
import type {
  BatchSchedulerLogMethod,
  BatchSchedulerRunContext,
  MutableJobRef
} from '../handlers/batch-scheduler-run-context.js';
import type { BatchRecurringScheduleContext } from '../batch-recurring-schedules.js';

export interface BatchSchedulerContextSource {
  db: Database.Database | null;
  config: BatchJobConfig;
  forgettingService: ForgettingPolicyService;
  performanceMonitor: PerformanceMonitor;
  healthChecker: HealthChecker;
  jobQueue: JobQueue;
  fileLogger: FileLogger;
  relationValidatorExecutor: RelationValidatorExecutor;
  consolidationScoreWorker: ConsolidationScoreWorker | null;
  introspectionScanCache: IntrospectionScanCache | null;
  sleepConsolidationService: SleepConsolidationService | null;
  telemetryCleanupRepository: TelemetryRepository | null;
  tripleExtractionBatchJob: TripleExtractionBatchJob | null;
  qualityMeasurementBatchJob: QualityMeasurementBatchJob | null;
  sleepConsolidationBatchJob: SleepConsolidationBatchJob | null;
  telemetryCleanupBatchJob: TelemetryCleanupBatchJob | null;
  lastExecution: Map<string, Date>;
  totalExecutions: Map<string, number>;
  anchorManager: AnchorManager | null;
  log: BatchSchedulerLogMethod;
  emitMemoryReviewCandidatesRunRecord: (result: BatchJobResult) => Promise<void>;
}

export interface BatchSchedulerRecurringContextSource extends BatchSchedulerContextSource {
  consolidationScoreEnabled: boolean;
  intervals: Map<string, ReturnType<typeof setInterval>>;
  jobExecutionCoordinator: BatchJobExecutionCoordinator;
  scheduleJob: (name: string, interval: number, job: () => Promise<void>, priority: number) => void;
  runMemoryCleanup: () => Promise<BatchJobResult>;
  runMonitoring: () => Promise<BatchJobResult>;
  runHealthCheck: () => Promise<BatchJobResult>;
  runConsolidationScoreIncremental: () => Promise<BatchJobResult>;
  runConsolidationScoreFullSweep: () => Promise<BatchJobResult>;
  runWeeklyRelationValidation: () => Promise<BatchJobResult>;
  runLogRotation: () => Promise<BatchJobResult>;
  runTripleExtractionBatch: () => Promise<BatchJobResult>;
  runQualityMeasurementBatch: () => Promise<BatchJobResult>;
  runMetaMemoryIntrospection: () => Promise<BatchJobResult>;
  runMemoryReviewCandidatesJob: () => Promise<BatchJobResult>;
  runSleepConsolidationBatch: () => Promise<BatchJobResult>;
  runTelemetryCleanupBatch: () => Promise<void>;
  runAnchorAutoRefresh: () => Promise<BatchJobResult>;
}

function createMutableJobRef<T>(
  getValue: () => T | null,
  setValue: (value: T | null) => void
): MutableJobRef<T> {
  return {
    get current() {
      return getValue();
    },
    set current(v) {
      setValue(v);
    }
  };
}

export function buildBatchSchedulerRunContext(source: BatchSchedulerContextSource): BatchSchedulerRunContext {
  return {
    db: source.db,
    config: source.config,
    forgettingService: source.forgettingService,
    performanceMonitor: source.performanceMonitor,
    healthChecker: source.healthChecker,
    jobQueue: source.jobQueue,
    fileLogger: source.fileLogger,
    relationValidatorExecutor: source.relationValidatorExecutor,
    consolidationScoreWorker: source.consolidationScoreWorker,
    introspectionScanCache: source.introspectionScanCache,
    sleepConsolidationService: source.sleepConsolidationService,
    telemetryCleanupRepository: source.telemetryCleanupRepository,
    tripleExtractionBatchJob: createMutableJobRef(
      () => source.tripleExtractionBatchJob,
      v => { source.tripleExtractionBatchJob = v; }
    ),
    qualityMeasurementBatchJob: createMutableJobRef(
      () => source.qualityMeasurementBatchJob,
      v => { source.qualityMeasurementBatchJob = v; }
    ),
    sleepConsolidationBatchJob: createMutableJobRef(
      () => source.sleepConsolidationBatchJob,
      v => { source.sleepConsolidationBatchJob = v; }
    ),
    telemetryCleanupBatchJob: createMutableJobRef(
      () => source.telemetryCleanupBatchJob,
      v => { source.telemetryCleanupBatchJob = v; }
    ),
    lastExecution: source.lastExecution,
    totalExecutions: source.totalExecutions,
    anchorManager: source.anchorManager,
    log: source.log,
    emitMemoryReviewCandidatesRunRecord: source.emitMemoryReviewCandidatesRunRecord
  };
}

export function buildBatchRecurringScheduleContext(
  source: BatchSchedulerRecurringContextSource
): BatchRecurringScheduleContext {
  return {
    config: source.config,
    consolidationScoreEnabled: mementoConfig.consolidationScoreEnabled,
    hasConsolidationScoreWorker: source.consolidationScoreWorker !== null,
    hasSleepConsolidation: source.sleepConsolidationService != null,
    hasTelemetryCleanup: source.telemetryCleanupRepository != null,
    hasAnchorManager: source.anchorManager != null,
    scheduleJob: source.scheduleJob,
    lastExecution: source.lastExecution,
    intervals: source.intervals,
    jobExecutionCoordinator: source.jobExecutionCoordinator,
    log: (message, data, level) => source.log(message, data, level ?? 'info'),
    runMemoryCleanup: () => source.runMemoryCleanup(),
    runMonitoring: () => source.runMonitoring(),
    runHealthCheck: () => source.runHealthCheck(),
    runConsolidationScoreIncremental: () => source.runConsolidationScoreIncremental(),
    runConsolidationScoreFullSweep: () => source.runConsolidationScoreFullSweep(),
    runWeeklyRelationValidation: () => source.runWeeklyRelationValidation(),
    runLogRotation: () => source.runLogRotation(),
    runTripleExtractionBatch: () => source.runTripleExtractionBatch(),
    runQualityMeasurementBatch: () => source.runQualityMeasurementBatch(),
    runMetaMemoryIntrospection: () => source.runMetaMemoryIntrospection(),
    runMemoryReviewCandidatesJob: () => source.runMemoryReviewCandidatesJob(),
    runSleepConsolidationBatch: () => source.runSleepConsolidationBatch(),
    runTelemetryCleanupBatch: () => source.runTelemetryCleanupBatch(),
    runAnchorAutoRefresh: () => source.runAnchorAutoRefresh()
  };
}
