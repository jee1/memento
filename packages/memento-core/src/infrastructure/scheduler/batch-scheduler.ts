/* Batch job scheduler: async augmentation pipeline. See docs/architecture/async-augmentation-pipeline.md */

import type { IBatchScheduler } from '../../shared/interfaces/batch-scheduler.interface.js';
import { ForgettingPolicyService } from '../../domains/forgetting/services/forgetting-policy-service.js';
import { getPerformanceMonitor } from '../../domains/monitoring/services/performance-monitor.js';
import type { RuntimeDiagnosticsLogger } from '../../domains/monitoring/services/runtime-diagnostics-logger.js';
import Database from 'better-sqlite3';
import { ConsolidationScoreWorker } from '../../workers/consolidation-score-worker.js';
import type { IReflexionWorker } from '../../shared/interfaces/reflexion-worker.interface.js';
import { mementoConfig } from '../../shared/config/index.js';
import { mcpLogger } from '../../server/mcp-logger.js';
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
import { PIIMasker } from '../../shared/utils/pii-masker.js';
import { logger } from '../../shared/utils/logger.js';
import type { BatchJobConfig, BatchJobResult, SchedulerStatus } from './batch-scheduler-types.js';
export type { BatchJobConfig, BatchJobResult, SchedulerStatus } from './batch-scheduler-types.js';
import { validateBatchJobConfig } from './batch-scheduler-validate-config.js';
import { mergeBatchSchedulerJobConfig } from './batch-scheduler-default-config.js';
import { buildMemoryReviewCandidatesRunDiagnosticsPayload } from './memory-review-candidates-run-diagnostics.js';

