/**
 * 배치 작업 스케줄러
 * TTL 기반 메모리 정리 및 기타 주기적 작업을 자동화
 * Memento MCP Server의 핵심 배치 처리 컴포넌트
 */

import { ForgettingPolicyService, type MemoryCleanupResult } from '../../domains/forgetting/services/forgetting-policy-service.js';
import { getPerformanceMonitor, type PerformanceAlert } from '../../domains/monitoring/services/performance-monitor.js';
import Database from 'better-sqlite3';
import { ConsolidationScoreWorker } from '../../workers/consolidation-score-worker.js';
import { ReflexionWorker } from '../reflexion-worker.js';
import { mementoConfig } from '../../shared/config/index.js';
import { mcpLogger } from '../../server/mcp-logger.js';
import { JobQueue } from './job-queue.js';
import { RetryManager } from './retry-manager.js';
import { HealthChecker } from './health-checker.js';
import { FileLogger } from './file-logger.js';
import { RelationValidatorExecutor } from './relation-validator-executor.js';

export interface BatchJobConfig {
  // 배치 작업 간격 (밀리초)
  cleanupInterval: number;        // 메모리 정리 간격 (기본: 1시간)
  monitoringInterval: number;     // 모니터링 간격 (기본: 5분)
  healthCheckInterval: number;    // 헬스체크 간격 (기본: 30초)
  consolidationScoreIncrementalInterval: number;  // Consolidation Score 증분 재계산 간격 (기본: 1시간)
  consolidationScoreFullSweepInterval: number;   // Consolidation Score 전체 스윕 간격 (기본: 24시간)
  consolidationScoreFullSweepHour: number;        // 전체 스윕 실행 시간 (0-23, 기본: 3시)
  relationValidationInterval: number;            // 관계 추출 품질 검증 간격 (기본: 7일)
  relationValidationDayOfWeek: number;           // 주간 검증 실행 요일 (0=일요일, 기본: 0)
  relationValidationHour: number;                // 주간 검증 실행 시간 (0-23, 기본: 2시)
  
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

export class BatchScheduler {
  private config: BatchJobConfig;
  private forgettingService: ForgettingPolicyService;
  private performanceMonitor: ReturnType<typeof getPerformanceMonitor>;
  private consolidationScoreWorker: ConsolidationScoreWorker | null = null;
  private reflexionWorker: ReflexionWorker | null = null;
  private db: Database.Database | null = null;
  private intervals: Map<string, ReturnType<typeof setInterval>> = new Map();
  private isRunning = false;
  private startTime: Date | null = null;
  private lastExecution: Map<string, Date> = new Map();
  private totalExecutions: Map<string, number> = new Map();
  private jobProcessorInterval: ReturnType<typeof setInterval> | null = null;

  // 분리된 모듈들 (DI)
  private jobQueue: JobQueue;
  private retryManager: RetryManager;
  private healthChecker: HealthChecker;
  private fileLogger: FileLogger;
  private relationValidatorExecutor: RelationValidatorExecutor;

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
      cleanupInterval: 60 * 60 * 1000,    // 1시간
      monitoringInterval: 5 * 60 * 1000,   // 5분
      healthCheckInterval: 30 * 1000,      // 30초
      consolidationScoreIncrementalInterval: 60 * 60 * 1000,  // 1시간
      consolidationScoreFullSweepInterval: 24 * 60 * 60 * 1000, // 24시간
      consolidationScoreFullSweepHour: 3,  // 새벽 3시
      relationValidationInterval: 7 * 24 * 60 * 60 * 1000, // 7일
      relationValidationDayOfWeek: 0,     // 일요일
      relationValidationHour: 2,          // 새벽 2시
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
  async start(db: Database.Database, reflexionWorker?: ReflexionWorker): Promise<void> {
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
    if (this.config.maxBatchSize < 1) {
      throw new Error('maxBatchSize must be at least 1');
    }
    if (this.config.maxConcurrentJobs < 1) {
      throw new Error('maxConcurrentJobs must be at least 1');
    }
    if (this.config.jobTimeout < 1000) {
      throw new Error('jobTimeout must be at least 1 second');
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

    try {
      await this.executeWithTimeout(job, this.config.jobTimeout);
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
      this.jobQueue.markCompleted(name);
    }
  }

  /**
   * 큐에 작업 추가 (중복 방지 포함)
   * 동일 이름의 잡이 이미 큐에 있거나 실행 중이면 추가하지 않음
   */
  private addJobToQueue(name: string, job: () => Promise<void>, priority: number, retryCount: number = 0): boolean {
    return this.jobQueue.add(name, job, priority, retryCount);
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
   */
  private startJobProcessor(): void {
    const processQueue = async () => {
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
    this.jobProcessorInterval = setInterval(processQueue, 100);
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

      // 성능 모니터로 지표 수집
      const metrics = await this.performanceMonitor.collectMetrics();
      
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
          // 파일 로깅 실패는 콘솔에만 기록 (무한 루프 방지)
          console.error('File logging failed:', error);
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
          // 파일 로깅 실패는 콘솔에만 기록 (무한 루프 방지)
          console.error('File logging failed:', error);
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
  async runJob(jobType: 'cleanup' | 'monitoring' | 'healthcheck'): Promise<BatchJobResult> {
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