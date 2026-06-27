/**
 * Database Lock Monitor
 * SQLite 데이터베이스 락을 주기적으로 모니터링하고 자동으로 해결
 * 
 * 클린코드 원칙:
 * - 단일 책임 원칙: 데이터베이스 락 모니터링만 담당
 * - 명확한 인터페이스: LockStatus와 DatabaseLockMonitorConfig로 명확한 타입 정의
 */

/**
 * 락 상태 정보
 */
export interface LockStatus {
  /**
   * 락 상태 여부
   */
  isLocked: boolean;

  /**
   * 락 지속 시간 (밀리초)
   */
  lockDuration: number;

  /**
   * 락 감지 방법
   * - immediate_transaction: IMMEDIATE 트랜잭션 시도로 감지
   * - busy_timeout: busy_timeout 초과로 감지
   */
  detectionMethod: 'immediate_transaction' | 'busy_timeout';

  /**
   * busy_timeout 초과 횟수
   */
  busyCount: number;
}

/**
 * 데이터베이스 락 모니터 설정
 */
export interface DatabaseLockMonitorConfig {
  /**
   * 모니터링 주기 (밀리초)
   * 기본값: 1분 (60000ms)
   */
  intervalMs: number;

  /**
   * 경고 임계값 (밀리초)
   * 기본값: 5초 (5000ms)
   */
  warningThresholdMs: number;

  /**
   * 위험 임계값 (밀리초)
   * 기본값: 30초 (30000ms)
   */
  dangerThresholdMs: number;

  /**
   * 치명적 임계값 (밀리초)
   * 기본값: 60초 (60000ms)
   */
  criticalThresholdMs: number;
}

import Database from 'better-sqlite3';
import type { Logger, PerformanceMonitor } from './wal-checkpoint-scheduler.js';
import type { WalCheckpointScheduler } from './wal-checkpoint-scheduler.js';
import type { RuntimeDiagnosticsLogger } from '../../domains/monitoring/services/runtime-diagnostics-logger.js';

/**
 * 데이터베이스 락 모니터 클래스
 * SQLite 데이터베이스 락을 주기적으로 모니터링하고 자동으로 해결
 */
