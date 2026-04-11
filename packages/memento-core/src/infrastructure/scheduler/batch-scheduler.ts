/**
 * 배치 작업 스케줄러 (비동기 Augmentation 파이프라인 워커, Issue #89)
 *
 * remember/remember_procedure는 메모리를 즉시 저장한 뒤 응답을 반환하고,
 * Triple 추출·콘솔리데이션 등 augmentation은 이 스케줄러에서 배치/큐 기반으로 수행한다.
 *
 * 담당 작업:
 * (1) Per-item Triple 추출 (JobQueue — remember-tool에서 addJob으로 등록)
 * (2) Triple 추출 배치 (TripleExtractionBatchJob — 미처리 episodic 일괄 처리)
 * (3) 콘솔리데이션 점수 (ConsolidationScoreWorker — 증분/전체 스윕)
 * (4) 관계 검증 (RelationValidatorExecutor — 주간 검증)
 * (5) 품질 측정 (QualityMeasurementBatchJob — 일일 배치)
 * (6) 메모리 정리 (ForgettingPolicyService — TTL 기반 cleanup)
 *
 * 실패 재시도: RetryManager (BatchJobConfig.retryAttempts, retryDelay).
 * 모니터링: 로깅·getStatus()·admin 라우트에서 큐/실행 상태 확인 가능.
 */

import type { IBatchScheduler } from '../../shared/interfaces/batch-scheduler.interface.js';
import { ForgettingPolicyService, type MemoryCleanupResult } from '../../domains/forgetting/services/forgetting-policy-service.js';
import { getPerformanceMonitor, type PerformanceAlert } from '../../domains/monitoring/services/performance-monitor.js';
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
import { tripleExtractionLogger } from '../logging/triple-extraction-logger.js';
import { TripleExtractionBatchJob } from './jobs/triple-extraction-batch-job.js';
import { QualityMeasurementBatchJob } from './jobs/quality-measurement-batch-job.js';
import { SleepConsolidationBatchJob } from './jobs/sleep-consolidation-batch-job.js';
import { TelemetryCleanupBatchJob } from './jobs/telemetry-cleanup-batch-job.js';
import type { SleepConsolidationService } from '../../domains/consolidation/services/sleep-consolidation-service.js';
import type { TelemetryRepository } from '../../domains/telemetry/repositories/telemetry-repository.js';
import { MetaMemoryIntrospectionService } from '../../domains/memory/services/meta-memory-introspection-service.js';
import type { IntrospectionScanCache } from '../../domains/memory/services/introspection-scan-cache.js';
import { DatabaseUtils } from '../../shared/utils/database.js';
import { PIIMasker } from '../../shared/utils/pii-masker.js';
import { logger } from '../../shared/utils/logger.js';
import { resolveValidatedNumber } from '../../shared/config/environment.js';

export interface BatchJobConfig {
  // 배치 작업 간격 (밀리초)
  cleanupInterval: number;        // 메모리 정리 간격 (기본: 24h, env: FORGETTING_CLEANUP_INTERVAL_MS)
  monitoringInterval: number;     // 모니터링 간격 (기본: 5분, env: BATCH_MONITORING_INTERVAL_MS)
  healthCheckInterval: number;    // 헬스체크 간격 (기본: 5분, env: BATCH_HEALTH_CHECK_INTERVAL_MS)
  consolidationScoreIncrementalInterval: number;  // Consolidation Score 증분 재계산 간격 (기본: 1시간)
  consolidationScoreFullSweepInterval: number;   // Consolidation Score 전체 스윕 간격 (기본: 24시간)
  consolidationScoreFullSweepHour: number;        // 전체 스윕 실행 시간 (0-23, 기본: 3시)
  relationValidationInterval: number;            // 관계 추출 품질 검증 간격 (기본: 7일)
  relationValidationDayOfWeek: number;           // 주간 검증 실행 요일 (0=일요일, 기본: 0)
  relationValidationHour: number;                // 주간 검증 실행 시간 (0-23, 기본: 2시)
  logRotationInterval: number;                   // 로그 로테이션 간격 (기본: 24시간)
  tripleExtractionInterval: number;              // Triple 추출 배치 작업 간격 (기본: 1시간)
  tripleExtractionHour?: number;                 // Triple 추출 배치 작업 실행 시간 (0-23, 선택적, 지정 시 해당 시간에만 실행)
  tripleExtractionBatchSize: number;             // Triple 추출 배치 크기 (기본: 10)
  tripleExtractionTimeout: number;               // Triple 추출 배치 작업 타임아웃 (밀리초, 기본: 30초)
  qualityMeasurementInterval: number;           // 품질 측정 배치 작업 간격 (기본: 24시간)
  qualityMeasurementHour?: number;               // 품질 측정 배치 작업 실행 시간 (0-23, 선택적, 지정 시 해당 시간에만 실행)
  metaMemoryIntrospectionInterval: number;      // M2 자기성찰 스캔 간격 (기본: 6시간, Issue #21)
  /** Sleep consolidation 배치 간격 (기본: 24h, env: SLEEP_CONSOLIDATION_INTERVAL_MS) */
  sleepConsolidationInterval: number;
  /** Telemetry raw events cleanup 간격 (기본: 24h, env: TELEMETRY_CLEANUP_INTERVAL_MS) */
  telemetryCleanupInterval: number;

  // 작업 설정
  maxBatchSize: number;          // 한 번에 처리할 최대 메모리 수
  enableLogging: boolean;        // 로깅 활성화
  enableNotifications: boolean;  // 알림 활성화
  enableMetrics: boolean;        // 메트릭 수집 활성화
  
  // 성능 설정
  maxConcurrentJobs: number;     // 최대 동시 작업 수
  jobTimeout: number;            // 작업 타임아웃 (밀리초)
  retryAttempts: number;         // 재시도 횟수
  retryDelay: number;            // 재시도 지연 (밀리초)
  /**
   * 주간 관계 검증 타임아웃 (밀리초)
   * - 기본값: jobTimeout 사용
   * - 최소값: 1초 (1000ms)
   * - 권장값: 주간 검증은 오래 걸릴 수 있으므로 최소 5분(300000ms) 이상 권장
   * - 운영 환경: 10분(600000ms) 이상 권장
   * - 테스트/데브 환경: 짧게 설정 가능 (최소 1초)
   */
  weeklyRelationValidationTimeout?: number;
}

export interface BatchJobResult {
  jobType: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  success: boolean;
  processed: number;
  errors: string[];
  warnings: string[];
  details?: any;
  retryCount?: number;
}

export interface SchedulerStatus {
  isRunning: boolean;
  activeJobs: string[];
  lastExecution: Map<string, Date>;
  totalExecutions: Map<string, number>;
  errorCount: Map<string, number>;
  uptime: number;
  config: BatchJobConfig;
}

