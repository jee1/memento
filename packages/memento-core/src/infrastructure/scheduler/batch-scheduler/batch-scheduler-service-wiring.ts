import type Database from 'better-sqlite3';
import { ForgettingPolicyService } from '../../../domains/forgetting/services/forgetting-policy-service.js';
import { getPerformanceMonitor } from '../../../domains/monitoring/services/performance-monitor.js';
import type { RuntimeDiagnosticsLogger } from '../../../domains/monitoring/services/runtime-diagnostics-logger.js';
import { ConsolidationScoreWorker } from '../../../workers/consolidation-score-worker.js';
import type { IntrospectionScanCache } from '../../../domains/memory/introspection/introspection-scan-cache.js';
import type { SleepConsolidationService } from '../../../domains/consolidation/services/sleep-consolidation-service.js';
import type { TelemetryRepository } from '../../../domains/telemetry/repositories/telemetry-repository.js';
import type { AnchorManager } from '../../../domains/anchor/services/anchor/anchor-manager.js';
import { mementoConfig } from '../../../shared/config/index.js';
import type { BatchJobConfig, BatchJobResult } from './batch-scheduler-types.js';
import { validateBatchJobConfig } from './batch-scheduler-validate-config.js';
import { mergeBatchSchedulerJobConfig } from './batch-scheduler-default-config.js';
import { BatchJobExecutionCoordinator } from './batch-job-execution-coordinator.js';
import { JobQueue } from '../job-queue.js';
import { RetryManager } from '../retry-manager.js';
import { HealthChecker } from '../health-checker.js';
import { FileLogger } from '../file-logger.js';
import { RelationValidatorExecutor } from '../relation-validator-executor.js';
import type { BatchSchedulerLogMethod } from '../handlers/batch-scheduler-run-context.js';
import {
  buildBatchRecurringScheduleContext,
  type BatchSchedulerContextSource,
  type BatchSchedulerRecurringContextSource
} from './batch-scheduler-context.js';
import {
  emitMemoryReviewCandidatesRunRecord,
  writeBatchSchedulerDiagnosticsEvent
} from './batch-scheduler-diagnostics.js';
import { logBatchSchedulerMessage } from './batch-scheduler-logging.js';
import type { BatchJobExecutionCoordinator as Coordinator } from './batch-job-execution-coordinator.js';

export interface BatchSchedulerDependencyOverrides {
  jobQueue?: JobQueue;
  retryManager?: RetryManager;
  healthChecker?: HealthChecker;
  fileLogger?: FileLogger;
  relationValidatorExecutor?: RelationValidatorExecutor;
  diagnosticsLogger?: Pick<RuntimeDiagnosticsLogger, 'writeEvent'>;
}

export interface BatchSchedulerCoordinatorCallbacks {
  getConfig: () => BatchJobConfig;
  getIsRunning: () => boolean;
  lastExecution: Map<string, Date>;
  totalExecutions: Map<string, number>;
  lastJobRunMeta: Map<string, { at: Date; success: boolean; durationMs: number }>;
  writeDiagnosticsEvent: (event: Record<string, unknown>) => Promise<void>;
  log: BatchSchedulerLogMethod;
  checkSchedulerHealth: () => Promise<void>;
}

export interface BatchSchedulerWiringResult {
  config: BatchJobConfig;
  forgettingService: ForgettingPolicyService;
  performanceMonitor: ReturnType<typeof getPerformanceMonitor>;
  consolidationScoreWorker: ConsolidationScoreWorker | null;
  jobQueue: JobQueue;
  retryManager: RetryManager;
  healthChecker: HealthChecker;
  fileLogger: FileLogger;
  relationValidatorExecutor: RelationValidatorExecutor;
  diagnosticsLogger?: Pick<RuntimeDiagnosticsLogger, 'writeEvent'>;
  jobExecutionCoordinator: Coordinator;
}

export interface BatchSchedulerServiceState {
  db: Database.Database | null;
  config: BatchJobConfig;
  forgettingService: ForgettingPolicyService;
  performanceMonitor: ReturnType<typeof getPerformanceMonitor>;
  healthChecker: HealthChecker;
  jobQueue: JobQueue;
  fileLogger: FileLogger;
  relationValidatorExecutor: RelationValidatorExecutor;
  consolidationScoreWorker: ConsolidationScoreWorker | null;
  introspectionScanCache: IntrospectionScanCache | null;
  sleepConsolidationService: SleepConsolidationService | null;
  telemetryCleanupRepository: TelemetryRepository | null;
  tripleExtractionBatchJob: BatchSchedulerContextSource['tripleExtractionBatchJob'];
  qualityMeasurementBatchJob: BatchSchedulerContextSource['qualityMeasurementBatchJob'];
  sleepConsolidationBatchJob: BatchSchedulerContextSource['sleepConsolidationBatchJob'];
  telemetryCleanupBatchJob: BatchSchedulerContextSource['telemetryCleanupBatchJob'];
  forgettingEventCleanupBatchJob: BatchSchedulerContextSource['forgettingEventCleanupBatchJob'];
  lastExecution: Map<string, Date>;
  totalExecutions: Map<string, number>;
  anchorManager: AnchorManager | null;
  diagnosticsLogger?: Pick<RuntimeDiagnosticsLogger, 'writeEvent'>;
  startTime: Date | null;
}