import { BatchJobExecutionCoordinator } from './batch-job-execution-coordinator.js';
import type { BatchSchedulerRunContext } from './handlers/batch-scheduler-run-context.js';
import {
  runHealthCheck,
  runMemoryCleanup,
  runMonitoring
} from './handlers/batch-scheduler-maintenance-handlers.js';
import {
  runMemoryReviewCandidatesJob,
  runMetaMemoryIntrospection
} from './handlers/batch-scheduler-review-meta-handlers.js';
import {
  runConsolidationScoreFullSweep,
  runConsolidationScoreIncremental,
  runLogRotation,
  runWeeklyRelationValidation
} from './handlers/batch-scheduler-consolidation-relation-handlers.js';
import {
  runQualityMeasurementBatch,
  runTripleExtractionBatch
} from './handlers/batch-scheduler-augmentation-handlers.js';
import {
  runSleepConsolidationBatch,
  runTelemetryCleanupBatch
} from './handlers/batch-scheduler-sleep-telemetry-handlers.js';
import {
  registerAllRecurringJobs,
  scheduleCleanupJob,
  scheduleHealthcheckJob,
  scheduleMemoryReviewCandidatesInterval,
  scheduleMonitoringJob,
  type BatchRecurringScheduleContext
} from './batch-recurring-schedules.js';


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
  /** 마지막 작업 종료 시각, 성공 여부, 소요 ms (텔레메트리 system.background_jobs 노출용) */
  private lastJobRunMeta: Map<string, { at: Date; success: boolean; durationMs: number }> = new Map();
  private totalExecutions: Map<string, number> = new Map();
  private introspectionScanCache: IntrospectionScanCache | null = null;
  private jobProcessorInterval: ReturnType<typeof setInterval> | null = null;

  // 분리된 모듈들 (DI)
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
    
    // Consolidation Score 기능이 활성화되어 있으면 워커 초기화
    if (mementoConfig.consolidationScoreEnabled) {
      this.consolidationScoreWorker = new ConsolidationScoreWorker();
    }

    // 분리된 모듈들 초기화 (DI 또는 기본 생성)
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

  private buildRunContext(): BatchSchedulerRunContext {
    const self = this;
    return {
      db: self.db,
      config: self.config,
      forgettingService: self.forgettingService,
      performanceMonitor: self.performanceMonitor,
      healthChecker: self.healthChecker,
      jobQueue: self.jobQueue,
      fileLogger: self.fileLogger,
      relationValidatorExecutor: self.relationValidatorExecutor,
      consolidationScoreWorker: self.consolidationScoreWorker,
      introspectionScanCache: self.introspectionScanCache,
      sleepConsolidationService: self.sleepConsolidationService,
      telemetryCleanupRepository: self.telemetryCleanupRepository,
      tripleExtractionBatchJob: {
        get current() {
          return self.tripleExtractionBatchJob;
        },
        set current(v) {
          self.tripleExtractionBatchJob = v;
        }
      },
      qualityMeasurementBatchJob: {
        get current() {
          return self.qualityMeasurementBatchJob;
        },
        set current(v) {
          self.qualityMeasurementBatchJob = v;
        }
      },
      sleepConsolidationBatchJob: {
        get current() {
          return self.sleepConsolidationBatchJob;
        },
        set current(v) {
          self.sleepConsolidationBatchJob = v;
        }
      },
      telemetryCleanupBatchJob: {
        get current() {
          return self.telemetryCleanupBatchJob;
        },
        set current(v) {
          self.telemetryCleanupBatchJob = v;
        }
      },
      lastExecution: self.lastExecution,
      totalExecutions: self.totalExecutions,
      log: self.log.bind(self),
      emitMemoryReviewCandidatesRunRecord: self.emitMemoryReviewCandidatesRunRecord.bind(self)
    };
  }

  /**
   * 스케줄러 시작
   * @param db 데이터베이스 인스턴스
   * @param reflexionWorker Reflexion Worker 인스턴스 (선택적)
   */
  async start(db: Database.Database, reflexionWorker?: IReflexionWorker): Promise<void> {
    if (this.isRunning) {
      throw new Error('BatchScheduler is already running');
    }

    validateBatchJobConfig(this.config);
    this.db = db;
    this.isRunning = true;
    this.startTime = new Date();

    this.clearLeftoverJobsFromPreviousSession();
    this.healthChecker.setStartTime(this.startTime);
    this.performanceMonitor.initialize(db);
    this.attachReflexionWorker(reflexionWorker);
    this.scheduleAllRecurringJobs();
    this.startJobProcessor();

    this.log('BatchScheduler started', {
      config: this.config,
      startTime: this.startTime.toISOString()
    });
    await this.writeDiagnosticsEvent({
      type: 'batch_scheduler_start',
      config: this.config,
      startTime: this.startTime.toISOString()
    });
  }

  private clearLeftoverJobsFromPreviousSession(): void {
    if (this.jobQueue.size > 0) {
      this.log(`Clearing ${this.jobQueue.size} leftover jobs from previous session`, {
        leftoverJobs: this.jobQueue.size
      });
      this.jobQueue.clear();
    }
  }

  private attachReflexionWorker(reflexionWorker?: IReflexionWorker): void {
    if (!reflexionWorker) {
      return;
    }
    this.reflexionWorker = reflexionWorker;
    this.log('Reflexion Worker 통합됨', {
      worker_running: reflexionWorker.getStatus().isRunning
    });
  }

  private buildRecurringScheduleContext(): BatchRecurringScheduleContext {
    return {
      config: this.config,
      consolidationScoreEnabled: mementoConfig.consolidationScoreEnabled,
      hasConsolidationScoreWorker: this.consolidationScoreWorker !== null,
      hasSleepConsolidation: this.sleepConsolidationService != null,
      hasTelemetryCleanup: this.telemetryCleanupRepository != null,
      scheduleJob: (name, interval, job, priority) => this.scheduleJob(name, interval, job, priority),
      lastExecution: this.lastExecution,
      intervals: this.intervals,
      jobExecutionCoordinator: this.jobExecutionCoordinator,
      log: (message, data, level) => this.log(message, data, level ?? 'info'),
      runMemoryCleanup: () => this.runMemoryCleanup(),
      runMonitoring: () => this.runMonitoring(),
      runHealthCheck: () => this.runHealthCheck(),
      runConsolidationScoreIncremental: () => this.runConsolidationScoreIncremental(),
      runConsolidationScoreFullSweep: () => this.runConsolidationScoreFullSweep(),
      runWeeklyRelationValidation: () => this.runWeeklyRelationValidation(),
      runLogRotation: () => this.runLogRotation(),
      runTripleExtractionBatch: () => this.runTripleExtractionBatch(),
      runQualityMeasurementBatch: () => this.runQualityMeasurementBatch(),
      runMetaMemoryIntrospection: () => this.runMetaMemoryIntrospection(),
      runMemoryReviewCandidatesJob: () => this.runMemoryReviewCandidatesJob(),
      runSleepConsolidationBatch: () => this.runSleepConsolidationBatch(),
      runTelemetryCleanupBatch: () => this.runTelemetryCleanupBatch()
    };
  }

  private scheduleAllRecurringJobs(): void {
    registerAllRecurringJobs(this.buildRecurringScheduleContext());
  }

  /**
   * 스케줄러 중지
   * 재시작 시 의도하지 않은 배치 실행과 상태 오염을 방지하기 위해 큐를 비움
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.log('Stopping BatchScheduler...');
    this.isRunning = false;

    // 모든 인터벌 정리
    for (const [name, interval] of this.intervals) {
      clearInterval(interval);
      this.log(`Stopped job: ${name}`);
    }
    this.intervals.clear();

    // 작업 프로세서 인터벌 정리
    if (this.jobProcessorInterval) {
      clearInterval(this.jobProcessorInterval);
      this.jobProcessorInterval = null;
    }

    // 실행 중인 작업 완료 대기
    await this.waitForRunningJobs();

    // 큐에 남아있는 작업 제거 (재시작 시 의도하지 않은 실행 방지)
    const queuedJobsCount = this.jobQueue.size;
    if (queuedJobsCount > 0) {
      this.log(`Clearing ${queuedJobsCount} queued jobs to prevent unintended execution on restart`, {
        queuedJobs: queuedJobsCount
      });
      this.jobQueue.clear(); // 큐 비우기
    }

    this.log('BatchScheduler stopped', {
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      clearedQueuedJobs: queuedJobsCount
    });
    await this.writeDiagnosticsEvent({
      type: 'batch_scheduler_stop',
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      clearedQueuedJobs: queuedJobsCount
    });
  }

  /**
   * 외부에서 작업을 큐에 추가하는 public 메서드
   * AriGraph Pipeline 등 외부 컴포넌트에서 사용
   * 
   * @param name 작업 이름 (고유 식별자)
   * @param job 실행할 작업 함수
   * @param priority 우선순위 (낮을수록 높은 우선순위, 기본값: 10)
   * @param retryCount 재시도 횟수 (기본값: 0)
   * @returns 추가 성공 여부
   */
  public addJob(name: string, job: () => Promise<void>, priority: number = 10, retryCount: number = 0): boolean {
    const added = this.jobExecutionCoordinator.addJobToQueue(name, job, priority, retryCount);
    this.jobExecutionCoordinator.afterEnqueueAttempt(name, added, this.jobProcessorInterval);
    return added;
  }

  /**
   * 작업 스케줄링
   * 시작 시 maxConcurrentJobs를 보장하기 위해 무조건 큐를 통해 실행
   * 여러 작업이 동시에 시작될 때 race condition을 방지하기 위함
   */
  private scheduleJob(name: string, interval: number, job: () => Promise<void>, priority: number): void {
    const wrappedJob = async () => {
      // 주기적 실행도 큐를 통해 실행하여 maxConcurrentJobs 보장 (중복 방지 포함)
      this.jobExecutionCoordinator.addJobToQueue(name, job, priority, 0);
    };

    // 즉시 실행도 큐를 통해 실행 (maxConcurrentJobs 보장, 중복 방지 포함)
    // 여러 작업이 동시에 시작될 때 race condition 방지
    this.jobExecutionCoordinator.addJobToQueue(name, job, priority, 0);

    // 주기적 실행도 큐를 통해 실행
    const intervalId = setInterval(wrappedJob, interval);
    this.intervals.set(name, intervalId);
  }

  /**
   * 작업 큐 처리기 시작
   * 재시도 큐에서도 동일한 래퍼(타임아웃+상태 관리)를 사용하도록 수정
   * 
   * PRD 6.2: 기존 배치 작업과 충돌 방지
   * - maxConcurrentJobs 설정을 통해 동시 실행 작업 수 제한
   * - Triple 추출 배치 작업도 이 제한에 포함되어 다른 배치 작업과 충돌 방지
   * - 우선순위 기반 실행으로 중요한 작업 우선 처리
   */
  private startJobProcessor(): void {
    this.jobProcessorInterval = this.jobExecutionCoordinator.startJobProcessor();
  }

  /**
   * 실행 중인 작업 완료 대기
   */
  private async waitForRunningJobs(): Promise<void> {
    const maxWaitTime = 30000; // 30초
    const startTime = Date.now();

    while (this.jobQueue.runningCount > 0 && (Date.now() - startTime) < maxWaitTime) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (this.jobQueue.runningCount > 0) {
      this.log(`Warning: ${this.jobQueue.runningCount} jobs still running after timeout`, { level: 'warn' });
    }
  }

  private async writeDiagnosticsEvent(event: Record<string, unknown>): Promise<void> {
    if (!this.diagnosticsLogger) {
      return;
    }

    try {
      await this.diagnosticsLogger.writeEvent({
        timestamp: new Date().toISOString(),
        ...event
      });
    } catch {
      return;
    }
  }

  /**
   * Issue 293: memory_review_candidates 실행 메타(고정 키)를 diagnostics에 기록한다.
   * diagnostics가 꺼져 있으면 동일 스키마로 앱 로그에 남겨 운영에서 grep/후처리할 수 있게 한다.
   */
  private async emitMemoryReviewCandidatesRunRecord(result: BatchJobResult): Promise<void> {
    const payload = buildMemoryReviewCandidatesRunDiagnosticsPayload(result);
    await this.writeDiagnosticsEvent(payload);
    if (!this.diagnosticsLogger) {
      this.log('memory_review_candidates_run', payload, 'info');
    }
  }

  /**
   * 메모리 정리 작업 실행
   */
  private async runMemoryCleanup(): Promise<BatchJobResult> {
    return runMemoryCleanup(this.buildRunContext());
  }

  private async runMemoryReviewCandidatesJob(): Promise<BatchJobResult> {
    return runMemoryReviewCandidatesJob(this.buildRunContext());
  }

  /**
   * 모니터링 작업 실행
   */
  private async runMonitoring(): Promise<BatchJobResult> {
    return runMonitoring(this.buildRunContext());
  }

  /**
   * 헬스체크 작업 실행
   */
  private async runHealthCheck(): Promise<BatchJobResult> {
    return runHealthCheck(this.buildRunContext());
  }

  /**
   * Consolidation Score 증분 재계산 작업 실행
   */
  private async runConsolidationScoreIncremental(): Promise<BatchJobResult> {
    return runConsolidationScoreIncremental(this.buildRunContext());
  }


  /**
   * 주간 관계 추출 품질 검증 실행
   * 타임아웃 및 강제 종료 로직 포함
   */
  private async runWeeklyRelationValidation(): Promise<BatchJobResult> {
    return runWeeklyRelationValidation(this.buildRunContext());
  }

  /**
   * Consolidation Score 전체 스윕 작업 실행
   */
  private async runConsolidationScoreFullSweep(): Promise<BatchJobResult> {
    return runConsolidationScoreFullSweep(this.buildRunContext());
  }

  /**
   * 로깅
   * data 객체에 level 속성이 있으면 이를 우선적으로 사용하여 호출부의 편의성을 높임
   */
  private log(message: string, data?: unknown, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (!this.config.enableLogging) return;

    // 배치 작업 컨텍스트 정보 추가
    // Error 객체는 non-enumerable 속성을 가지므로 명시적으로 처리 필요
    let safeData: Record<string, unknown>;
    let actualLevel: 'info' | 'warn' | 'error' = level;
    
    if (data instanceof Error) {
      // Error 객체의 속성을 명시적으로 추출 (non-enumerable 속성 포함)
      safeData = {
        message: data.message,
        name: data.name,
        stack: data.stack
      };
    } else if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      // 일반 객체는 spread 가능
      safeData = { ...data };
      
      // data.level이 있으면 이를 우선적으로 사용 (호출부 편의성)
      if ('level' in safeData && typeof safeData.level === 'string') {
        const dataLevel = safeData.level.toLowerCase();
        // 'debug'는 'info'로 변환 (mcpLogger가 debug를 지원하지 않을 수 있음)
        if (dataLevel === 'debug' || dataLevel === 'info' || dataLevel === 'warn' || dataLevel === 'error') {
          actualLevel = dataLevel === 'debug' ? 'info' : dataLevel as 'info' | 'warn' | 'error';
        }
        // level 속성은 제거 (중복 방지)
        delete safeData.level;
      }
    } else {
      // 원시 타입이나 배열은 빈 객체로 처리
      safeData = {};
    }
    
    const batchContext = {
      ...safeData,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      activeJobs: this.jobQueue.runningCount,
      queueSize: this.jobQueue.size
    };

    // MCP 로거 사용
    mcpLogger.logBatch(actualLevel, message, batchContext);

      // 에러/경고 로그는 파일에도 저장 (FileLogger 사용, 비동기이므로 await 없이 fire-and-forget)
      // warn과 error를 구분하여 원본 레벨을 보존
      if (actualLevel === 'warn') {
        // 비동기 로깅이지만 await하지 않음 (로깅 실패가 작업 실패로 이어지지 않도록)
        this.fileLogger.logWarn(
          message,
          batchContext,
          {
            uptime: batchContext.uptime,
            activeJobs: batchContext.activeJobs,
            queueSize: batchContext.queueSize
          }
        ).catch((error) => {
          // 파일 로깅 실패는 표준 로거로 기록 (무한 루프 방지)
          const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
          logger.error('File logging failed', { error: maskedError.message, errorName: maskedError.name });
        });
      } else if (actualLevel === 'error') {
        // 비동기 로깅이지만 await하지 않음 (로깅 실패가 작업 실패로 이어지지 않도록)
        this.fileLogger.logError(
          message,
          batchContext,
          {
            uptime: batchContext.uptime,
            activeJobs: batchContext.activeJobs,
            queueSize: batchContext.queueSize
          }
        ).catch((error) => {
          // 파일 로깅 실패는 표준 로거로 기록 (무한 루프 방지)
          const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
          logger.error('File logging failed', { error: maskedError.message, errorName: maskedError.name });
        });
      }
  }

  /**
   * 수동으로 작업 실행
   * 직접 실행하되 lastExecution과 totalExecutions을 기록함
   */
  async runJob(
    jobType: 'cleanup' | 'monitoring' | 'healthcheck' | 'meta_memory_introspection' | 'memory_review_candidates'
  ): Promise<BatchJobResult> {
    let result: BatchJobResult;

    switch (jobType) {
      case 'cleanup':
        result = await this.runMemoryCleanup();
        break;
      case 'monitoring':
        result = await this.runMonitoring();
        break;
      case 'healthcheck':
        result = await this.runHealthCheck();
        break;
      case 'meta_memory_introspection':
        result = await this.runMetaMemoryIntrospection();
        break;
      case 'memory_review_candidates':
        result = await this.runMemoryReviewCandidatesJob();
        break;
      default:
        throw new Error(`Unknown job type: ${jobType}`);
    }

    // lastExecution과 totalExecutions 업데이트 (큐를 통한 실행과 일관성 유지)
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

  /**
   * 스케줄러 상태 확인
   */
  getStatus(): SchedulerStatus {
    // RetryManager에서 errorCount를 가져와서 Map으로 변환
    const errorCountMap = new Map<string, number>();
    // 모든 작업 이름에 대해 errorCount 조회 (intervals의 키 사용)
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

  /**
   * 설정 업데이트
   */
  updateConfig(newConfig: Partial<BatchJobConfig>): void {
    this.config = { ...this.config, ...newConfig };
    validateBatchJobConfig(this.config);
    this.log('Configuration updated', { config: this.config });
  }

  /**
   * 특정 작업 중지
   */
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

  /**
   * 특정 작업 재시작
   */
  restartJob(jobName: string): boolean {
    // 작업 재시작 로직 (stopJob을 호출하지 않음)
    const ctx = this.buildRecurringScheduleContext();
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

  /**
   * 스케줄러 헬스체크
   */
  private async checkSchedulerHealth(): Promise<void> {
    try {
      this.log('Performing scheduler health check...');
      
      // HealthChecker를 사용하여 헬스체크 실행
      const healthResult = await this.healthChecker.check(
        this.db,
        this.jobQueue.runningCount,
        this.jobQueue.size,
        this.config.maxConcurrentJobs
      );

      // 경고가 있으면 로깅
      if (healthResult.warnings.length > 0) {
        healthResult.warnings.forEach(warning => {
          this.log(warning, { level: 'warn' });
        });
      }

      // 메모리 사용량이 높으면 가비지 컬렉션 시도
      if (healthResult.memoryUsage > 90) {
        if (this.healthChecker.triggerGarbageCollection()) {
          this.log('Garbage collection triggered');
        }
      }
      
      this.log('Scheduler health check completed', {
        memoryUsage: healthResult.memoryUsage,
        runningJobs: healthResult.runningJobs,
        queueSize: healthResult.queueSize,
        uptime: healthResult.uptime,
        warnings: healthResult.warnings.length,
        errors: healthResult.errors.length
      });
      
    } catch (error) {
      this.log('Scheduler health check failed', { error: error instanceof Error ? error.message : String(error) }, 'error');
    }
  }

  /**
   * Triple 추출 배치 작업 실행
   * 
   * PRD 6.1: 주기적 배치 실행
   * - 대상: triple_extracted=false 또는 null인 Episodic Memory
   * - 재시도 정책 적용 (최대 시도 횟수 확인)
   * - abandoned 상태는 제외
   */
  private async runTripleExtractionBatch(): Promise<BatchJobResult> {
    return runTripleExtractionBatch(this.buildRunContext());
  }



  /**
   * M2 자기성찰 스캔 실행 (Issue 21)
   * meta_memory_stats를 스캔하여 저신뢰, 고실패 메모리를 식별하고 요약합니다.
   */
  private async runMetaMemoryIntrospection(): Promise<BatchJobResult> {
    return runMetaMemoryIntrospection(this.buildRunContext());
  }

  /**
   * 품질 측정 배치 작업 실행
   * 
   * PRD FR-5.6: 일일 품질 측정 배치 작업
   */
  private async runQualityMeasurementBatch(): Promise<BatchJobResult> {
    return runQualityMeasurementBatch(this.buildRunContext());
  }

  /**
   * 로그 로테이션 실행
   * 30일 이상 된 Triple 추출 로그 파일을 삭제합니다.
   */
  private async runLogRotation(): Promise<BatchJobResult> {
    return runLogRotation(this.buildRunContext());
  }

  /**
   * 스케줄러 통계 조회
   */
  getDetailedStats(): {
    status: SchedulerStatus;
    health: {
      memoryUsage: number;
      runningJobs: number;
      queueSize: number;
      errorRate: number;
      uptime: number;
    };
    jobs: Array<{
      name: string;
      lastExecution: Date | null;
      totalExecutions: number;
      errorCount: number;
      errorRate: number;
      isRunning: boolean;
    }>;
  } {
    const memUsage = process.memoryUsage();
    const memUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    
    const totalExecutions = Array.from(this.totalExecutions.values()).reduce((sum, count) => sum + count, 0);
    // RetryManager에서 총 에러 카운트 계산
    const totalErrors = Array.from(this.intervals.keys()).reduce((sum, name) => {
      return sum + this.retryManager.getErrorCount(name);
    }, 0);
    const errorRate = totalExecutions > 0 ? totalErrors / totalExecutions : 0;
    
    const jobs = Array.from(this.intervals.keys()).map(name => ({
      name,
      lastExecution: this.lastExecution.get(name) || null,
      totalExecutions: this.totalExecutions.get(name) || 0,
      errorCount: this.retryManager.getErrorCount(name),
      errorRate: (this.totalExecutions.get(name) || 0) > 0 ? this.retryManager.getErrorCount(name) / (this.totalExecutions.get(name) || 1) : 0,
      isRunning: this.jobQueue.isRunning(name)
    }));
    
    return {
      status: this.getStatus(),
      health: {
        memoryUsage: memUsagePercent,
        runningJobs: this.jobQueue.runningCount,
        queueSize: this.jobQueue.size,
        errorRate,
        uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0
      },
      jobs
    };
  }

  /**
   * 작업이 큐에 대기 중인지 여부. jobQueue private 멤버 대신 공개 API로 상태 조회용.
   */
  isJobQueued(name: string): boolean {
    return this.jobQueue.isQueued(name);
  }

  /**
   * 작업이 현재 실행 중인지 여부. jobQueue private 멤버 대신 공개 API로 상태 조회용.
   */
  isJobRunning(name: string): boolean {
    return this.jobQueue.isRunning(name);
  }

  /**
   * Issue 21 Phase B: 인트로스펙션 스캔 결과 캐시 설정.
   * bootstrap에서 생성한 IntrospectionScanCache를 주입합니다.
   */
  setIntrospectionScanCache(cache: IntrospectionScanCache | null): void {
    this.introspectionScanCache = cache;
  }

  /**
   * Sleep consolidation 서비스 주입 (bootstrap). 미주입 시 배치 미스케줄.
   */
  setSleepConsolidationService(service: SleepConsolidationService | null): void {
    this.sleepConsolidationService = service;
    this.sleepConsolidationBatchJob = null; // 서비스 교체 시 캐시된 잡 무효화
  }

  /**
   * 텔레메트리 원시 이벤트 정리용 저장소 (bootstrap에서 주입, start 전에 설정)
   */
  setTelemetryCleanupRepository(repository: TelemetryRepository | null): void {
    this.telemetryCleanupRepository = repository;
    this.telemetryCleanupBatchJob = null;
  }

  setDiagnosticsLogger(logger: Pick<RuntimeDiagnosticsLogger, 'writeEvent'> | undefined): void {
    this.diagnosticsLogger = logger;
  }

  getLastJobRunMeta(
    name: string
  ): { at: Date; success: boolean; durationMs: number } | undefined {
    return this.lastJobRunMeta.get(name);
  }


  private async runTelemetryCleanupBatch(): Promise<void> {
    return runTelemetryCleanupBatch(this.buildRunContext());
  }

  private async runSleepConsolidationBatch(): Promise<BatchJobResult> {
    return runSleepConsolidationBatch(this.buildRunContext());
  }
}

// 싱글톤 인스턴스
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
