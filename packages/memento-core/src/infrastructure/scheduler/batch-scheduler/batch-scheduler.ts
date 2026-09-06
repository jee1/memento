/* Batch job scheduler: async augmentation pipeline. See docs/architecture/async-augmentation-pipeline.md */

import type { IBatchScheduler } from '../../../shared/interfaces/batch-scheduler.interface.js';
import type { RuntimeDiagnosticsLogger } from '../../../domains/monitoring/services/runtime-diagnostics-logger.js';
import Database from 'better-sqlite3';
import type { IReflexionWorker } from '../../../shared/interfaces/reflexion-worker.interface.js';
import { JobQueue } from '../job-queue.js';
import { RetryManager } from '../retry-manager.js';
import { HealthChecker } from '../health-checker.js';
import { FileLogger } from '../file-logger.js';
import { RelationValidatorExecutor } from '../relation-validator-executor.js';
import type { SleepConsolidationService } from '../../../domains/consolidation/services/sleep-consolidation-service.js';
import type { TelemetryRepository } from '../../../domains/telemetry/repositories/telemetry-repository.js';
import type { IntrospectionScanCache } from '../../../domains/memory/introspection/introspection-scan-cache.js';
import type { AnchorManager } from '../../../domains/anchor/services/anchor/anchor-manager.js';
import { CheckpointMode, type WalCheckpointScheduler } from '../../database/wal-checkpoint-scheduler.js';
import type { DatabaseLockMonitor } from '../../database/database-lock-monitor.js';
import type { BatchJobConfig, BatchJobResult, SchedulerStatus } from './batch-scheduler-types.js';
export type { BatchJobConfig, BatchJobResult, SchedulerStatus } from './batch-scheduler-types.js';
import { startBatchScheduler, stopBatchScheduler } from './batch-scheduler-lifecycle.js';
import {
  createBatchSchedulerWiring,
  emitBatchSchedulerMemoryReviewCandidatesRunRecord,
  getBatchSchedulerContextSource,
  getBatchSchedulerRecurringContextSource,
  logBatchScheduler,
  writeBatchSchedulerDiagnostics,
  type BatchSchedulerDependencyOverrides,
  type BatchSchedulerRecurringState,
  type BatchSchedulerServiceState
} from './batch-scheduler-service-wiring.js';
import {
  addBatchSchedulerJob,
  clearBatchSchedulerJobProcessorInterval,
  createBatchSchedulerJobRunnerCallbacks,
  scheduleBatchSchedulerJob,
  startBatchSchedulerJobProcessor,
  waitForBatchSchedulerJobs,
  type BatchSchedulerJobProcessorState,
  type ManualBatchSchedulerJobType
} from './batch-scheduler-job-processor.js';
import {
  isBatchSchedulerJobQueued,
  isBatchSchedulerJobRunning,
  restartBatchSchedulerJob,
  runBatchSchedulerJob,
  stopBatchSchedulerJob
} from './batch-scheduler-job-control.js';
import {
  checkBatchSchedulerSchedulerHealth,
  getBatchSchedulerDetailedStatsReport,
  getBatchSchedulerLastJobRunMeta,
  getBatchSchedulerStatus,
  updateBatchSchedulerConfig,
  type BatchSchedulerStatusState
} from './batch-scheduler-status.js';

export type { ManualBatchSchedulerJobType };

/** Async augmentation pipeline worker; groups config, intervals, and failure handling. */
export class BatchScheduler implements IBatchScheduler {
  private config: BatchJobConfig;
  private forgettingService: BatchSchedulerServiceState['forgettingService'];
  private performanceMonitor: BatchSchedulerServiceState['performanceMonitor'];
  private consolidationScoreWorker: BatchSchedulerServiceState['consolidationScoreWorker'];
  private reflexionWorker: IReflexionWorker | null = null;
  private walCheckpointScheduler: Pick<WalCheckpointScheduler, 'checkpointNow'> | null = null;
  private databaseLockMonitor: Pick<DatabaseLockMonitor, 'probe'> | null = null;
  private db: Database.Database | null = null;
  private intervals: Map<string, ReturnType<typeof setInterval>> = new Map();
  private isRunning = false;
  private startTime: Date | null = null;
  private lastExecution: Map<string, Date> = new Map();
  private lastJobRunMeta: Map<string, { at: Date; success: boolean; durationMs: number }> = new Map();
  private totalExecutions: Map<string, number> = new Map();
  private introspectionScanCache: IntrospectionScanCache | null = null;
  private jobProcessorState: BatchSchedulerJobProcessorState = { jobProcessorInterval: null };

