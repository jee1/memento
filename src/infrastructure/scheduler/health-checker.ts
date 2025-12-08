/**
 * 헬스체크 모듈
 * 스케줄러 및 시스템 상태 확인 기능 제공
 */

import Database from 'better-sqlite3';

export interface HealthCheckResult {
  isHealthy: boolean;
  memoryUsage: number; // 메모리 사용률 (%)
  runningJobs: number;
  queueSize: number;
  uptime: number; // 밀리초
  warnings: string[];
  errors: string[];
}

export interface HealthCheckConfig {
  maxMemoryUsagePercent?: number; // 경고 임계값 (기본: 90)
  maxConcurrentJobsPercent?: number; // 경고 임계값 (기본: 80% of maxConcurrentJobs)
  maxQueueSize?: number; // 경고 임계값 (기본: 100)
}

/**
 * 헬스체크 관리자
 * 
 * 역할:
 * - 데이터베이스 연결 확인
 * - 메모리 사용량 확인
 * - 실행 중인 작업 수 확인
 * - 큐 크기 확인
 */
export class HealthChecker {
  private config: HealthCheckConfig;
  private startTime: Date | null = null;

  constructor(config: HealthCheckConfig = {}) {
    this.config = {
      maxMemoryUsagePercent: config.maxMemoryUsagePercent ?? 90,
      maxConcurrentJobsPercent: config.maxConcurrentJobsPercent ?? 0.8,
      maxQueueSize: config.maxQueueSize ?? 100,
      ...config
    };
  }

  /**
   * 시작 시간 설정
   * 
   * @param startTime 시작 시간
   */
  setStartTime(startTime: Date): void {
    this.startTime = startTime;
  }

  /**
   * 헬스체크 실행
   * 
   * @param db 데이터베이스 인스턴스
   * @param runningJobs 실행 중인 작업 수
   * @param queueSize 큐 크기
   * @param maxConcurrentJobs 최대 동시 작업 수
   * @returns 헬스체크 결과
   */
  async check(
    db: Database.Database | null,
    runningJobs: number,
    queueSize: number,
    maxConcurrentJobs: number
  ): Promise<HealthCheckResult> {
    const warnings: string[] = [];
    const errors: string[] = [];

    // 데이터베이스 연결 확인
    if (db) {
      try {
        await db.prepare('SELECT 1').get();
      } catch (error) {
        errors.push(`Database connection failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      errors.push('Database not initialized');
    }

    // 메모리 사용량 확인
    const memUsage = process.memoryUsage();
    const memUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    
    if (memUsagePercent > this.config.maxMemoryUsagePercent!) {
      warnings.push(`High memory usage: ${memUsagePercent.toFixed(1)}%`);
    }

    // 실행 중인 작업 수 확인
    const maxConcurrentJobsThreshold = maxConcurrentJobs * (this.config.maxConcurrentJobsPercent ?? 0.8);
    if (runningJobs > maxConcurrentJobsThreshold) {
      warnings.push(`High job concurrency: ${runningJobs}/${maxConcurrentJobs}`);
    }

    // 큐 크기 확인
    if (queueSize > this.config.maxQueueSize!) {
      warnings.push(`Large job queue: ${queueSize} items`);
    }

    // Uptime 계산
    const uptime = this.startTime ? Date.now() - this.startTime.getTime() : 0;

    return {
      isHealthy: errors.length === 0,
      memoryUsage: memUsagePercent,
      runningJobs,
      queueSize,
      uptime,
      warnings,
      errors
    };
  }

  /**
   * 가비지 컬렉션 트리거 (가능한 경우)
   */
  triggerGarbageCollection(): boolean {
    if (global.gc) {
      global.gc();
      return true;
    }
    return false;
  }
}

