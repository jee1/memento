/* Batch job scheduler: async augmentation pipeline. See docs/architecture/async-augmentation-pipeline.md */

import type { IBatchScheduler } from '../../shared/interfaces/batch-scheduler.interface.js';
import { ForgettingPolicyService } from '../../domains/forgetting/services/forgetting-policy-service.js';
import { getPerformanceMonitor } from '../../domains/monitoring/services/performance-monitor.js';
import type { RuntimeDiagnosticsLogger } from '../../domains/monitoring/services/runtime-diagnostics-logger.js';
import Database from 'better-sqlite3';
import { ConsolidationScoreWorker } from '../../workers/consolidation-score-worker.js';
import type { IReflexionWorker } from '../../shared/interfaces/reflexion-worker.interface.js';
import { mementoConfig } from '../../shared/config/index.js';
import { JobQueue } from './job-queue.js';
import { RetryManager } from './retry-manager.js';
import { HealthChecker } from './health-checker.js';
import { FileLogger } from './file-logger.js';
import { RelationValidatorExecutor } from './relation-validator-executor.js';
import { TripleExtractionBatchJob } from './jobs/triple-extraction-batch-job.js';
import { QualityMeasurementBatchJob } from './jobs/quality-measurement-batch-job.js';
import { SleepConsolidationBatchJob } from './jobs/sleep-consolidation-batch-job.js';
import { TelemetryCleanupBatchJob } from './jobs/telemetry-cleanup-batch-job.js';
import type { SleepConsolidationService } from '../../domains/consolidation/services/sleep-consolidation-service.js';
import type { TelemetryRepository } from '../../domains/telemetry/repositories/telemetry-repository.js';
import type { IntrospectionScanCache } from '../../domains/memory/services/introspection-scan-cache.js';
import type { AnchorManager } from '../../domains/anchor/services/anchor/anchor-manager.js';
import type { BatchJobConfig, BatchJobResult, SchedulerStatus } from './batch-scheduler-types.js';
export type { BatchJobConfig, BatchJobResult, SchedulerStatus } from './batch-scheduler-types.js';
import { validateBatchJobConfig } from './batch-scheduler-validate-config.js';
import { mergeBatchSchedulerJobConfig } from './batch-scheduler-default-config.js';
import { BatchJobExecutionCoordinator } from './batch-job-execution-coordinator.js';
import {
  scheduleCleanupJob,
  scheduleHealthcheckJob,
  scheduleMemoryReviewCandidatesInterval,
  scheduleMonitoringJob
} from './batch-recurring-schedules.js';
import { logBatchSchedulerMessage } from './batch-scheduler/batch-scheduler-logging.js';
import {
  buildBatchRecurringScheduleContext,
  type BatchSchedulerContextSource,
  type BatchSchedulerRecurringContextSource
} from './batch-scheduler/batch-scheduler-context.js';
import {
  emitMemoryReviewCandidatesRunRecord as emitMemoryReviewCandidatesRunRecordImpl,
  writeBatchSchedulerDiagnosticsEvent
} from './batch-scheduler/batch-scheduler-diagnostics.js';
import {
  scheduleBatchJob,
  waitForRunningBatchJobs
} from './batch-scheduler/batch-scheduler-interval.js';
import { getBatchSchedulerDetailedStats } from './batch-scheduler/batch-scheduler-stats.js';
import { checkBatchSchedulerHealth } from './batch-scheduler/batch-scheduler-health.js';
import {
  createBatchSchedulerJobRunners,
  runManualBatchSchedulerJob,
  type ManualBatchSchedulerJobType
} from './batch-scheduler/batch-scheduler-job-runners.js';
import { startBatchScheduler, stopBatchScheduler } from './batch-scheduler/batch-scheduler-lifecycle.js';

export {
  getBatchScheduler,
  createBatchScheduler,
  resetBatchScheduler
} from './batch-scheduler/batch-scheduler-singleton.js';

/** Async augmentation pipeline worker; groups config, intervals, and failure handling. */
export class BatchScheduler implements IBatchScheduler {
  private config: BatchJobConfig;
  private forgettingService: ForgettingPolicyService;
  private performanceMonitor: ReturnType<typeof getPerformanceMonitor>;
  private consolidationScoreWorker: ConsolidationScoreWorker | null = null;
  private reflexionWorker: IReflexionWorker | null = null;
  private db: Database.Database | null = null;
  private intervals: Map<string, ReturnType<typeof setInterval>> = new Map();
  private isRunning = false;
  private startTime: Date | null = null;
  private lastExecution: Map<string, Date> = new Map();
  private lastJobRunMeta: Map<string, { at: Date; success: boolean; durationMs: number }> = new Map();
  private totalExecutions: Map<string, number> = new Map();
  private introspectionScanCache: IntrospectionScanCache | null = null;
  private jobProcessorInterval: ReturnType<typeof setInterval> | null = null;