  private jobQueue: JobQueue;
  private retryManager: RetryManager;
  private healthChecker: HealthChecker;
  private fileLogger: FileLogger;
  private relationValidatorExecutor: RelationValidatorExecutor;
  private tripleExtractionBatchJob: BatchSchedulerServiceState['tripleExtractionBatchJob'] = null;
  private qualityMeasurementBatchJob: BatchSchedulerServiceState['qualityMeasurementBatchJob'] = null;
  private sleepConsolidationService: SleepConsolidationService | null = null;
  private sleepConsolidationBatchJob: BatchSchedulerServiceState['sleepConsolidationBatchJob'] = null;
  private telemetryCleanupRepository: TelemetryRepository | null = null;
  private telemetryCleanupBatchJob: BatchSchedulerServiceState['telemetryCleanupBatchJob'] = null;
  private forgettingEventCleanupBatchJob: BatchSchedulerServiceState['forgettingEventCleanupBatchJob'] = null;
  private diagnosticsLogger?: Pick<RuntimeDiagnosticsLogger, 'writeEvent'>;
  private anchorManager: AnchorManager | null = null;
  private jobExecutionCoordinator!: ReturnType<typeof createBatchSchedulerWiring>['jobExecutionCoordinator'];

  constructor(
    config?: Partial<BatchJobConfig>,
    dependencies?: BatchSchedulerDependencyOverrides
  ) {
    const wiring = createBatchSchedulerWiring(config, dependencies, {
      getConfig: () => this.config,
      getIsRunning: () => this.isRunning,
      lastExecution: this.lastExecution,
      totalExecutions: this.totalExecutions,
      lastJobRunMeta: this.lastJobRunMeta,
      writeDiagnosticsEvent: e => this.writeDiagnosticsEvent(e),
      log: (m, d, l) => this.log(m, d, l),
      checkSchedulerHealth: () => this.checkSchedulerHealth()
    });

    this.config = wiring.config;
    this.forgettingService = wiring.forgettingService;
    this.performanceMonitor = wiring.performanceMonitor;
    this.consolidationScoreWorker = wiring.consolidationScoreWorker;
    this.jobQueue = wiring.jobQueue;
    this.retryManager = wiring.retryManager;
    this.healthChecker = wiring.healthChecker;
    this.fileLogger = wiring.fileLogger;
    this.relationValidatorExecutor = wiring.relationValidatorExecutor;
    this.diagnosticsLogger = wiring.diagnosticsLogger;
    this.jobExecutionCoordinator = wiring.jobExecutionCoordinator;
  }

  private getServiceState(): BatchSchedulerServiceState {
    return {
      db: this.db,
      config: this.config,
      forgettingService: this.forgettingService,
      performanceMonitor: this.performanceMonitor,
      healthChecker: this.healthChecker,
      jobQueue: this.jobQueue,
      fileLogger: this.fileLogger,
      relationValidatorExecutor: this.relationValidatorExecutor,
      consolidationScoreWorker: this.consolidationScoreWorker,
      introspectionScanCache: this.introspectionScanCache,
      sleepConsolidationService: this.sleepConsolidationService,
      telemetryCleanupRepository: this.telemetryCleanupRepository,
      tripleExtractionBatchJob: this.tripleExtractionBatchJob,
      qualityMeasurementBatchJob: this.qualityMeasurementBatchJob,
      sleepConsolidationBatchJob: this.sleepConsolidationBatchJob,
      telemetryCleanupBatchJob: this.telemetryCleanupBatchJob,
      forgettingEventCleanupBatchJob: this.forgettingEventCleanupBatchJob,
      lastExecution: this.lastExecution,
      totalExecutions: this.totalExecutions,
      anchorManager: this.anchorManager,
      diagnosticsLogger: this.diagnosticsLogger,
      startTime: this.startTime
    };
  }

  private getRecurringState(): BatchSchedulerRecurringState {
    return {
      intervals: this.intervals,
      jobExecutionCoordinator: this.jobExecutionCoordinator
    };
  }

