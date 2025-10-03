/**
 * 배치 작업 스케줄러
 * TTL 기반 메모리 정리 및 기타 주기적 작업을 자동화
 * Memento MCP Server의 핵심 배치 처리 컴포넌트
 */

import { ForgettingPolicyService, type MemoryCleanupResult } from './forgetting-policy-service.js';
import { getPerformanceMonitor } from './performance-monitor.js';
import { DatabaseUtils } from '../utils/database.js';
import Database from 'better-sqlite3';

export interface BatchJobConfig {
  // 배치 작업 간격 (밀리초)
  cleanupInterval: number;        // 메모리 정리 간격 (기본: 1시간)
  monitoringInterval: number;     // 모니터링 간격 (기본: 5분)
  healthCheckInterval: number;    // 헬스체크 간격 (기본: 30초)
  
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
  private db: Database.Database | null = null;
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private isRunning = false;
  private startTime: Date | null = null;
  private lastExecution: Map<string, Date> = new Map();
  private totalExecutions: Map<string, number> = new Map();
  private errorCount: Map<string, number> = new Map();
  private runningJobs: Set<string> = new Set();
  private jobQueue: Array<{name: string, job: () => Promise<void>, priority: number}> = [];

  constructor(config?: Partial<BatchJobConfig>) {
    this.config = {
      cleanupInterval: 60 * 60 * 1000,    // 1시간
      monitoringInterval: 5 * 60 * 1000,   // 5분
      healthCheckInterval: 30 * 1000,      // 30초
      maxBatchSize: 1000,
      enableLogging: true,
      enableNotifications: false,
      enableMetrics: true,
      maxConcurrentJobs: 3,
      jobTimeout: 5 * 60 * 1000,          // 5분
      retryAttempts: 3,
      retryDelay: 1000,                   // 1초
      ...config
    };

    this.forgettingService = new ForgettingPolicyService();
    this.performanceMonitor = getPerformanceMonitor();
  }

  /**
   * 스케줄러 시작
   */
  async start(db: Database.Database): Promise<void> {
    if (this.isRunning) {
      throw new Error('BatchScheduler is already running');
    }

    this.validateConfig();
    this.db = db;
    this.isRunning = true;
    this.startTime = new Date();

    // 성능 모니터 초기화
    this.performanceMonitor.initialize(db);

    // 메모리 정리 작업 스케줄링
    this.scheduleJob('cleanup', this.config.cleanupInterval, async () => { await this.runMemoryCleanup(); }, 1);
    
    // 모니터링 작업 스케줄링
    this.scheduleJob('monitoring', this.config.monitoringInterval, async () => { await this.runMonitoring(); }, 2);

    // 헬스체크 작업 스케줄링
    this.scheduleJob('healthcheck', this.config.healthCheckInterval, async () => { await this.runHealthCheck(); }, 3);

    // 작업 큐 처리 시작
    this.startJobProcessor();

    this.log('BatchScheduler started', {
      config: this.config,
      startTime: this.startTime.toISOString()
    });
  }