  private jobQueue: JobQueue;
  private retryManager: RetryManager;
  private healthChecker: HealthChecker;
  private fileLogger: FileLogger;
  private relationValidatorExecutor: RelationValidatorExecutor;
  private tripleExtractionBatchJob: TripleExtractionBatchJob | null = null;
  private qualityMeasurementBatchJob: QualityMeasurementBatchJob | null = null;
  private sleepConsolidationService: SleepConsolidationService | null = null;
  private sleepConsolidationBatchJob: SleepConsolidationBatchJob | null = null;
  private telemetryCleanupRepository: TelemetryRepository | null = null;
  private telemetryCleanupBatchJob: TelemetryCleanupBatchJob | null = null;
  private diagnosticsLogger?: Pick<RuntimeDiagnosticsLogger, 'writeEvent'>;
  private anchorManager: AnchorManager | null = null;
  private jobExecutionCoordinator!: BatchJobExecutionCoordinator;

  constructor(
    config?: Partial<BatchJobConfig>,
    dependencies?: {
      jobQueue?: JobQueue;
      retryManager?: RetryManager;
      healthChecker?: HealthChecker;
      fileLogger?: FileLogger;
      relationValidatorExecutor?: RelationValidatorExecutor;
      diagnosticsLogger?: Pick<RuntimeDiagnosticsLogger, 'writeEvent'>;
    }
  ) {
    this.config = mergeBatchSchedulerJobConfig(config);
    validateBatchJobConfig(this.config);

    this.forgettingService = new ForgettingPolicyService();
    this.performanceMonitor = getPerformanceMonitor();

    if (mementoConfig.consolidationScoreEnabled) {
      this.consolidationScoreWorker = new ConsolidationScoreWorker();
    }

    this.jobQueue = dependencies?.jobQueue ?? new JobQueue();
    this.retryManager = dependencies?.retryManager ?? new RetryManager({
      maxAttempts: this.config.retryAttempts,
      baseDelay: this.config.retryDelay,
      maxErrorCount: this.config.retryAttempts * 3
    });
    this.healthChecker = dependencies?.healthChecker ?? new HealthChecker();
    this.fileLogger = dependencies?.fileLogger ?? new FileLogger({
      enabled: this.config.enableLogging
    });
    this.relationValidatorExecutor = dependencies?.relationValidatorExecutor ?? new RelationValidatorExecutor({
      timeout: this.config.weeklyRelationValidationTimeout ?? this.config.jobTimeout
    });
    this.diagnosticsLogger = dependencies?.diagnosticsLogger;

    this.jobExecutionCoordinator = new BatchJobExecutionCoordinator({
      jobQueue: this.jobQueue,
      retryManager: this.retryManager,
      getConfig: () => this.config,
      getIsRunning: () => this.isRunning,
      lastExecution: this.lastExecution,
      totalExecutions: this.totalExecutions,
      lastJobRunMeta: this.lastJobRunMeta,
      writeDiagnosticsEvent: e => this.writeDiagnosticsEvent(e),
      log: (m, d, l) => this.log(m, d, l),
      checkSchedulerHealth: () => this.checkSchedulerHealth()
    });
  }