  private getStatusState(): BatchSchedulerStatusState {
    return {
      isRunning: this.isRunning,
      intervals: this.intervals,
      lastExecution: this.lastExecution,
      totalExecutions: this.totalExecutions,
      startTime: this.startTime,
      config: this.config
    };
  }

  private getJobRunnerCallbacks() {
    return {
      scheduleJob: (name: string, interval: number, job: () => Promise<void>, priority: number) =>
        this.scheduleJob(name, interval, job, priority),
      runMemoryCleanup: () => this.runMemoryCleanup(),
      runMemoryReviewCandidatesJob: () => this.runMemoryReviewCandidatesJob(),
      runMonitoring: () => this.runMonitoring(),
      runHealthCheck: () => this.runHealthCheck(),
      runConsolidationScoreIncremental: () => this.runConsolidationScoreIncremental(),
      runWeeklyRelationValidation: () => this.runWeeklyRelationValidation(),
      runConsolidationScoreFullSweep: () => this.runConsolidationScoreFullSweep(),
      runTripleExtractionBatch: () => this.runTripleExtractionBatch(),
      runMetaMemoryIntrospection: () => this.runMetaMemoryIntrospection(),
      runQualityMeasurementBatch: () => this.runQualityMeasurementBatch(),
      runLogRotation: () => this.runLogRotation(),
      runSleepConsolidationBatch: () => this.runSleepConsolidationBatch(),
      runTelemetryCleanupBatch: () => this.runTelemetryCleanupBatch(),
      runForgettingEventCleanupBatch: () => this.runForgettingEventCleanupBatch(),
      runAnchorAutoRefresh: () => this.runAnchorAutoRefresh()
    };
  }

  private getRecurringContextSource() {
    return getBatchSchedulerRecurringContextSource(
      this.getServiceState(),
      this.getRecurringState(),
      this.getJobRunnerCallbacks(),
      this.log.bind(this),
      this.emitMemoryReviewCandidatesRunRecord.bind(this)
    );
  }

  async start(
    db: Database.Database,
    reflexionWorker?: IReflexionWorker,
    registerBatchJobs = true
  ): Promise<void> {
    if (this.isRunning) {
      throw new Error('BatchScheduler is already running');
    }

    await startBatchScheduler({
      config: this.config,
      jobQueue: this.jobQueue,
      healthChecker: this.healthChecker,
      performanceMonitor: this.performanceMonitor,
      log: this.log.bind(this),
      writeDiagnosticsEvent: e => this.writeDiagnosticsEvent(e),
      getRecurringContextSource: () => this.getRecurringContextSource(),
      startJobProcessor: () => this.startJobProcessor(),
      setState: ({ db: nextDb, isRunning, startTime, reflexionWorker: worker }) => {
        this.db = nextDb;
        this.isRunning = isRunning;
        this.startTime = startTime;
        this.reflexionWorker = worker ?? null;
      }
    }, db, reflexionWorker, registerBatchJobs);

    this.scheduleInfrastructureMaintenanceJobs();
  }