export class DatabaseLockMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private lockStartTime: number | null = null;
  private busyCount: number = 0;
  private busyEventTimes: number[] = []; // busy_timeout 발생 시간 기록 (시간당 통계용)
  private statsResetTime: number = Date.now() + 3600000; // 1시간 후 통계 리셋

  constructor(
    private db: Database.Database,
    private config: DatabaseLockMonitorConfig,
    private logger?: Logger,
    private performanceMonitor?: PerformanceMonitor,
    private checkpointScheduler?: WalCheckpointScheduler,
    private diagnosticsLogger?: Pick<RuntimeDiagnosticsLogger, 'writeEvent'>
  ) {}

  /**
   * 모니터 시작 (idempotent)
   */
  start(): void {
    if (this.isRunning) {
      this.logger?.warn('데이터베이스 락 모니터가 이미 실행 중입니다');
      return;
    }

    this.isRunning = true;
    this.monitor();

    this.logger?.info('데이터베이스 락 모니터 시작됨', {
      intervalMs: this.config.intervalMs
    });
    void this.writeDiagnosticsEvent({
      type: 'database_lock_monitor_start',
      intervalMs: this.config.intervalMs
    });
  }

  /**
   * 모니터 중지 (idempotent)
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isRunning = false;
    this.lockStartTime = null;
    this.busyCount = 0;
    this.busyEventTimes = [];
    this.statsResetTime = Date.now() + 3600000;

    this.logger?.info('데이터베이스 락 모니터 중지됨');
    void this.writeDiagnosticsEvent({
      type: 'database_lock_monitor_stop'
    });
  }

  /**
   * 주기적 모니터링
   */
  private monitor(): void {
    this.intervalId = setInterval(async () => {
      try {
        const status = await this.checkLockStatus();
        this.handleLockStatus(status);
        this.updateBusyStatistics();
      } catch (error) {
        this.logger?.error('락 모니터링 실패', { error });
        await this.writeDiagnosticsEvent({
          type: 'database_lock_monitor_error',
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }, this.config.intervalMs);
  }

  /**
   * busy_timeout 통계 업데이트
   * 시간당 발생 횟수 모니터링
   */
  private updateBusyStatistics(): void {
    const now = Date.now();

    // 1시간이 지났으면 통계 리셋 및 메트릭 기록
    if (now >= this.statsResetTime) {
      const hourlyBusyCount = this.busyEventTimes.length;
      
      // 시간당 발생 횟수 메트릭 기록
      if (this.performanceMonitor && hourlyBusyCount > 0) {
        this.performanceMonitor.recordMetric('database_lock_hourly_count', hourlyBusyCount);
        
        // 시간당 발생 횟수가 높으면 경고
        if (hourlyBusyCount > 100) {
          this.logger?.warn('시간당 busy_timeout 발생 횟수가 높음', {
            hourlyBusyCount,
            threshold: 100
          });
        }
      }

      // 통계 리셋
      this.busyEventTimes = [];
      this.statsResetTime = now + 3600000; // 다음 리셋 시간 설정
    }
  }

  /**
   * 락 상태 확인
   * IMMEDIATE 트랜잭션 시도와 단순 상태 확인 쿼리를 통해 락을 감지
   */
  private async checkLockStatus(): Promise<LockStatus> {
    // 방법 1: IMMEDIATE 트랜잭션 시도 (관측만 수행, 실제 체크포인트 유발 없음)
    try {
      this.db.prepare('BEGIN IMMEDIATE TRANSACTION').run();
      // 트랜잭션 성공 = 락 없음
      this.db.prepare('ROLLBACK').run();
      
      // 락이 해제됨
      if (this.lockStartTime) {
        const duration = Date.now() - this.lockStartTime;
        this.lockStartTime = null;
        this.logger?.info('데이터베이스 락 해제됨', { duration });
      }
      
      return {
        isLocked: false,
        lockDuration: 0,
        detectionMethod: 'immediate_transaction',
        busyCount: this.busyCount
      };
    } catch (error: unknown) {
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'SQLITE_BUSY') {
        // 락 감지 (IMMEDIATE 트랜잭션 방법)
        this.busyCount++;
        
        // busy_timeout 발생 시간 기록 (시간당 통계용)
        this.busyEventTimes.push(Date.now());
        
        // 락 시작 시간 기록
        if (!this.lockStartTime) {
          this.lockStartTime = Date.now();
        }
        
        // 락 지속 시간 계산
        const lockDuration = this.lockStartTime ? Date.now() - this.lockStartTime : 0;
        
        return {
          isLocked: true,
          lockDuration,
          detectionMethod: 'immediate_transaction',
          busyCount: this.busyCount
        };
      }
      
      // 다른 에러가 발생한 경우, 보조 방법으로 단순 상태 확인 쿼리 시도
      // 방법 2: 단순 상태 확인 쿼리 (읽기 전용, 락 유발 없음)
      try {
        this.db.prepare('SELECT COUNT(*) FROM sqlite_master').get();
        // 쿼리 성공 = 락 없음 (IMMEDIATE 트랜잭션의 다른 에러는 무시)
        if (this.lockStartTime) {
          const duration = Date.now() - this.lockStartTime;
          this.lockStartTime = null;
          this.logger?.info('데이터베이스 락 해제됨', { duration });
        }
        
        return {
          isLocked: false,
          lockDuration: 0,
          detectionMethod: 'immediate_transaction',
          busyCount: this.busyCount
        };
      } catch (queryError: unknown) {
        if (queryError instanceof Error && (queryError as NodeJS.ErrnoException).code === 'SQLITE_BUSY') {
          // 락 감지 (단순 상태 확인 쿼리 방법)
          this.busyCount++;
          
          // busy_timeout 발생 시간 기록 (시간당 통계용)
          this.busyEventTimes.push(Date.now());
          
          // 락 시작 시간 기록
          if (!this.lockStartTime) {
            this.lockStartTime = Date.now();
          }
          
          // 락 지속 시간 계산
          const lockDuration = this.lockStartTime ? Date.now() - this.lockStartTime : 0;
          
          return {
            isLocked: true,
            lockDuration,
            detectionMethod: 'busy_timeout',
            busyCount: this.busyCount
          };
        }
        
        // 두 방법 모두 실패한 경우, 에러 로그만 출력
        this.logger?.error('락 감지 중 예상치 못한 에러 발생', { 
          immediateTransactionError: error,
          queryError 
        });
        return {
          isLocked: false,
          lockDuration: 0,
          detectionMethod: 'immediate_transaction',
          busyCount: this.busyCount
        };
      }
    }
  }

  /**
   * 락 상태 처리
   * 임계값 기반 경고 및 조치 로직
   */
  private async handleLockStatus(status: LockStatus): Promise<void> {
    if (!status.isLocked) {
      return; // 락이 없으면 처리하지 않음
    }

    const { lockDuration } = status;
    await this.writeDiagnosticsEvent({
      type: 'database_lock_detected',
      lockDuration,
      detectionMethod: status.detectionMethod,
      busyCount: status.busyCount,
      severity: lockDuration >= this.config.criticalThresholdMs
        ? 'critical'
        : lockDuration >= this.config.dangerThresholdMs
          ? 'danger'
          : lockDuration >= this.config.warningThresholdMs
            ? 'warning'
            : 'info'
    });

    // PerformanceMonitor 메트릭 수집
    if (this.performanceMonitor) {
      this.performanceMonitor.incrementCounter('database_lock_count');
      this.performanceMonitor.recordMetric('database_lock_duration', lockDuration);
    }

    // 치명적 임계값 (60초 이상)
    if (lockDuration >= this.config.criticalThresholdMs) {
      this.logger?.warn('데이터베이스 락 치명적 상태 감지', {
        lockDuration,
        detectionMethod: status.detectionMethod,
        busyCount: status.busyCount
      });

      // 체크포인트 시도
      if (this.checkpointScheduler) {
        try {
          await this.checkpointScheduler.checkpointNow();
        } catch (error) {
          this.logger?.error('체크포인트 실행 실패', { error });
        }
      }

      // 에러 로깅
      this.logger?.error('데이터베이스 락 치명적 상태', {
        lockDuration,
        detectionMethod: status.detectionMethod,
        busyCount: status.busyCount
      });
      return;
    }

    // 위험 임계값 (30초 이상)
    if (lockDuration >= this.config.dangerThresholdMs) {
      this.logger?.warn('데이터베이스 락 위험 상태 감지', {
        lockDuration,
        detectionMethod: status.detectionMethod,
        busyCount: status.busyCount
      });

      // 체크포인트 시도
      if (this.checkpointScheduler) {
        try {
          await this.checkpointScheduler.checkpointNow();
        } catch (error) {
          this.logger?.error('체크포인트 실행 실패', { error });
        }
      }
      return;
    }

    // 경고 임계값 (5초 이상)
    if (lockDuration >= this.config.warningThresholdMs) {
      this.logger?.warn('데이터베이스 락 경고 상태 감지', {
        lockDuration,
        detectionMethod: status.detectionMethod,
        busyCount: status.busyCount
      });
      return;
    }

    // 임계값 미만이면 로그 출력하지 않음
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
}