export interface BatchSchedulerRecurringState {
  intervals: Map<string, ReturnType<typeof setInterval>>;
  jobExecutionCoordinator: Coordinator;
}

export interface BatchSchedulerRecurringCallbacks {
  scheduleJob: (name: string, interval: number, job: () => Promise<void>, priority: number) => void;
  runMemoryCleanup: () => Promise<BatchJobResult>;
  runMemoryReviewCandidatesJob: () => Promise<BatchJobResult>;
  runMonitoring: () => Promise<BatchJobResult>;
  runHealthCheck: () => Promise<BatchJobResult>;
  runConsolidationScoreIncremental: () => Promise<BatchJobResult>;
  runWeeklyRelationValidation: () => Promise<BatchJobResult>;
  runConsolidationScoreFullSweep: () => Promise<BatchJobResult>;
  runTripleExtractionBatch: () => Promise<BatchJobResult>;
  runMetaMemoryIntrospection: () => Promise<BatchJobResult>;
  runQualityMeasurementBatch: () => Promise<BatchJobResult>;
  runLogRotation: () => Promise<BatchJobResult>;
  runSleepConsolidationBatch: () => Promise<BatchJobResult>;
  runTelemetryCleanupBatch: () => Promise<void>;
  runForgettingEventCleanupBatch: () => Promise<void>;
  runAnchorAutoRefresh: () => Promise<BatchJobResult>;
}

export function createBatchSchedulerWiring(
  config: Partial<BatchJobConfig> | undefined,
  dependencies: BatchSchedulerDependencyOverrides | undefined,
  coordinatorCallbacks: BatchSchedulerCoordinatorCallbacks
): BatchSchedulerWiringResult {
  const mergedConfig = mergeBatchSchedulerJobConfig(config);
  validateBatchJobConfig(mergedConfig);

  const forgettingService = new ForgettingPolicyService();
  const performanceMonitor = getPerformanceMonitor();

  const consolidationScoreWorker = mementoConfig.consolidationScoreEnabled
    ? new ConsolidationScoreWorker()
    : null;

  const jobQueue = dependencies?.jobQueue ?? new JobQueue();
  const retryManager = dependencies?.retryManager ?? new RetryManager({
    maxAttempts: mergedConfig.retryAttempts,
    baseDelay: mergedConfig.retryDelay,
    maxErrorCount: mergedConfig.retryAttempts * 3
  });
  const healthChecker = dependencies?.healthChecker ?? new HealthChecker();
  const fileLogger = dependencies?.fileLogger ?? new FileLogger({
    enabled: mergedConfig.enableLogging
  });
  const relationValidatorExecutor = dependencies?.relationValidatorExecutor ?? new RelationValidatorExecutor({
    timeout: mergedConfig.weeklyRelationValidationTimeout ?? mergedConfig.jobTimeout
  });
  const diagnosticsLogger = dependencies?.diagnosticsLogger;

  const jobExecutionCoordinator = new BatchJobExecutionCoordinator({
    jobQueue,
    retryManager,
    getConfig: coordinatorCallbacks.getConfig,
    getIsRunning: coordinatorCallbacks.getIsRunning,
    lastExecution: coordinatorCallbacks.lastExecution,
    totalExecutions: coordinatorCallbacks.totalExecutions,
    lastJobRunMeta: coordinatorCallbacks.lastJobRunMeta,
    writeDiagnosticsEvent: coordinatorCallbacks.writeDiagnosticsEvent,
    log: coordinatorCallbacks.log,
    checkSchedulerHealth: coordinatorCallbacks.checkSchedulerHealth
  });

  return {
    config: mergedConfig,
    forgettingService,
    performanceMonitor,
    consolidationScoreWorker,
    jobQueue,
    retryManager,
    healthChecker,
    fileLogger,
    relationValidatorExecutor,
    diagnosticsLogger,
    jobExecutionCoordinator
  };
}