  private scheduleInfrastructureMaintenanceJobs(): void {
    const walCheckpointScheduler = this.walCheckpointScheduler;
    if (walCheckpointScheduler) {
      this.scheduleJob('wal_checkpoint', this.config.walCheckpointInterval, async () => {
        const result = await walCheckpointScheduler.checkpointNow(CheckpointMode.PASSIVE);
        if (!result.success) {
          throw result.error ?? new Error(`WAL checkpoint failed: busy=${result.busy}`);
        }
      }, 2);
    }

    const databaseLockMonitor = this.databaseLockMonitor;
    if (databaseLockMonitor) {
      this.scheduleJob('lock_monitor', this.config.lockMonitorInterval, async () => {
        await databaseLockMonitor.probe();
      }, 2);
    }

    const reflexionWorker = this.reflexionWorker;
    if (reflexionWorker) {
      this.scheduleJob('reflexion_cleanup', this.config.reflexionCleanupInterval, async () => {
        reflexionWorker.cleanupDuplicateWindow();
      }, 3);
      this.scheduleJob('reflexion_healthcheck', this.config.reflexionHealthCheckInterval, async () => {
        reflexionWorker.performHealthCheck();
      }, 3);
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    await stopBatchScheduler({
      intervals: this.intervals,
      jobQueue: this.jobQueue,
      startTime: this.startTime,
      log: this.log.bind(this),
      writeDiagnosticsEvent: e => this.writeDiagnosticsEvent(e),
      waitForRunningJobs: () => this.waitForRunningJobs(),
      clearJobProcessorInterval: () => clearBatchSchedulerJobProcessorInterval(this.jobProcessorState),
      setIsRunning: isRunning => { this.isRunning = isRunning; }
    });
  }

  public addJob(name: string, job: () => Promise<void>, priority: number = 10, retryCount: number = 0): boolean {
    return addBatchSchedulerJob(
      this.jobExecutionCoordinator,
      this.jobProcessorState,
      name,
      job,
      priority,
      retryCount
    );
  }

  private scheduleJob(name: string, interval: number, job: () => Promise<void>, priority: number): void {
    scheduleBatchSchedulerJob(
      this.getRecurringState(),
      this.jobQueue,
      this.log.bind(this),
      name,
      interval,
      job,
      priority
    );
  }

  private startJobProcessor(): void {
    startBatchSchedulerJobProcessor(this.jobExecutionCoordinator, this.jobProcessorState);
  }

  private async waitForRunningJobs(): Promise<void> {
    await waitForBatchSchedulerJobs(this.getRecurringState(), this.jobQueue, this.log.bind(this));
  }

  private async writeDiagnosticsEvent(event: Record<string, unknown>): Promise<void> {
    await writeBatchSchedulerDiagnostics(this.diagnosticsLogger, event);
  }

  private async emitMemoryReviewCandidatesRunRecord(result: BatchJobResult): Promise<void> {
    await emitBatchSchedulerMemoryReviewCandidatesRunRecord(
      {
        diagnosticsLogger: this.diagnosticsLogger,
        log: this.log.bind(this),
        writeDiagnosticsEvent: e => this.writeDiagnosticsEvent(e)
      },
      result
    );
  }

  private getJobRunners() {
    return createBatchSchedulerJobRunnerCallbacks(this.getContextSource());
  }

  private async runMemoryCleanup(): Promise<BatchJobResult> {
    return this.getJobRunners().runMemoryCleanup();
  }

  private async runMemoryReviewCandidatesJob(): Promise<BatchJobResult> {
    return this.getJobRunners().runMemoryReviewCandidatesJob();
  }

  private async runMonitoring(): Promise<BatchJobResult> {
    return this.getJobRunners().runMonitoring();
  }

  private async runHealthCheck(): Promise<BatchJobResult> {
    return this.getJobRunners().runHealthCheck();
  }

  private async runConsolidationScoreIncremental(): Promise<BatchJobResult> {
    return this.getJobRunners().runConsolidationScoreIncremental();
  }

  private async runWeeklyRelationValidation(): Promise<BatchJobResult> {
    return this.getJobRunners().runWeeklyRelationValidation();
  }

  private async runConsolidationScoreFullSweep(): Promise<BatchJobResult> {
    return this.getJobRunners().runConsolidationScoreFullSweep();
  }

  private async runTripleExtractionBatch(): Promise<BatchJobResult> {
    return this.getJobRunners().runTripleExtractionBatch();
  }

  private async runMetaMemoryIntrospection(): Promise<BatchJobResult> {
    return this.getJobRunners().runMetaMemoryIntrospection();
  }

  private async runQualityMeasurementBatch(): Promise<BatchJobResult> {
    return this.getJobRunners().runQualityMeasurementBatch();
  }

  private async runLogRotation(): Promise<BatchJobResult> {
    return this.getJobRunners().runLogRotation();
  }

  private async runSleepConsolidationBatch(): Promise<BatchJobResult> {
    return this.getJobRunners().runSleepConsolidationBatch();
  }

  private async runTelemetryCleanupBatch(): Promise<void> {
    return this.getJobRunners().runTelemetryCleanupBatch();
  }

  private async runForgettingEventCleanupBatch(): Promise<void> {
    return this.getJobRunners().runForgettingEventCleanupBatch();
  }

  private async runAnchorAutoRefresh(): Promise<BatchJobResult> {
    return this.getJobRunners().runAnchorAutoRefresh();
  }

  private log(message: string, data?: unknown, level: 'info' | 'warn' | 'error' = 'info'): void {
    logBatchScheduler(this.getServiceState(), message, data, level);
  }

  async runJob(jobType: ManualBatchSchedulerJobType): Promise<BatchJobResult> {
    return runBatchSchedulerJob(
      jobType,
      this.getContextSource(),
      this.lastExecution,
      this.totalExecutions,
      this.lastJobRunMeta
    );
  }

  private getContextSource() {
    return getBatchSchedulerContextSource(
      this.getServiceState(),
      this.log.bind(this),
      this.emitMemoryReviewCandidatesRunRecord.bind(this)
    );
  }

  getStatus(): SchedulerStatus {
    return getBatchSchedulerStatus(this.getStatusState(), this.retryManager);
  }

  updateConfig(newConfig: Partial<BatchJobConfig>): void {
    this.config = updateBatchSchedulerConfig(this.config, newConfig, this.log.bind(this));
  }

  stopJob(jobName: string): boolean {
    return stopBatchSchedulerJob(this.intervals, this.log.bind(this), jobName);
  }

  restartJob(jobName: string): boolean {
    return restartBatchSchedulerJob(
      this.getServiceState(),
      this.getRecurringState(),
      this.getJobRunnerCallbacks(),
      this.log.bind(this),
      this.emitMemoryReviewCandidatesRunRecord.bind(this),
      jobName
    );
  }

  private async checkSchedulerHealth(): Promise<void> {
    await checkBatchSchedulerSchedulerHealth(
      this.db,
      this.healthChecker,
      this.jobQueue,
      this.config.maxConcurrentJobs,
      this.log.bind(this)
    );
  }

  getDetailedStats() {
    return getBatchSchedulerDetailedStatsReport(this.getStatusState(), this.retryManager, this.jobQueue);
  }

  /** Queue snapshot: running job names (copy). */
  getRunningNames(): string[] {
    return this.jobQueue.getRunningNames();
  }

  /** Queue snapshot: queued job names (copy). */
  getQueuedNames(): string[] {
    return this.jobQueue.getQueuedNames();
  }

  isJobQueued(name: string): boolean {
    return isBatchSchedulerJobQueued(this.jobQueue, name);
  }

  isJobRunning(name: string): boolean {
    return isBatchSchedulerJobRunning(this.jobQueue, name);
  }

  setIntrospectionScanCache(cache: IntrospectionScanCache | null): void {
    this.introspectionScanCache = cache;
  }

  setSleepConsolidationService(service: SleepConsolidationService | null): void {
    this.sleepConsolidationService = service;
    this.sleepConsolidationBatchJob = null;
  }

  setTelemetryCleanupRepository(repository: TelemetryRepository | null): void {
    this.telemetryCleanupRepository = repository;
    this.telemetryCleanupBatchJob = null;
  }

  setDiagnosticsLogger(logger: Pick<RuntimeDiagnosticsLogger, 'writeEvent'> | undefined): void {
    this.diagnosticsLogger = logger;
  }

  setAnchorManager(anchorManager: AnchorManager | null): void {
    this.anchorManager = anchorManager;
  }

  setDatabaseMaintenance(
    walCheckpointScheduler: Pick<WalCheckpointScheduler, 'checkpointNow'> | null,
    databaseLockMonitor: Pick<DatabaseLockMonitor, 'probe'> | null
  ): void {
    this.walCheckpointScheduler = walCheckpointScheduler;
    this.databaseLockMonitor = databaseLockMonitor;
  }

  getLastJobRunMeta(
    name: string
  ): { at: Date; success: boolean; durationMs: number } | undefined {
    return getBatchSchedulerLastJobRunMeta(this.lastJobRunMeta, name);
  }
}

// Singleton helpers live here (not implemented in batch-scheduler-singleton) to avoid
// runtime cycle: singleton → BatchScheduler class ← re-export singleton.
let schedulerInstance: BatchScheduler | null = null;

export function getBatchScheduler(): BatchScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new BatchScheduler();
  }
  return schedulerInstance;
}

export function createBatchScheduler(config?: Partial<BatchJobConfig>): BatchScheduler {
  return new BatchScheduler(config);
}

export function resetBatchScheduler(): void {
  schedulerInstance = null;
}