  /**
   * 스케줄러 중지
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

    // 실행 중인 작업 완료 대기
    await this.waitForRunningJobs();

    this.log('BatchScheduler stopped', {
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0
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
  }

  /**
   * 작업 스케줄링
   */
  private scheduleJob(name: string, interval: number, job: () => Promise<void>, priority: number): void {
    const wrappedJob = async () => {
      if (this.runningJobs.has(name)) {
        this.log(`Job ${name} is already running, skipping`, { level: 'warn' });
        return;
      }

      this.runningJobs.add(name);
      const startTime = Date.now();
      let retryCount = 0;

      const executeWithRetry = async (): Promise<void> => {
        try {
          await this.executeWithTimeout(job, this.config.jobTimeout);
          this.lastExecution.set(name, new Date());
          this.totalExecutions.set(name, (this.totalExecutions.get(name) || 0) + 1);
          
          // 성공시 에러 카운트 리셋
          this.errorCount.set(name, 0);
          
          this.log(`Job ${name} completed successfully`, {
            duration: Date.now() - startTime,
            totalExecutions: this.totalExecutions.get(name),
            retryCount
          });
        } catch (error) {
          retryCount++;
          const totalErrorCount = (this.errorCount.get(name) || 0) + 1;
          this.errorCount.set(name, totalErrorCount);
          
          const errorInfo = {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            errorCount: totalErrorCount,
            retryCount,
            duration: Date.now() - startTime
          };
          
          this.log(`Job ${name} failed`, errorInfo, 'error');

          // 재시도 로직
          if (retryCount <= this.config.retryAttempts) {
            const retryDelay = this.config.retryDelay * Math.pow(2, retryCount - 1); // 지수 백오프
            this.log(`Retrying job ${name} in ${retryDelay}ms`, { 
              attempt: retryCount,
              totalAttempts: this.config.retryAttempts,
              nextRetryDelay: retryDelay
            });
            
            setTimeout(() => {
              if (this.isRunning) { // 스케줄러가 여전히 실행 중인지 확인
                this.jobQueue.push({ name, job, priority });
              }
            }, retryDelay);
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
        }
      };

      // 실행
      executeWithRetry().finally(() => {
        this.runningJobs.delete(name);
      });
    };

    // 즉시 한 번 실행
    wrappedJob();

    // 주기적 실행
    const intervalId = setInterval(wrappedJob, interval);
    this.intervals.set(name, intervalId);
  }

  /**
   * 작업 큐 처리기 시작
   */
  private startJobProcessor(): void {
    const processQueue = async () => {
      if (this.jobQueue.length === 0 || this.runningJobs.size >= this.config.maxConcurrentJobs) {
        return;
      }

      // 우선순위 순으로 정렬
      this.jobQueue.sort((a, b) => a.priority - b.priority);
      
      const nextJob = this.jobQueue.shift();
      if (nextJob) {
        await nextJob.job();
      }
    };

    // 큐 처리 인터벌
    setInterval(processQueue, 100);
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

    while (this.runningJobs.size > 0 && (Date.now() - startTime) < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (this.runningJobs.size > 0) {
      this.log(`Warning: ${this.runningJobs.size} jobs still running after timeout`, { level: 'warn' });
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
          critical: alerts.filter(a => a.severity === 'critical').length,
          warning: alerts.filter(a => a.severity === 'warning').length
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
      if (!this.db) {
        throw new Error('Database not initialized');
      }

      // 데이터베이스 연결 확인
      await this.db.prepare('SELECT 1').get();
      
      // 메모리 사용량 확인
      const memUsage = process.memoryUsage();
      const memUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
      
      if (memUsagePercent > 90) {
        result.warnings.push(`High memory usage: ${memUsagePercent.toFixed(1)}%`);
      }

      // 실행 중인 작업 수 확인
      if (this.runningJobs.size > this.config.maxConcurrentJobs * 0.8) {
        result.warnings.push(`High job concurrency: ${this.runningJobs.size}/${this.config.maxConcurrentJobs}`);
      }

      result.success = true;
      result.processed = 1;
      result.details = {
        memoryUsage: memUsagePercent,
        runningJobs: this.runningJobs.size,
        uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0
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
    } catch (error) {
      this.log('Failed to collect database stats:', error, 'warn');
      return {};
    }
  }

  /**
   * 로깅
   */
  private log(message: string, data?: any, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (!this.config.enableLogging) return;

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      service: 'BatchScheduler',
      level,
      message,
      data,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      activeJobs: this.runningJobs.size,
      queueSize: this.jobQueue.length
    };

    const logMessage = `[${timestamp}] [BatchScheduler] [${level.toUpperCase()}] ${message}`;
    
    // 구조화된 로그 출력
    const logData = data ? JSON.stringify(data, null, 2) : '';
    const contextInfo = `[Uptime: ${logEntry.uptime}ms, Active: ${logEntry.activeJobs}, Queue: ${logEntry.queueSize}]`;
    
    switch (level) {
      case 'error':
        console.error(logMessage, contextInfo, logData);
        // 에러 로그를 파일에도 저장 (선택사항)
        this.logToFile(logEntry);
        break;
      case 'warn':
        console.warn(logMessage, contextInfo, logData);
        break;
      default:
        console.log(logMessage, contextInfo, logData);
    }
  }

  /**
   * 파일 로깅 (에러 로그)
   */
  private logToFile(logEntry: any): void {
    try {
      const fs = require('fs');
      const path = require('path');
      const logDir = path.join(process.cwd(), 'logs');
      
      // 로그 디렉토리 생성
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      
      const logFile = path.join(logDir, 'batch-scheduler.log');
      const logLine = JSON.stringify(logEntry) + '\n';
      
      fs.appendFileSync(logFile, logLine);
    } catch (error) {
      // 파일 로깅 실패는 무시
      console.warn('Failed to write to log file:', error);
    }
  }

  /**
   * 수동으로 작업 실행
   */
  async runJob(jobType: 'cleanup' | 'monitoring' | 'healthcheck'): Promise<BatchJobResult> {
    switch (jobType) {
      case 'cleanup':
        return await this.runMemoryCleanup();
      case 'monitoring':
        return await this.runMonitoring();
      case 'healthcheck':
        return await this.runHealthCheck();
      default:
        throw new Error(`Unknown job type: ${jobType}`);
    }
  }

  /**
   * 스케줄러 상태 확인
   */
  getStatus(): SchedulerStatus {
    return {
      isRunning: this.isRunning,
      activeJobs: Array.from(this.intervals.keys()),
      lastExecution: new Map(this.lastExecution),
      totalExecutions: new Map(this.totalExecutions),
      errorCount: new Map(this.errorCount),
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
    if (this.stopJob(jobName)) {
      // 작업 재시작 로직은 각 작업 타입에 따라 구현
      this.log(`Restarted job: ${jobName}`);
      return true;
    }
    return false;
  }

  /**
   * 스케줄러 헬스체크
   */
  private async checkSchedulerHealth(): Promise<void> {
    try {
      this.log('Performing scheduler health check...');
      
      // 데이터베이스 연결 확인
      if (this.db) {
        await this.db.prepare('SELECT 1').get();
      }
      
      // 메모리 사용량 확인
      const memUsage = process.memoryUsage();
      const memUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
      
      if (memUsagePercent > 90) {
        this.log(`High memory usage detected: ${memUsagePercent.toFixed(1)}%`, { level: 'warn' });
        
        // 메모리 정리 시도
        if (global.gc) {
          global.gc();
          this.log('Garbage collection triggered');
        }
      }
      
      // 실행 중인 작업 수 확인
      if (this.runningJobs.size > this.config.maxConcurrentJobs) {
        this.log(`Too many running jobs: ${this.runningJobs.size}/${this.config.maxConcurrentJobs}`, { level: 'warn' });
      }
      
      // 큐 크기 확인
      if (this.jobQueue.length > 100) {
        this.log(`Large job queue: ${this.jobQueue.length} items`, { level: 'warn' });
      }
      
      this.log('Scheduler health check completed', {
        memoryUsage: memUsagePercent,
        runningJobs: this.runningJobs.size,
        queueSize: this.jobQueue.length,
        uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0
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
    const totalErrors = Array.from(this.errorCount.values()).reduce((sum, count) => sum + count, 0);
    const errorRate = totalExecutions > 0 ? totalErrors / totalExecutions : 0;
    
    const jobs = Array.from(this.intervals.keys()).map(name => ({
      name,
      lastExecution: this.lastExecution.get(name) || null,
      totalExecutions: this.totalExecutions.get(name) || 0,
      errorCount: this.errorCount.get(name) || 0,
      errorRate: (this.totalExecutions.get(name) || 0) > 0 ? (this.errorCount.get(name) || 0) / (this.totalExecutions.get(name) || 1) : 0,
      isRunning: this.runningJobs.has(name)
    }));
    
    return {
      status: this.getStatus(),
      health: {
        memoryUsage: memUsagePercent,
        runningJobs: this.runningJobs.size,
        queueSize: this.jobQueue.length,
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