export function getBatchSchedulerContextSource(
  state: BatchSchedulerServiceState,
  log: BatchSchedulerLogMethod,
  emitMemoryReviewCandidatesRunRecordFn: (result: BatchJobResult) => Promise<void>
): BatchSchedulerContextSource {
  return {
    db: state.db,
    config: state.config,
    forgettingService: state.forgettingService,
    performanceMonitor: state.performanceMonitor,
    healthChecker: state.healthChecker,
    jobQueue: state.jobQueue,
    fileLogger: state.fileLogger,
    relationValidatorExecutor: state.relationValidatorExecutor,
    consolidationScoreWorker: state.consolidationScoreWorker,
    introspectionScanCache: state.introspectionScanCache,
    sleepConsolidationService: state.sleepConsolidationService,
    telemetryCleanupRepository: state.telemetryCleanupRepository,
    tripleExtractionBatchJob: state.tripleExtractionBatchJob,
    qualityMeasurementBatchJob: state.qualityMeasurementBatchJob,
    sleepConsolidationBatchJob: state.sleepConsolidationBatchJob,
    telemetryCleanupBatchJob: state.telemetryCleanupBatchJob,
    forgettingEventCleanupBatchJob: state.forgettingEventCleanupBatchJob,
    lastExecution: state.lastExecution,
    totalExecutions: state.totalExecutions,
    anchorManager: state.anchorManager,
    log,
    emitMemoryReviewCandidatesRunRecord: emitMemoryReviewCandidatesRunRecordFn
  };
}

export function getBatchSchedulerRecurringContextSource(
  state: BatchSchedulerServiceState,
  recurringState: BatchSchedulerRecurringState,
  callbacks: BatchSchedulerRecurringCallbacks,
  log: BatchSchedulerLogMethod,
  emitMemoryReviewCandidatesRunRecordFn: (result: BatchJobResult) => Promise<void>
): BatchSchedulerRecurringContextSource {
  return {
    ...getBatchSchedulerContextSource(state, log, emitMemoryReviewCandidatesRunRecordFn),
    consolidationScoreEnabled: mementoConfig.consolidationScoreEnabled,
    intervals: recurringState.intervals,
    jobExecutionCoordinator: recurringState.jobExecutionCoordinator,
    ...callbacks
  };
}

export function buildBatchSchedulerRecurringScheduleContextFromSource(
  source: BatchSchedulerRecurringContextSource
) {
  return buildBatchRecurringScheduleContext(source);
}

export function getBatchSchedulerLoggingDeps(state: BatchSchedulerServiceState) {
  return {
    enableLogging: state.config.enableLogging,
    startTime: state.startTime,
    jobQueue: state.jobQueue,
    fileLogger: state.fileLogger
  };
}

export function getBatchSchedulerIntervalDeps(
  recurringState: BatchSchedulerRecurringState,
  jobQueue: JobQueue,
  log: BatchSchedulerLogMethod
) {
  return {
    jobExecutionCoordinator: recurringState.jobExecutionCoordinator,
    intervals: recurringState.intervals,
    jobQueue,
    log
  };
}

export async function writeBatchSchedulerDiagnostics(
  diagnosticsLogger: Pick<RuntimeDiagnosticsLogger, 'writeEvent'> | undefined,
  event: Record<string, unknown>
): Promise<void> {
  await writeBatchSchedulerDiagnosticsEvent(diagnosticsLogger, event);
}

export async function emitBatchSchedulerMemoryReviewCandidatesRunRecord(
  deps: {
    diagnosticsLogger?: Pick<RuntimeDiagnosticsLogger, 'writeEvent'>;
    log: BatchSchedulerLogMethod;
    writeDiagnosticsEvent: (event: Record<string, unknown>) => Promise<void>;
  },
  result: BatchJobResult
): Promise<void> {
  await emitMemoryReviewCandidatesRunRecord(deps, result);
}

export function logBatchScheduler(
  state: BatchSchedulerServiceState,
  message: string,
  data?: unknown,
  level: 'info' | 'warn' | 'error' = 'info'
): void {
  logBatchSchedulerMessage(getBatchSchedulerLoggingDeps(state), message, data, level);
}

export function setBatchSchedulerIntrospectionScanCache(
  state: BatchSchedulerServiceState,
  cache: IntrospectionScanCache | null
): void {
  state.introspectionScanCache = cache;
}

export function setBatchSchedulerSleepConsolidationService(
  state: BatchSchedulerServiceState,
  service: SleepConsolidationService | null
): void {
  state.sleepConsolidationService = service;
  state.sleepConsolidationBatchJob = null;
}

export function setBatchSchedulerTelemetryCleanupRepository(
  state: BatchSchedulerServiceState,
  repository: TelemetryRepository | null
): void {
  state.telemetryCleanupRepository = repository;
  state.telemetryCleanupBatchJob = null;
}

export function setBatchSchedulerDiagnosticsLogger(
  state: BatchSchedulerServiceState,
  logger: Pick<RuntimeDiagnosticsLogger, 'writeEvent'> | undefined
): void {
  state.diagnosticsLogger = logger;
}

export function setBatchSchedulerAnchorManager(
  state: BatchSchedulerServiceState,
  anchorManager: AnchorManager | null
): void {
  state.anchorManager = anchorManager;
}