  private getContextSource(): BatchSchedulerContextSource {
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
      lastExecution: this.lastExecution,
      totalExecutions: this.totalExecutions,
      anchorManager: this.anchorManager,
      log: this.log.bind(this),
      emitMemoryReviewCandidatesRunRecord: this.emitMemoryReviewCandidatesRunRecord.bind(this)
    };
  }

  private getRecurringContextSource(): BatchSchedulerRecurringContextSource {
    return {
      ...this.getContextSource(),
      consolidationScoreEnabled: mementoConfig.consolidationScoreEnabled,
      intervals: this.intervals,
      jobExecutionCoordinator: this.jobExecutionCoordinator,
      scheduleJob: (name, interval, job, priority) => this.scheduleJob(name, interval, job, priority),
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
      runAnchorAutoRefresh: () => this.runAnchorAutoRefresh()
    };
  }

  async start(db: Database.Database, reflexionWorker?: IReflexionWorker): Promise<void> {
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
    }, db, reflexionWorker);
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
      clearJobProcessorInterval: () => {
        if (this.jobProcessorInterval) {
          clearInterval(this.jobProcessorInterval);
          this.jobProcessorInterval = null;
        }
      },
      setIsRunning: isRunning => { this.isRunning = isRunning; }
    });
  }

  public addJob(name: string, job: () => Promise<void>, priority: number = 10, retryCount: number = 0): boolean {
    const added = this.jobExecutionCoordinator.addJobToQueue(name, job, priority, retryCount);
    this.jobExecutionCoordinator.afterEnqueueAttempt(name, added, this.jobProcessorInterval);
    return added;
  }

  private scheduleJob(name: string, interval: number, job: () => Promise<void>, priority: number): void {
    scheduleBatchJob(this.getIntervalDeps(), name, interval, job, priority);
  }

  private startJobProcessor(): void {
    this.jobProcessorInterval = this.jobExecutionCoordinator.startJobProcessor();
  }

  private async waitForRunningJobs(): Promise<void> {
    await waitForRunningBatchJobs(this.getIntervalDeps());
  }

  private async writeDiagnosticsEvent(event: Record<string, unknown>): Promise<void> {
    await writeBatchSchedulerDiagnosticsEvent(this.diagnosticsLogger, event);
  }

  private async emitMemoryReviewCandidatesRunRecord(result: BatchJobResult): Promise<void> {
    await emitMemoryReviewCandidatesRunRecordImpl(
      {
        diagnosticsLogger: this.diagnosticsLogger,
        log: this.log.bind(this),
        writeDiagnosticsEvent: e => this.writeDiagnosticsEvent(e)
      },
      result
    );
  }

  private getJobRunners() {
    return createBatchSchedulerJobRunners(this.getContextSource());
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

  private async runAnchorAutoRefresh(): Promise<BatchJobResult> {
    return this.getJobRunners().runAnchorAutoRefresh();
  }

  private log(message: string, data?: unknown, level: 'info' | 'warn' | 'error' = 'info'): void {
    logBatchSchedulerMessage(this.getLoggingDeps(), message, data, level);
  }

  async runJob(jobType: ManualBatchSchedulerJobType): Promise<BatchJobResult> {
    const result = await runManualBatchSchedulerJob(jobType, this.getJobRunners());

    this.lastExecution.set(jobType, new Date());
    this.totalExecutions.set(jobType, (this.totalExecutions.get(jobType) || 0) + 1);

    if (jobType === 'memory_review_candidates') {
      this.lastJobRunMeta.set(jobType, {
        at: result.endTime,
        success: result.success,
        durationMs: result.duration
      });
    }

    return result;
  }

  getStatus(): SchedulerStatus {
    const errorCountMap = new Map<string, number>();
    for (const jobName of this.intervals.keys()) {
      const errorCount = this.retryManager.getErrorCount(jobName);
      if (errorCount > 0) {
        errorCountMap.set(jobName, errorCount);
      }
    }

    return {
      isRunning: this.isRunning,
      activeJobs: Array.from(this.intervals.keys()),
      lastExecution: new Map(this.lastExecution),
      totalExecutions: new Map(this.totalExecutions),
      errorCount: errorCountMap,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      config: { ...this.config }
    };
  }

  updateConfig(newConfig: Partial<BatchJobConfig>): void {
    this.config = { ...this.config, ...newConfig };
    validateBatchJobConfig(this.config);
    this.log('Configuration updated', { config: this.config });
  }

  stopJob(jobName: string): boolean {
    const interval = this.intervals.get(jobName);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(jobName);
      this.log(`Stopped job: ${jobName}`);
      return true;
    }
    return false;
  }

  restartJob(jobName: string): boolean {
    const ctx = buildBatchRecurringScheduleContext(this.getRecurringContextSource());
    if (jobName === 'cleanup') {
      scheduleCleanupJob(ctx);
    } else if (jobName === 'monitoring') {
      scheduleMonitoringJob(ctx);
    } else if (jobName === 'healthcheck') {
      scheduleHealthcheckJob(ctx);
    } else if (jobName === 'memory_review_candidates') {
      if (!this.config.memoryReviewCandidatesSchedulerEnabled) {
        this.log('restartJob(memory_review_candidates): periodic schedule is disabled; enable MEMORY_REVIEW_CANDIDATES_SCHEDULER_ENABLED or use runJob', {
          level: 'warn'
        });
        return false;
      }
      scheduleMemoryReviewCandidatesInterval(ctx);
    } else {
      this.log(`Unknown job type for restart: ${jobName}`);
      return false;
    }

    this.log(`Restarted job: ${jobName}`);
    return true;
  }

  private async checkSchedulerHealth(): Promise<void> {
    await checkBatchSchedulerHealth({
      db: this.db,
      healthChecker: this.healthChecker,
      jobQueue: this.jobQueue,
      maxConcurrentJobs: this.config.maxConcurrentJobs,
      log: this.log.bind(this)
    });
  }

  getDetailedStats() {
    return getBatchSchedulerDetailedStats({
      getStatus: () => this.getStatus(),
      intervals: this.intervals,
      lastExecution: this.lastExecution,
      totalExecutions: this.totalExecutions,
      retryManager: this.retryManager,
      jobQueue: this.jobQueue,
      startTime: this.startTime
    });
  }

  isJobQueued(name: string): boolean {
    return this.jobQueue.isQueued(name);
  }

  isJobRunning(name: string): boolean {
    return this.jobQueue.isRunning(name);
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

  getLastJobRunMeta(
    name: string
  ): { at: Date; success: boolean; durationMs: number } | undefined {
    return this.lastJobRunMeta.get(name);
  }

  private getLoggingDeps() {
    return {
      enableLogging: this.config.enableLogging,
      startTime: this.startTime,
      jobQueue: this.jobQueue,
      fileLogger: this.fileLogger
    };
  }

  private getIntervalDeps() {
    return {
      jobExecutionCoordinator: this.jobExecutionCoordinator,
      intervals: this.intervals,
      jobQueue: this.jobQueue,
      log: this.log.bind(this)
    };
  }
}