/**
 * 비동기 Augmentation 파이프라인 워커.
 * @see docs/architecture/async-augmentation-pipeline.md
 */
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
  /** 마지막 작업 종료 시각·성공 여부·소요 ms (텔레메트리 system.background_jobs 노출용) */
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

  constructor(
    config?: Partial<BatchJobConfig>,
    dependencies?: {
      jobQueue?: JobQueue;
      retryManager?: RetryManager;
      healthChecker?: HealthChecker;
      fileLogger?: FileLogger;
      relationValidatorExecutor?: RelationValidatorExecutor;
    }
  ) {
    this.config = {
      cleanupInterval: resolveValidatedNumber(
        'FORGETTING_CLEANUP_INTERVAL_MS',
        24 * 60 * 60 * 1000,
        n => n >= 60_000,
        '최솟값 60000'
      ),
      monitoringInterval: resolveValidatedNumber('BATCH_MONITORING_INTERVAL_MS', 300_000, n => n >= 10_000, '최솟값 10000'),
      healthCheckInterval: resolveValidatedNumber('BATCH_HEALTH_CHECK_INTERVAL_MS', 300_000, n => n >= 10_000, '최솟값 10000'),
      consolidationScoreIncrementalInterval: 60 * 60 * 1000,  // 1시간
      consolidationScoreFullSweepInterval: 24 * 60 * 60 * 1000, // 24시간
      consolidationScoreFullSweepHour: 3,  // 새벽 3시
      relationValidationInterval: 7 * 24 * 60 * 60 * 1000, // 7일
      relationValidationDayOfWeek: 0,     // 일요일
      relationValidationHour: 2,          // 새벽 2시
      logRotationInterval: 24 * 60 * 60 * 1000, // 24시간 (매일)
      tripleExtractionInterval: 60 * 60 * 1000, // 1시간
      tripleExtractionHour: undefined,   // 시간 지정 안 함 (간격 기반 실행)
      tripleExtractionBatchSize: 10,     // 배치 크기 10개
      tripleExtractionTimeout: 30 * 1000, // 30초
      qualityMeasurementInterval: 24 * 60 * 60 * 1000, // 24시간 (일일)
      qualityMeasurementHour: undefined, // 시간 지정 안 함 (간격 기반 실행)
      metaMemoryIntrospectionInterval: 6 * 60 * 60 * 1000, // 6시간 (Issue #21)
      sleepConsolidationInterval: resolveValidatedNumber(
        'SLEEP_CONSOLIDATION_INTERVAL_MS',
        60 * 60 * 1000,
        n => n >= 60_000,
        '최솟값 60000'
      ),
      telemetryCleanupInterval: resolveValidatedNumber(
        'TELEMETRY_CLEANUP_INTERVAL_MS',
        24 * 60 * 60 * 1000,
        n => n >= 60_000,
        '최솟값 60000'
      ),
      maxBatchSize: 1000,
      enableLogging: true,
      enableNotifications: false,
      enableMetrics: true,
      maxConcurrentJobs: 3,
      jobTimeout: 5 * 60 * 1000,          // 5분
      retryAttempts: 3,
      retryDelay: 1000,                   // 1초
      weeklyRelationValidationTimeout: undefined, // 기본값: jobTimeout 사용
      ...config
    };

    // 생성자에서 설정 검증
    this.validateConfig();

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

    this.validateConfig();
    this.db = db;
    this.isRunning = true;
    this.startTime = new Date();

    // 재시작 시 큐 초기화 (이전 세션의 작업이 남아있을 수 있음)
    if (this.jobQueue.size > 0) {
      this.log(`Clearing ${this.jobQueue.size} leftover jobs from previous session`, {
        leftoverJobs: this.jobQueue.size
      });
      this.jobQueue.clear();
    }

    // 헬스체크 시작 시간 설정
    this.healthChecker.setStartTime(this.startTime);

    // 성능 모니터 초기화
    this.performanceMonitor.initialize(db);

    // Reflexion Worker 통합 (Phase 2)
    if (reflexionWorker) {
      this.reflexionWorker = reflexionWorker;
      // Reflexion Worker는 이미 bootstrap.ts에서 시작되므로 여기서는 상태 확인만
      this.log('Reflexion Worker 통합됨', {
        worker_running: reflexionWorker.getStatus().isRunning
      });
    }

    // 메모리 정리 작업 스케줄링
    this.scheduleJob('cleanup', this.config.cleanupInterval, async () => { await this.runMemoryCleanup(); }, 1);
    
    // 모니터링 작업 스케줄링
    this.scheduleJob('monitoring', this.config.monitoringInterval, async () => { await this.runMonitoring(); }, 2);

    // 헬스체크 작업 스케줄링
    this.scheduleJob('healthcheck', this.config.healthCheckInterval, async () => { await this.runHealthCheck(); }, 3);

    // Consolidation Score 재계산 작업 스케줄링 (기능 플래그 활성화 시)
    if (mementoConfig.consolidationScoreEnabled && this.consolidationScoreWorker) {
      // 시간당 증분 재계산
      this.scheduleJob(
        'consolidation_score_incremental',
        this.config.consolidationScoreIncrementalInterval,
        async () => { await this.runConsolidationScoreIncremental(); },
        4
      );

      // 야간 전체 스윕 (하루 1회, 지정된 시간에 실행)
      this.scheduleConsolidationScoreFullSweep();
    }

    // 주간 관계 추출 품질 검증 작업 스케줄링
    this.scheduleWeeklyRelationValidation();

    // 로그 로테이션 작업 스케줄링
    this.scheduleJob(
      'log_rotation',
      this.config.logRotationInterval,
      async () => { await this.runLogRotation(); },
      5
    );

    // Triple 추출 배치 작업 스케줄링 (PRD 6.1)
    this.scheduleTripleExtractionBatch();

    // 품질 측정 배치 작업 스케줄링 (PRD FR-5.6)
    this.scheduleQualityMeasurement();

    // Sleep consolidation (005)
    if (this.sleepConsolidationService) {
      this.scheduleSleepConsolidation();
    }

    if (this.telemetryCleanupRepository) {
      this.scheduleTelemetryCleanup();
    }

    // M2 자기성찰 스캔 스케줄링 (Issue #21)
    this.scheduleJob(
      'meta_memory_introspection',
      this.config.metaMemoryIntrospectionInterval,
      async () => { await this.runMetaMemoryIntrospection(); },
      6
    );

    // 작업 큐 처리 시작
    this.startJobProcessor();

    this.log('BatchScheduler started', {
      config: this.config,
      startTime: this.startTime.toISOString()
    });
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
  }

  /**
   * 설정 검증
   */
  private validateConfig(): void {
    if (this.config.cleanupInterval < 60000) {
      throw new Error('cleanupInterval must be at least 1 minute');
    }
    if (this.config.monitoringInterval < 10000) {
      throw new Error('monitoringInterval must be at least 10 seconds');
    }
    if (this.config.healthCheckInterval < 10000) {
      throw new Error('healthCheckInterval must be at least 10 seconds');
    }
    if (this.config.maxBatchSize < 1) {
      throw new Error('maxBatchSize must be at least 1');
    }
    if (this.config.maxConcurrentJobs < 1) {
      throw new Error('maxConcurrentJobs must be at least 1');
    }
    if (this.config.jobTimeout < 1000) {
      throw new Error('jobTimeout must be at least 1 second');
    }
    if (this.config.tripleExtractionInterval < 60000) {
      throw new Error('tripleExtractionInterval must be at least 1 minute');
    }
    if (this.config.tripleExtractionHour !== undefined && 
        (this.config.tripleExtractionHour < 0 || this.config.tripleExtractionHour > 23)) {
      throw new Error('tripleExtractionHour must be between 0 and 23');
    }
    if (this.config.tripleExtractionBatchSize < 1) {
      throw new Error('tripleExtractionBatchSize must be at least 1');
    }
    if (this.config.tripleExtractionTimeout < 1000) {
      throw new Error('tripleExtractionTimeout must be at least 1 second');
    }
    if (this.config.metaMemoryIntrospectionInterval < 60000) {
      throw new Error('metaMemoryIntrospectionInterval must be at least 1 minute');
    }
    if (this.config.sleepConsolidationInterval < 60000) {
      throw new Error('sleepConsolidationInterval must be at least 1 minute');
    }
    if (this.config.telemetryCleanupInterval < 60000) {
      throw new Error('telemetryCleanupInterval must be at least 1 minute');
    }
    // weeklyRelationValidationTimeout 검증 (설정된 경우에만)
    if (this.config.weeklyRelationValidationTimeout !== undefined) {
      if (typeof this.config.weeklyRelationValidationTimeout !== 'number' || 
          isNaN(this.config.weeklyRelationValidationTimeout) ||
          this.config.weeklyRelationValidationTimeout <= 0) {
        throw new Error('weeklyRelationValidationTimeout must be a positive number (at least 1 second)');
      }
      if (this.config.weeklyRelationValidationTimeout < 1000) {
        throw new Error('weeklyRelationValidationTimeout must be at least 1 second');
      }
    }
  }

  /**
   * 작업 실행 래퍼 (타임아웃, 상태 관리, 재시도 포함)
   * 재시도 큐에서도 동일한 래퍼를 사용하여 타임아웃/상태 관리가 적용되도록 함
   * 
   * @param name 작업 이름
   * @param job 실행할 작업 함수
   * @param priority 우선순위 (재시도 시 사용)
   * @param initialRetryCount 초기 재시도 횟수 (기본값: 0)
   * @returns 실행 결과
   */
  private async executeJobWithRetry(
    name: string,
    job: () => Promise<void>,
    priority: number,
    initialRetryCount: number = 0
  ): Promise<void> {
    // 이미 실행 중인 작업은 큐에 남겨두어 다음 턴에 실행되도록 함
    // (스킵하면 주기적 실행이 누락될 수 있음)
    // 단, 중복 방지를 위해 동일 이름의 잡이 이미 큐에 있으면 추가하지 않음
    if (this.jobQueue.isRunning(name)) {
      const added = this.addJobToQueue(name, job, priority, initialRetryCount);
      if (!added) {
        // 이미 큐에 있으면 스킵
        return;
      }
      this.log(`Job ${name} is already running, will retry after completion`, { level: 'debug' });
      return;
    }

    this.jobQueue.markRunning(name);
    const startTime = Date.now();
    let retryCount = initialRetryCount;
    let jobOk = false;

    try {
      await this.executeWithTimeout(job, this.config.jobTimeout);
      jobOk = true;
      this.lastExecution.set(name, new Date());
      this.totalExecutions.set(name, (this.totalExecutions.get(name) || 0) + 1);
      
      // 성공시 에러 카운트 리셋 (RetryManager 사용)
      this.retryManager.resetErrorCount(name);
      
      this.log(`Job ${name} completed successfully`, {
        duration: Date.now() - startTime,
        totalExecutions: this.totalExecutions.get(name),
        retryCount
      });
    } catch (error) {
      retryCount++;
      const totalErrorCount = this.retryManager.incrementErrorCount(name);
      
      const errorInfo = {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        errorCount: totalErrorCount,
        retryCount,
        duration: Date.now() - startTime
      };
      
      this.log(`Job ${name} failed`, errorInfo, 'error');

      // RetryManager를 사용하여 재시도 여부 결정
      const retryResult = this.retryManager.shouldRetry(name, retryCount, totalErrorCount);
      
      if (retryResult.exceededMaxErrors) {
        this.log(`Job ${name} exceeded maximum error count (${totalErrorCount}), stopping retries`, {
          totalErrorCount,
          finalError: errorInfo
        }, 'error');
        
        // 심각한 에러의 경우 스케줄러 상태 확인
        this.log(`Job ${name} has too many consecutive failures, checking scheduler health`, { level: 'warn' });
        await this.checkSchedulerHealth();
        return;
      }

      // 재시도 로직
      if (retryResult.shouldRetry) {
        this.log(`Retrying job ${name} in ${retryResult.nextRetryDelay}ms`, { 
          attempt: retryResult.retryCount,
          totalAttempts: this.config.retryAttempts,
          nextRetryDelay: retryResult.nextRetryDelay,
          totalErrorCount
        });
        
        setTimeout(() => {
          if (this.isRunning) { // 스케줄러가 여전히 실행 중인지 확인
            // 재시도 시 retryCount를 큐 항목에 저장하여 다음 실행 시 전달 (중복 방지 포함)
            this.addJobToQueue(name, job, priority, retryResult.retryCount);
          }
        }, retryResult.nextRetryDelay);
      } else {
        this.log(`Job ${name} failed permanently after ${retryCount} attempts`, {
          totalErrorCount,
          finalError: errorInfo
        }, 'error');
        
        // 심각한 에러의 경우 스케줄러 상태 확인
        if (totalErrorCount > this.config.retryAttempts * 2) {
          this.log(`Job ${name} has too many consecutive failures, checking scheduler health`, { level: 'warn' });
          await this.checkSchedulerHealth();
        }
      }
    } finally {
      const durationMs = Date.now() - startTime;
      this.lastJobRunMeta.set(name, {
        at: new Date(),
        success: jobOk,
        durationMs
      });
      this.jobQueue.markCompleted(name);
    }
  }

  /**
   * 큐에 작업 추가 (중복 방지 포함)
   * 동일 이름의 잡이 이미 큐에 있거나 실행 중이면 추가하지 않음
   * 
   * PRD 6.2: 기존 배치 작업과 충돌 방지
   * - 중복 방지: 동일 이름의 작업이 이미 큐에 있거나 실행 중이면 추가하지 않음
   * - Triple 추출 배치 작업도 이 메커니즘을 통해 중복 실행 방지
   * - 우선순위 기반 큐 관리로 중요한 작업 우선 처리
   */
  private addJobToQueue(name: string, job: () => Promise<void>, priority: number, retryCount: number = 0): boolean {
    return this.jobQueue.add(name, job, priority, retryCount);
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
    const added = this.addJobToQueue(name, job, priority, retryCount);
    
    // 작업이 추가되었고 스케줄러가 실행 중이면, 즉시 처리 시도
    // (processQueue가 100ms마다 실행되지만, 즉시 실행도 시도)
    if (added && this.isRunning && this.jobProcessorInterval) {
      // 비동기로 즉시 처리 시도 (블로킹하지 않음)
      setImmediate(() => {
        if (this.jobQueue.isEmpty || this.jobQueue.runningCount >= this.config.maxConcurrentJobs) {
          return;
        }
        
        const nextJob = this.jobQueue.peekNext();
        if (!nextJob || nextJob.name !== name) {
          return;
        }

        const immediateJob = this.jobQueue.getNext();
        if (!immediateJob) {
          return;
        }

        // 등록한 작업이 다음 작업이면 즉시 실행
        this.executeJobWithRetry(
          immediateJob.name,
          immediateJob.job,
          immediateJob.priority,
          immediateJob.retryCount ?? 0
        ).catch(err => {
          this.log(`Failed to execute job ${name} immediately`, { error: err }, 'error');
        });
      });
    }
    
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
      this.addJobToQueue(name, job, priority, 0);
    };

    // 즉시 실행도 큐를 통해 실행 (maxConcurrentJobs 보장, 중복 방지 포함)
    // 여러 작업이 동시에 시작될 때 race condition 방지
    this.addJobToQueue(name, job, priority, 0);

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
    const processQueue = async () => {
      // PRD 6.2: maxConcurrentJobs 제한으로 충돌 방지
      // Triple 추출 배치 작업도 이 제한에 포함되어 다른 배치 작업과 동시 실행 방지
      if (this.jobQueue.isEmpty || this.jobQueue.runningCount >= this.config.maxConcurrentJobs) {
        return;
      }

      const nextJob = this.jobQueue.getNext();
      if (nextJob) {
        // 재시도 큐에서도 동일한 래퍼를 사용하여 타임아웃/상태 관리가 적용되도록 함
        // 재시도 시 저장된 retryCount를 사용하여 무한 재시도 방지
        const retryCount = nextJob.retryCount ?? 0;
        await this.executeJobWithRetry(nextJob.name, nextJob.job, nextJob.priority, retryCount);
      }
    };

    // 큐 처리 인터벌 (ID 저장)
    this.jobProcessorInterval = setInterval(
      processQueue,
      resolveValidatedNumber('BATCH_JOB_PROCESSOR_INTERVAL_MS', 1000, n => n >= 100, '최솟값 100')
    );
  }

  /**
   * 타임아웃과 함께 작업 실행
   */
  private async executeWithTimeout<T>(promise: () => Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      promise(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Job timeout after ${timeout}ms`)), timeout);
      })
    ]);
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

  /**
   * 메모리 정리 작업 실행
   */
  private async runMemoryCleanup(): Promise<BatchJobResult> {
    const startTime = new Date();
    const result: BatchJobResult = {
      jobType: 'memory_cleanup',
      startTime,
      endTime: new Date(),
      duration: 0,
      success: false,
      processed: 0,
      errors: [],
      warnings: []
    };

    try {
      if (!this.db) {
        throw new Error('Database not initialized');
      }

      // 데이터베이스 연결 상태 확인
      // better-sqlite3는 close() 후에도 객체가 남아있지만 연결은 닫혀있으므로 확인 필요
      if (!DatabaseUtils.isOpen(this.db)) {
        throw new Error('Database connection is not open. The database may have been closed.');
      }

      this.log('Starting memory cleanup job');

      // 망각 정책 서비스로 메모리 정리 실행
      const cleanupResult: MemoryCleanupResult = await this.forgettingService.executeMemoryCleanup(this.db);

      result.success = true;
      result.processed = cleanupResult.totalProcessed;
      result.details = cleanupResult;

      if (cleanupResult.softDeleted.length > 0) {
        result.warnings.push(`${cleanupResult.softDeleted.length} memories soft deleted`);
      }
      if (cleanupResult.hardDeleted.length > 0) {
        result.warnings.push(`${cleanupResult.hardDeleted.length} memories hard deleted`);
      }

      this.log('Memory cleanup completed', {
        processed: cleanupResult.totalProcessed,
        softDeleted: cleanupResult.softDeleted.length,
        hardDeleted: cleanupResult.hardDeleted.length,
        reviewed: cleanupResult.reviewed.length
      });

    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
      this.log('Memory cleanup failed:', error, 'error');
    } finally {
      result.endTime = new Date();
      result.duration = result.endTime.getTime() - result.startTime.getTime();
    }

    return result;
  }

  /**
   * 모니터링 작업 실행
   */
  private async runMonitoring(): Promise<BatchJobResult> {
    const startTime = new Date();
    const result: BatchJobResult = {
      jobType: 'monitoring',
      startTime,
      endTime: new Date(),
      duration: 0,
      success: false,
      processed: 0,
      errors: [],
      warnings: []
    };

    try {
      if (!this.db) {
        throw new Error('Database not initialized');
      }

      // 성능 모니터로 지표 수집 (tick=true: CPU baseline 갱신)
      const metrics = await this.performanceMonitor.collectMetrics({ tick: true });
      
      // 데이터베이스 상태 확인
      const stats = await this.getDatabaseStats();
      
      // 활성 알림 확인
      const alerts = this.performanceMonitor.getActiveAlerts();

      result.success = true;
      result.processed = 1;
      result.details = { 
        metrics, 
        stats, 
        alerts: {
          count: alerts.length,
          critical: alerts.filter((a: PerformanceAlert) => a.severity === 'critical').length,
          warning: alerts.filter((a: PerformanceAlert) => a.severity === 'warning').length
        }
      };

      // 경고 처리
      if (alerts.length > 0) {
        result.warnings.push(`${alerts.length} active alerts`);
      }

      this.log('Monitoring completed', { 
        metrics: {
          memoryUsage: `${((metrics.memory.heapUsed / metrics.memory.heapTotal) * 100).toFixed(1)}%`,
          dbSize: `${(metrics.database.size / (1024 * 1024)).toFixed(1)}MB`,
          queryTime: `${metrics.database.queryTime}ms`
        },
        alerts: alerts.length
      });

    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
      this.log('Monitoring failed:', error, 'error');
    } finally {
      result.endTime = new Date();
      result.duration = result.endTime.getTime() - result.startTime.getTime();
    }

    return result;
  }

  /**
   * 헬스체크 작업 실행
   */
  private async runHealthCheck(): Promise<BatchJobResult> {
    const startTime = new Date();
    const result: BatchJobResult = {
      jobType: 'healthcheck',
      startTime,
      endTime: new Date(),
      duration: 0,
      success: false,
      processed: 0,
      errors: [],
      warnings: []
    };

    try {
      // HealthChecker를 사용하여 헬스체크 실행
      const healthResult = await this.healthChecker.check(
        this.db,
        this.jobQueue.runningCount,
        this.jobQueue.size,
        this.config.maxConcurrentJobs
      );

      result.success = healthResult.isHealthy;
      result.processed = 1;
      result.warnings = healthResult.warnings;
      result.errors = healthResult.errors;
      result.details = {
        memoryUsage: healthResult.memoryUsage,
        runningJobs: healthResult.runningJobs,
        queueSize: healthResult.queueSize,
        uptime: healthResult.uptime
      };

    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
      this.log('Health check failed:', error, 'error');
    } finally {
      result.endTime = new Date();
      result.duration = result.endTime.getTime() - result.startTime.getTime();
    }

    return result;
  }

  /**
   * Consolidation Score 증분 재계산 작업 실행
   */
  private async runConsolidationScoreIncremental(): Promise<BatchJobResult> {
    const startTime = new Date();
    const result: BatchJobResult = {
      jobType: 'consolidation_score_incremental',
      startTime,
      endTime: new Date(),
      duration: 0,
      success: false,
      processed: 0,
      errors: [],
      warnings: []
    };

    try {
      if (!this.db) {
        throw new Error('Database not initialized');
      }

      if (!this.consolidationScoreWorker) {
        throw new Error('ConsolidationScoreWorker not initialized');
      }

      this.log('Starting consolidation score incremental recalculation');

      const recalculationResult = await this.consolidationScoreWorker.runIncrementalRecalculation(this.db);

      result.success = recalculationResult.success;
      result.processed = recalculationResult.processed;
      result.details = recalculationResult;
      
      if (recalculationResult.errors.length > 0) {
        result.errors.push(...recalculationResult.errors);
      }
      if (recalculationResult.warnings.length > 0) {
        result.warnings.push(...recalculationResult.warnings);
      }

      this.log('Consolidation score incremental recalculation completed', {
        processed: recalculationResult.processed,
        updated: recalculationResult.updated,
        skipped: recalculationResult.skipped,
        errors: recalculationResult.errors.length
      });

    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
      this.log('Consolidation score incremental recalculation failed:', error, 'error');
    } finally {
      result.endTime = new Date();
      result.duration = result.endTime.getTime() - result.startTime.getTime();
    }

    return result;
  }

  /**
   * Consolidation Score 전체 스윕 작업 스케줄링
   * 지정된 시간에 하루 1회 실행
   * 큐를 통해 실행하여 maxConcurrentJobs, 타임아웃, 재시도, lastExecution 기록이 적용되도록 함
   */
  private scheduleConsolidationScoreFullSweep(): void {
    const checkAndRun = () => {
      const now = new Date();
      const currentHour = now.getHours();
      
      // 지정된 시간에 실행
      if (currentHour === this.config.consolidationScoreFullSweepHour) {
        // 이미 오늘 실행했는지 확인 (lastExecution 체크)
        const lastExecution = this.lastExecution.get('consolidation_score_full_sweep');
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        if (!lastExecution || lastExecution < today) {
          // 큐를 통해 실행하여 maxConcurrentJobs, 타임아웃, 재시도, lastExecution 기록이 적용되도록 함 (중복 방지 포함)
          this.addJobToQueue(
            'consolidation_score_full_sweep',
            async () => { await this.runConsolidationScoreFullSweep(); },
            4, // consolidation_score_incremental과 동일한 우선순위
            0
          );
        }
      }
    };

    // 매 시간마다 체크 (config 기반 간격 사용)
    const checkInterval = 60 * 60 * 1000; // 1시간마다 체크
    const intervalId = setInterval(checkAndRun, checkInterval);
    
    // intervals Map에 저장하여 stop()에서 정리 가능하도록 함
    this.intervals.set('consolidation_score_full_sweep', intervalId);
    
    // 즉시 한 번 체크 (현재 시간이 지정된 시간이면 실행)
    checkAndRun();
  }

  /**
   * 주간 관계 추출 품질 검증 작업 스케줄링
   * 큐를 통해 실행하여 maxConcurrentJobs, 타임아웃, 재시도, lastExecution 기록이 적용되도록 함
   */
  private scheduleWeeklyRelationValidation(): void {
    const checkAndRun = () => {
      const now = new Date();
      const currentDayOfWeek = now.getDay(); // 0=일요일, 6=토요일
      const currentHour = now.getHours();
      
      // 지정된 요일과 시간에 실행
      if (currentDayOfWeek === this.config.relationValidationDayOfWeek && 
          currentHour === this.config.relationValidationHour) {
        // 이미 오늘 실행했는지 확인 (lastExecution 체크)
        const lastExecution = this.lastExecution.get('weekly_relation_validation');
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        if (!lastExecution || lastExecution < today) {
          // 큐를 통해 실행하여 maxConcurrentJobs, 타임아웃, 재시도, lastExecution 기록이 적용되도록 함 (중복 방지 포함)
          this.addJobToQueue(
            'weekly_relation_validation',
            async () => { await this.runWeeklyRelationValidation(); },
            5, // 다른 작업보다 낮은 우선순위
            0
          );
        }
      }
    };

    // 매 시간마다 체크
    const checkInterval = 60 * 60 * 1000; // 1시간마다 체크
    const intervalId = setInterval(checkAndRun, checkInterval);
    this.intervals.set('weekly_relation_validation', intervalId);
    
    // 즉시 한 번 체크 (시작 시점이 실행 시간이면 바로 실행)
    checkAndRun();
  }

  /**
   * 주간 관계 추출 품질 검증 실행
   * 타임아웃 및 강제 종료 로직 포함
   */
  private async runWeeklyRelationValidation(): Promise<BatchJobResult> {
    const startTime = new Date();
    const result: BatchJobResult = {
      jobType: 'weekly_relation_validation',
      startTime,
      endTime: new Date(),
      duration: 0,
      success: false,
      processed: 0,
      errors: [],
      warnings: []
    };

    try {
      this.log('Starting weekly relation validation...');

      // RelationValidatorExecutor를 사용하여 스크립트 실행
      const timeout = this.config.weeklyRelationValidationTimeout ?? this.config.jobTimeout;
      const executorResult = await this.relationValidatorExecutor.execute([], timeout);

      result.success = executorResult.success;
      result.endTime = new Date();
      result.duration = executorResult.duration;
      result.processed = 1;

      if (executorResult.error) {
        result.errors.push(executorResult.error);
      }

      if (executorResult.success) {
        this.log('Weekly relation validation completed successfully', {
          duration: result.duration,
          stdout: executorResult.stdout.substring(0, 500) // 처음 500자만 로그
        });
      } else {
        this.log('Weekly relation validation failed', {
          error: executorResult.error,
          duration: result.duration,
          stderr: executorResult.stderr.substring(0, 500)
        }, 'error');
      }

    } catch (error) {
      result.endTime = new Date();
      result.duration = result.endTime.getTime() - startTime.getTime();
      result.errors.push(error instanceof Error ? error.message : String(error));

      this.log('Weekly relation validation failed', {
        error: error instanceof Error ? error.message : String(error),
        duration: result.duration
      }, 'error');
    }

    return result;
  }

  /**
   * Consolidation Score 전체 스윕 작업 실행
   */
  private async runConsolidationScoreFullSweep(): Promise<BatchJobResult> {
    const startTime = new Date();
    const result: BatchJobResult = {
      jobType: 'consolidation_score_full_sweep',
      startTime,
      endTime: new Date(),
      duration: 0,
      success: false,
      processed: 0,
      errors: [],
      warnings: []
    };

    try {
      if (!this.db) {
        throw new Error('Database not initialized');
      }

      if (!this.consolidationScoreWorker) {
        throw new Error('ConsolidationScoreWorker not initialized');
      }

      this.log('Starting consolidation score full sweep recalculation');

      const recalculationResult = await this.consolidationScoreWorker.runFullSweep(this.db);

      result.success = recalculationResult.success;
      result.processed = recalculationResult.processed;
      result.details = recalculationResult;
      
      if (recalculationResult.errors.length > 0) {
        result.errors.push(...recalculationResult.errors);
      }
      if (recalculationResult.warnings.length > 0) {
        result.warnings.push(...recalculationResult.warnings);
      }

      this.log('Consolidation score full sweep recalculation completed', {
        processed: recalculationResult.processed,
        updated: recalculationResult.updated,
        skipped: recalculationResult.skipped,
        errors: recalculationResult.errors.length,
        duration: recalculationResult.duration
      });

    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
      this.log('Consolidation score full sweep recalculation failed:', error, 'error');
    } finally {
      result.endTime = new Date();
      result.duration = result.endTime.getTime() - result.startTime.getTime();
    }

    return result;
  }

  /**
   * 데이터베이스 통계 수집
   */
  private async getDatabaseStats(): Promise<any> {
    if (!this.db) return {};

    try {
      const stats = this.db.prepare(`
        SELECT 
          type,
          COUNT(*) as count,
          COUNT(CASE WHEN pinned = TRUE THEN 1 END) as pinned_count,
          COUNT(CASE WHEN created_at < datetime('now', '-30 days') THEN 1 END) as old_count,
          AVG(importance) as avg_importance
        FROM memory_item 
        GROUP BY type
      `).all();

      const totalMemories = this.db.prepare('SELECT COUNT(*) as count FROM memory_item').get() as { count: number };
      const dbSize = this.db.prepare('PRAGMA page_count').get() as { page_count: number };
      const pageSize = this.db.prepare('PRAGMA page_size').get() as { page_size: number };

      return {
        memoryStats: stats,
        totalMemories: totalMemories.count,
        estimatedSize: dbSize.page_count * pageSize.page_size
      };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
    } catch (error) {
      this.log('Failed to collect database stats:', error, 'warn');
      return {};
    }
  }

  /**
   * 로깅
   * data 객체에 level 속성이 있으면 이를 우선적으로 사용하여 호출부의 편의성을 높임
   */
  private log(message: string, data?: any, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (!this.config.enableLogging) return;

    // 배치 작업 컨텍스트 정보 추가
    // Error 객체는 non-enumerable 속성을 가지므로 명시적으로 처리 필요
    let safeData: Record<string, any>;
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
   * 밀리초를 사람이 읽기 쉬운 형태로 변환
   * @param milliseconds 밀리초
   * @returns 포맷된 시간 문자열 (예: "2h 30m 15s", "45s", "1d 3h")
   */
  private formatUptime(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    // 일 단위가 있으면 일로 표시
    if (days > 0) {
      const remainingHours = hours % 24;
      return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
    }
    
    // 시간 단위가 있으면 시간으로 표시
    if (hours > 0) {
      const remainingMinutes = minutes % 60;
      return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
    }
    
    // 분 단위가 있으면 분으로 표시
    if (minutes > 0) {
      const remainingSeconds = seconds % 60;
      return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    }
    
    // 초 단위만 있으면 초로 표시
    return `${seconds}s`;
  }

  /**
   * 수동으로 작업 실행
   * 직접 실행하되 lastExecution과 totalExecutions을 기록함
   */
  async runJob(
    jobType: 'cleanup' | 'monitoring' | 'healthcheck' | 'meta_memory_introspection'
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
      default:
        throw new Error(`Unknown job type: ${jobType}`);
    }

    // lastExecution과 totalExecutions 업데이트 (큐를 통한 실행과 일관성 유지)
    this.lastExecution.set(jobType, new Date());
    this.totalExecutions.set(jobType, (this.totalExecutions.get(jobType) || 0) + 1);
    
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
    this.validateConfig();
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
    if (jobName === 'cleanup') {
      this.scheduleJob('cleanup', this.config.cleanupInterval, async () => { await this.runMemoryCleanup(); }, 1);
    } else if (jobName === 'monitoring') {
      this.scheduleJob('monitoring', this.config.monitoringInterval, async () => { await this.runMonitoring(); }, 2);
    } else if (jobName === 'healthcheck') {
      this.scheduleJob('healthcheck', this.config.healthCheckInterval, async () => { await this.runHealthCheck(); }, 3);
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
    const startTime = new Date();
    const result: BatchJobResult = {
      jobType: 'triple_extraction_batch',
      startTime,
      endTime: new Date(),
      duration: 0,
      success: false,
      processed: 0,
      errors: [],
      warnings: []
    };

    try {
      if (!this.db) {
        throw new Error('Database not initialized');
      }

      // TripleExtractionBatchJob 초기화 (아직 초기화되지 않은 경우)
      if (!this.tripleExtractionBatchJob) {
        this.tripleExtractionBatchJob = new TripleExtractionBatchJob({
          batchSize: this.config.tripleExtractionBatchSize,
          timeout: this.config.tripleExtractionTimeout,
          chunkSize: 5, // SQLite WAL 환경 고려
          chunkDelayMs: 100 // 청크 사이 지연
        });
      }

      // 배치 작업 실행
      const batchResult = await this.tripleExtractionBatchJob.execute(this.db);

      // 결과 반영
      result.success = batchResult.success;
      result.processed = batchResult.processed;
      result.errors = batchResult.errors;
      result.warnings = batchResult.warnings;
      result.details = batchResult.details;

      // 실행 기록 업데이트
      this.lastExecution.set('triple_extraction_batch', new Date());
      this.totalExecutions.set(
        'triple_extraction_batch',
        (this.totalExecutions.get('triple_extraction_batch') || 0) + 1
      );

      this.log('Triple extraction batch job completed', {
        processed: batchResult.details.processed,
        success: batchResult.details.success,
        failed: batchResult.details.failed,
        semanticMemoriesCreated: batchResult.details.semanticMemoriesCreated,
        semanticMemoriesUpdated: batchResult.details.semanticMemoriesUpdated
      });

    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
      this.log('Triple extraction batch job failed:', error, 'error');
    } finally {
      result.endTime = new Date();
      result.duration = result.endTime.getTime() - result.startTime.getTime();
    }

    return result;
  }

  /**
   * Triple 추출 배치 작업 스케줄링
   * 
   * PRD 6.1: 주기적 배치 실행
   * - 주기: 매일 새벽 2시 (설정 가능, tripleExtractionInterval, tripleExtractionHour 설정)
   * - tripleExtractionHour가 지정된 경우 해당 시간에만 실행
   * - tripleExtractionHour가 지정되지 않은 경우 interval마다 실행
   * 
   * PRD 6.2: 기존 배치 작업과 충돌 방지
   * - BatchScheduler의 maxConcurrentJobs 설정 고려
   * - Triple 추출 배치 작업은 다른 배치 작업과 동시 실행되지 않도록 스케줄링
   * - Triple Extraction Job은 독립적인 작업 큐로 관리
   * - 우선순위 6 설정 (로그 로테이션 다음, 다른 중요 작업보다 낮은 우선순위)
   * - JobQueue를 통해 실행하여 maxConcurrentJobs 제한 및 중복 방지 적용
   */
  private scheduleTripleExtractionBatch(): void {
    if (this.config.tripleExtractionHour !== undefined) {
      // 특정 시간에만 실행 (예: 매일 새벽 2시)
      // PRD 6.1: 주기: 매일 새벽 2시 (설정 가능)
      // scheduleConsolidationScoreFullSweep()와 동일한 패턴 사용
      const checkAndRun = () => {
        const now = new Date();
        const currentHour = now.getHours();
        
        // 지정된 시간에 실행
        if (currentHour === this.config.tripleExtractionHour) {
          // 이미 오늘 실행했는지 확인 (lastExecution 체크)
          const lastExecution = this.lastExecution.get('triple_extraction_batch');
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          
          if (!lastExecution || lastExecution < today) {
            // 큐를 통해 실행하여 maxConcurrentJobs, 타임아웃, 재시도, lastExecution 기록이 적용되도록 함 (중복 방지 포함)
            this.addJobToQueue(
              'triple_extraction_batch',
              async () => { await this.runTripleExtractionBatch(); },
              6, // 우선순위 6 (로그 로테이션 다음)
              0
            );
          }
        }
      };

      // 매 시간마다 체크 (config 기반 간격 사용)
      const checkInterval = 60 * 60 * 1000; // 1시간마다 체크
      const intervalId = setInterval(checkAndRun, checkInterval);
      
      // intervals Map에 저장하여 stop()에서 정리 가능하도록 함
      this.intervals.set('triple_extraction_batch', intervalId);
      
      // 즉시 한 번 체크 (현재 시간이 지정된 시간이면 실행)
      checkAndRun();
    } else {
      // interval마다 실행 (기본: 1시간마다)
      // PRD 6.1: 주기: 매일 새벽 2시 (설정 가능, tripleExtractionInterval)
      // PRD 6.2: 기존 배치 작업과 충돌 방지
      // scheduleJob()은 내부적으로 addJobToQueue()를 사용하여 maxConcurrentJobs 제한 및 중복 방지 적용
      // 우선순위 6 설정: 로그 로테이션(5) 다음, 다른 중요 작업보다 낮은 우선순위
      this.scheduleJob(
        'triple_extraction_batch',
        this.config.tripleExtractionInterval,
        async () => { await this.runTripleExtractionBatch(); },
        6 // 우선순위 6 (로그 로테이션 다음, 다른 중요 작업보다 낮은 우선순위)
      );
    }
  }

  /**
   * 품질 측정 배치 작업 스케줄링
   * 
   * PRD FR-5.6: 일일 품질 측정 배치 작업
   * - 기본: 24시간마다 실행
   * - 특정 시간 지정 시: 해당 시간에만 실행
   */
  private scheduleQualityMeasurement(): void {
    if (this.config.qualityMeasurementHour !== undefined) {
      // 특정 시간에만 실행 (예: 매일 새벽 3시)
      const checkAndRun = () => {
        const now = new Date();
        const currentHour = now.getHours();
        
        // 지정된 시간에 실행
        if (currentHour === this.config.qualityMeasurementHour) {
          // 이미 오늘 실행했는지 확인 (lastExecution 체크)
          const lastExecution = this.lastExecution.get('quality_measurement_batch');
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          
          if (!lastExecution || lastExecution < today) {
            // 큐를 통해 실행하여 maxConcurrentJobs, 타임아웃, 재시도, lastExecution 기록이 적용되도록 함 (중복 방지 포함)
            this.addJobToQueue(
              'quality_measurement_batch',
              async () => { await this.runQualityMeasurementBatch(); },
              7, // 우선순위 7 (다른 배치 작업보다 낮은 우선순위)
              0
            );
          }
        }
      };

      // 매 시간마다 체크
      const checkInterval = 60 * 60 * 1000; // 1시간마다 체크
      const intervalId = setInterval(checkAndRun, checkInterval);
      
      // intervals Map에 저장하여 stop()에서 정리 가능하도록 함
      this.intervals.set('quality_measurement_batch', intervalId);
      
      // 즉시 한 번 체크 (현재 시간이 지정된 시간이면 실행)
      checkAndRun();
    } else {
      // interval마다 실행 (기본: 24시간마다)
      // scheduleJob()은 내부적으로 addJobToQueue()를 사용하여 maxConcurrentJobs 제한 및 중복 방지 적용
      // 우선순위 7 설정: 다른 배치 작업보다 낮은 우선순위
      this.scheduleJob(
        'quality_measurement_batch',
        this.config.qualityMeasurementInterval,
        async () => { await this.runQualityMeasurementBatch(); },
        7 // 우선순위 7 (다른 배치 작업보다 낮은 우선순위)
      );
    }
  }

  /**
   * M2 자기성찰 스캔 실행 (Issue #21)
   * meta_memory_stats를 스캔하여 저신뢰·고실패 메모리를 식별하고 요약합니다.
   */
  private async runMetaMemoryIntrospection(): Promise<BatchJobResult> {
    const startTime = new Date();
    const result: BatchJobResult = {
      jobType: 'meta_memory_introspection',
      startTime,
      endTime: new Date(),
      duration: 0,
      success: false,
      processed: 0,
      errors: [],
      warnings: []
    };

    try {
      if (!this.db) {
        throw new Error('Database not initialized');
      }

      const scanResult = await MetaMemoryIntrospectionService.runScan(this.db, {});
      result.endTime = new Date();
      result.duration = result.endTime.getTime() - startTime.getTime();
      result.success = true;
      result.processed =
        scanResult.lowConfidenceMemoryIds.length + scanResult.highFailureMemoryIds.length;
      result.details = {
        lowConfidenceMemoryIds: scanResult.lowConfidenceMemoryIds,
        highFailureMemoryIds: scanResult.highFailureMemoryIds,
        summary: scanResult.summary
      };

      this.lastExecution.set('meta_memory_introspection', new Date());
      this.totalExecutions.set(
        'meta_memory_introspection',
        (this.totalExecutions.get('meta_memory_introspection') || 0) + 1
      );

      this.introspectionScanCache?.set(scanResult, result.endTime.toISOString());

      this.log('Meta memory introspection scan completed', {
        duration: result.duration,
        lowConfidenceCount: scanResult.lowConfidenceMemoryIds.length,
        highFailureCount: scanResult.highFailureMemoryIds.length,
        summary: scanResult.summary
      });
      return result;
    } catch (error) {
      result.endTime = new Date();
      result.duration = result.endTime.getTime() - startTime.getTime();
      result.success = false;
      result.errors.push(error instanceof Error ? error.message : String(error));
      this.log('Meta memory introspection scan error', {
        duration: result.duration,
        error: error instanceof Error ? error.message : String(error)
      }, 'error');
      return result;
    }
  }

  /**
   * 품질 측정 배치 작업 실행
   * 
   * PRD FR-5.6: 일일 품질 측정 배치 작업
   */
  private async runQualityMeasurementBatch(): Promise<BatchJobResult> {
    const startTime = new Date();
    const result: BatchJobResult = {
      jobType: 'quality_measurement_batch',
      startTime,
      endTime: new Date(),
      duration: 0,
      success: false,
      processed: 0,
      errors: [],
      warnings: []
    };

    try {
      if (!this.db) {
        throw new Error('Database not initialized');
      }

      // QualityMeasurementBatchJob 초기화 (아직 초기화되지 않은 경우)
      if (!this.qualityMeasurementBatchJob) {
        this.qualityMeasurementBatchJob = new QualityMeasurementBatchJob({
          measurementType: 'batch',
          context: 'default',
          record: true,
          generateReport: true,
          reportFormat: 'markdown',
          timeout: this.config.jobTimeout
        });
      }

      // 배치 작업 실행
      const batchResult = await this.qualityMeasurementBatchJob.execute(this.db);

      // 결과 변환
      result.endTime = new Date();
      result.duration = result.endTime.getTime() - startTime.getTime();
      result.success = batchResult.success;
      result.processed = batchResult.processed;
      result.errors = batchResult.errors;
      result.warnings = batchResult.warnings;
      result.details = batchResult.details;

      // 실행 기록 업데이트
      this.lastExecution.set('quality_measurement_batch', new Date());
      this.totalExecutions.set(
        'quality_measurement_batch',
        (this.totalExecutions.get('quality_measurement_batch') || 0) + 1
      );

      // 로깅
      if (batchResult.success) {
        this.log('Quality measurement batch job completed', {
          duration: result.duration,
          processed: result.processed,
          overallStatus: batchResult.details.overallStatus,
          totalMetrics: batchResult.details.totalMetrics,
          passedMetrics: batchResult.details.passedMetrics,
          failedMetrics: batchResult.details.failedMetrics,
          warningMetrics: batchResult.details.warningMetrics
        });
      } else {
        this.log('Quality measurement batch job failed', {
          duration: result.duration,
          errors: result.errors
        }, 'error');
      }

      return result;
    } catch (error) {
      result.endTime = new Date();
      result.duration = result.endTime.getTime() - startTime.getTime();
      result.success = false;
      result.errors.push(error instanceof Error ? error.message : String(error));

      this.log('Quality measurement batch job error', {
        duration: result.duration,
        error: error instanceof Error ? error.message : String(error)
      }, 'error');

      return result;
    }
  }

  /**
   * 로그 로테이션 실행
   * 30일 이상 된 Triple 추출 로그 파일을 삭제합니다.
   */
  private async runLogRotation(): Promise<BatchJobResult> {
    const startTime = new Date();
    const errors: string[] = [];
    const warnings: string[] = [];
    let deletedCount = 0;

    try {
      this.log('Starting log rotation...', { jobType: 'log_rotation' });
      
      // Triple 추출 로그 파일 정리 (30일 이상 된 파일 삭제)
      deletedCount = await tripleExtractionLogger.deleteOldLogs(30);
      
      this.log('Log rotation completed', {
        jobType: 'log_rotation',
        deletedFiles: deletedCount
      });

      if (deletedCount > 0) {
        this.log(`Deleted ${deletedCount} old log file(s)`, {
          jobType: 'log_rotation',
          retentionDays: 30
        });
      }

      const endTime = new Date();
      return {
        jobType: 'log_rotation',
        startTime,
        endTime,
        duration: endTime.getTime() - startTime.getTime(),
        success: true,
        processed: deletedCount,
        errors,
        warnings
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(errorMessage);
      
      this.log('Log rotation failed', {
        jobType: 'log_rotation',
        error: errorMessage
      }, 'error');

      const endTime = new Date();
      return {
        jobType: 'log_rotation',
        startTime,
        endTime,
        duration: endTime.getTime() - startTime.getTime(),
        success: false,
        processed: deletedCount,
        errors,
        warnings
      };
    }
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
   * Issue #21 Phase B: 인트로스펙션 스캔 결과 캐시 설정.
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

  getLastJobRunMeta(
    name: string
  ): { at: Date; success: boolean; durationMs: number } | undefined {
    return this.lastJobRunMeta.get(name);
  }

  private scheduleSleepConsolidation(): void {
    this.scheduleJob(
      'sleep_consolidation_batch',
      this.config.sleepConsolidationInterval,
      async () => {
        await this.runSleepConsolidationBatch();
      },
      8
    );
  }

  private scheduleTelemetryCleanup(): void {
    this.scheduleJob(
      'telemetry_cleanup_batch',
      this.config.telemetryCleanupInterval,
      async () => {
        await this.runTelemetryCleanupBatch();
      },
      9
    );
  }

  private async runTelemetryCleanupBatch(): Promise<void> {
    if (!this.telemetryCleanupRepository) {
      return;
    }
    if (!this.telemetryCleanupBatchJob) {
      this.telemetryCleanupBatchJob = new TelemetryCleanupBatchJob({
        repository: this.telemetryCleanupRepository
      });
    }
    await this.telemetryCleanupBatchJob.execute();
  }

  private async runSleepConsolidationBatch(): Promise<BatchJobResult> {
    try {
      if (!this.sleepConsolidationService) {
        throw new Error('SleepConsolidationService not configured');
      }
      if (!this.sleepConsolidationBatchJob) {
        this.sleepConsolidationBatchJob = new SleepConsolidationBatchJob({
          sleepConsolidationService: this.sleepConsolidationService,
          fileLogger: this.fileLogger
        });
      }
      const batchResult = await this.sleepConsolidationBatchJob.execute();

      this.lastExecution.set('sleep_consolidation_batch', new Date());
      this.totalExecutions.set(
        'sleep_consolidation_batch',
        (this.totalExecutions.get('sleep_consolidation_batch') || 0) + 1
      );

      return batchResult;
    } catch (error) {
      const startTime = new Date();
      const endTime = new Date();
      const message = error instanceof Error ? error.message : String(error);
      this.log('Sleep consolidation batch failed', { error: message }, 'error');
      return {
        jobType: 'sleep_consolidation_batch',
        startTime,
        endTime,
        duration: endTime.getTime() - startTime.getTime(),
        success: false,
        processed: 0,
        errors: [message],
        warnings: []
      };
    }
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