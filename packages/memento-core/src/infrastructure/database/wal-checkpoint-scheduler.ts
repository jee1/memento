/**
 * WAL Checkpoint Scheduler
 * SQLite WAL 파일의 주기적 체크포인트를 관리하는 스케줄러
 * 
 * 클린코드 원칙:
 * - 단일 책임 원칙: WAL 체크포인트 스케줄링만 담당
 * - 명확한 인터페이스: CheckpointMode enum과 CheckpointResult interface로 명확한 타입 정의
 */

/**
 * 체크포인트 모드
 * - PASSIVE: 다른 연결이 읽기 중이면 체크포인트를 건너뜀 (성능 영향 최소화)
 * - TRUNCATE: WAL 파일을 완전히 제거 (디스크 공간 절약)
 * - FULL: 모든 페이지를 메인 DB로 이동 후 WAL 파일 제거 (장기 트랜잭션이 없을 때만 사용)
 */
export enum CheckpointMode {
  PASSIVE = 'PASSIVE',
  TRUNCATE = 'TRUNCATE',
  FULL = 'FULL'
}

/**
 * 체크포인트 실행 결과
 */
export interface CheckpointResult {
  /**
   * 체크포인트 모드
   */
  mode: CheckpointMode;

  /**
   * 성공 여부
   */
  success: boolean;

  /**
   * WAL 파일의 페이지 수
   */
  log: number;

  /**
   * 체크포인트된 페이지 수
   */
  checkpointed: number;

  /**
   * 락 상태 (1: 락, 0: 정상)
   */
  busy: number;

  /**
   * 에러 (실패 시)
   */
  error?: Error;
}

/**
 * WAL 체크포인트 스케줄러 설정
 */
export interface WalCheckpointSchedulerConfig {
  /**
   * 체크포인트 실행 주기 (밀리초)
   * 기본값: 5분 (300000ms)
   */
  intervalMs: number;

  /**
   * WAL 파일 크기 경고 임계값 (바이트)
   * 기본값: 16MB (16777216 bytes)
   */
  walSizeWarningThreshold: number;

  /**
   * WAL 파일 크기 위험 임계값 (바이트)
   * 기본값: 24MB (25165824 bytes)
   */
  walSizeDangerThreshold: number;

  /**
   * 전용 커넥션 사용 여부
   * 기본값: true
   * true인 경우 체크포인트 전용 연결을 생성하여 메인 연결과 분리
   */
  useDedicatedConnection: boolean;

  /**
   * 최대 재시도 횟수
   * 기본값: 3
   */
  maxRetries: number;

  /**
   * 재시도 백오프 시간 (밀리초)
   * 기본값: 1000ms
   * 지수 백오프의 기본 단위로 사용됨 (1초, 2초, 4초)
   */
  retryBackoffMs: number;
}

/**
 * Logger 인터페이스
 */
export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * PerformanceMonitor 인터페이스
 */
export interface PerformanceMonitor {
  recordMetric(name: string, value: number): void;
  incrementCounter(name: string): void;
}

import Database from 'better-sqlite3';
import type { RuntimeDiagnosticsLogger } from '../../domains/monitoring/services/runtime-diagnostics-logger.js';

/**
 * WAL 체크포인트 스케줄러 클래스
 * SQLite WAL 파일의 주기적 체크포인트를 관리
 */
export class WalCheckpointScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private dedicatedConnection: Database.Database | null = null;
  private checkpointInProgress: boolean = false; // 동시 실행 방지 플래그

  constructor(
    private mainDb: Database.Database,
    private config: WalCheckpointSchedulerConfig,
    private logger?: Logger,
    private performanceMonitor?: PerformanceMonitor,
    private diagnosticsLogger?: Pick<RuntimeDiagnosticsLogger, 'writeEvent'>
  ) {}

  /**
   * 스케줄러 시작 (idempotent)
   */
  start(): void {
    if (this.isRunning) {
      this.logger?.warn('WAL 체크포인트 스케줄러가 이미 실행 중입니다');
      return;
    }

    this.isRunning = true;

    // 전용 커넥션 생성 (필요 시)
    if (this.config.useDedicatedConnection) {
      this.dedicatedConnection = new Database(this.mainDb.name);
      this.dedicatedConnection.pragma('journal_mode = WAL');
    }

    // 주기적 체크포인트 시작
    this.scheduleCheckpoint();

    this.logger?.info('WAL 체크포인트 스케줄러 시작됨', {
      intervalMs: this.config.intervalMs,
      useDedicatedConnection: this.config.useDedicatedConnection
    });
    void this.writeDiagnosticsEvent({
      type: 'wal_checkpoint_scheduler_start',
      intervalMs: this.config.intervalMs,
      useDedicatedConnection: this.config.useDedicatedConnection
    });
  }

  /**
   * 스케줄러 중지 (idempotent, 비동기)
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    // 타이머 정리
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // 전용 커넥션 종료
    if (this.dedicatedConnection) {
      this.dedicatedConnection.close();
      this.dedicatedConnection = null;
    }

    this.isRunning = false;
    this.logger?.info('WAL 체크포인트 스케줄러 중지됨');
    await this.writeDiagnosticsEvent({
      type: 'wal_checkpoint_scheduler_stop'
    });
  }

  /**
   * 즉시 체크포인트 실행
   * @param mode 체크포인트 모드 (기본값: TRUNCATE)
   * @returns 체크포인트 실행 결과
   */
  async checkpointNow(mode: CheckpointMode = CheckpointMode.TRUNCATE): Promise<CheckpointResult> {
    return this.checkpoint(mode);
  }

  /**
   * 체크포인트 실행 (재시도 로직 포함)
   * busy=1인 경우 실패로 간주하여 재시도 수행
   * 동시 실행 방지: checkpointInProgress 플래그로 중첩 실행 방지
   * 
   * @param mode 체크포인트 모드
   * @returns 체크포인트 실행 결과
   */
  private async checkpoint(mode: CheckpointMode): Promise<CheckpointResult> {
    // 동시 실행 방지
    if (this.checkpointInProgress) {
      throw new Error('체크포인트가 이미 진행 중입니다');
    }
    
    this.checkpointInProgress = true;
    const checkpointStartTime = Date.now(); // 체크포인트 시작 시간 기록
    
    try {
      const db = this.config.useDedicatedConnection && this.dedicatedConnection
        ? this.dedicatedConnection
        : this.mainDb;
      
      let lastError: Error | undefined;
    
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const result = this.executeCheckpoint(db, mode);
        
        // busy=1이면 실패로 간주하고 재시도
        if (result.busy === 1 || !result.success) {
          lastError = result.error || new Error(`체크포인트 실패: busy=${result.busy}, success=${result.success}`);
          
          if (attempt < this.config.maxRetries) {
            // 지수 백오프: retryBackoffMs * 2^(attempt-1)
            const backoffMs = this.config.retryBackoffMs * Math.pow(2, attempt - 1);
            this.logger?.warn(`체크포인트 실패 (busy=${result.busy}), ${backoffMs}ms 후 재시도`, { attempt, maxRetries: this.config.maxRetries, result });
            await this.sleep(backoffMs);
            continue; // 재시도
          } else {
            // 최대 재시도 횟수 초과
            const failureResult = {
              mode,
              success: false,
              log: result.log || 0,
              checkpointed: result.checkpointed || 0,
              busy: result.busy || 1,
              error: lastError
            };
            await this.writeDiagnosticsEvent({
              type: 'wal_checkpoint_failure',
              mode,
              log: failureResult.log,
              checkpointed: failureResult.checkpointed,
              busy: failureResult.busy,
              error: lastError?.message
            });
            return failureResult;
          }
        }
        
        // 성공한 경우에만 WAL 파일 크기 확인 및 메트릭 수집
        const walSize = await this.getWalFileSize();
        
        // WAL 크기가 위험 임계치를 넘으면 TRUNCATE 모드로 재시도
        if (walSize > this.config.walSizeDangerThreshold && mode !== CheckpointMode.TRUNCATE) {
          this.logger?.warn('WAL 파일 크기 위험, TRUNCATE 모드로 재시도', { 
            walSize, 
            threshold: this.config.walSizeDangerThreshold 
          });
          // TRUNCATE 모드로 재시도
          const truncateResult = this.executeCheckpoint(db, CheckpointMode.TRUNCATE);
          if (truncateResult.success && truncateResult.busy === 0) {
            // TRUNCATE 성공 시 메트릭 수집 및 결과 반환
            const duration = Date.now() - checkpointStartTime;
            if (this.performanceMonitor) {
              this.performanceMonitor.recordMetric('wal_checkpoint_duration', duration);
              const finalWalSize = await this.getWalFileSize();
              this.performanceMonitor.recordMetric('wal_file_size', finalWalSize);
            }
            await this.writeDiagnosticsEvent({
              type: 'wal_checkpoint_success',
              mode: CheckpointMode.TRUNCATE,
              log: truncateResult.log,
              checkpointed: truncateResult.checkpointed,
              busy: truncateResult.busy,
              durationMs: duration
            });
            return truncateResult;
          }
          // TRUNCATE 실패 시 원래 결과 사용 (성공했으므로)
        } else if (walSize > this.config.walSizeWarningThreshold) {
          this.logger?.warn('WAL 파일 크기 경고', { 
            walSize, 
            threshold: this.config.walSizeWarningThreshold 
          });
        }
        
        // 성공한 경우 메트릭 수집 및 결과 반환
        const duration = Date.now() - checkpointStartTime;
        if (this.performanceMonitor) {
          this.performanceMonitor.recordMetric('wal_checkpoint_duration', duration);
          this.performanceMonitor.recordMetric('wal_file_size', walSize);
        }
        await this.writeDiagnosticsEvent({
          type: 'wal_checkpoint_success',
          mode,
          log: result.log,
          checkpointed: result.checkpointed,
          busy: result.busy,
          durationMs: duration,
          walSize
        });
        
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < this.config.maxRetries) {
          const backoffMs = this.config.retryBackoffMs * Math.pow(2, attempt - 1);
          this.logger?.warn(`체크포인트 실패, ${backoffMs}ms 후 재시도`, { attempt, maxRetries: this.config.maxRetries, error });
          await this.sleep(backoffMs);
        }
      }
    }
    
      // 모든 재시도 실패
      const failureResult = {
        mode,
        success: false,
        log: 0,
        checkpointed: 0,
        busy: 1,
        error: lastError
      };
      await this.writeDiagnosticsEvent({
        type: 'wal_checkpoint_failure',
        mode,
        log: failureResult.log,
        checkpointed: failureResult.checkpointed,
        busy: failureResult.busy,
        error: lastError?.message
      });
      return failureResult;
    } finally {
      // 체크포인트 완료 후 플래그 해제
      this.checkpointInProgress = false;
    }
  }

  /**
   * 주기적 체크포인트 스케줄링
   * 동시 실행 방지: checkpointInProgress 플래그로 중첩 실행 방지
   */
  private scheduleCheckpoint(): void {
    this.intervalId = setInterval(async () => {
      // 이미 체크포인트가 진행 중이면 스킵
      if (this.checkpointInProgress) {
        this.logger?.warn('체크포인트가 이미 진행 중입니다. 이번 주기는 스킵합니다.');
        return;
      }
      
      try {
        await this.checkpoint(CheckpointMode.PASSIVE);
      } catch (error) {
        this.logger?.error('주기적 체크포인트 실패', { error });
      }
    }, this.config.intervalMs);
  }

  /**
   * 대기 함수 (지수 백오프용)
   * @param ms 대기 시간 (밀리초)
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 체크포인트 실행 (실제 SQL 실행)
   * better-sqlite3의 pragma는 기본적으로 배열을 반환함
   * 
   * @param db 데이터베이스 연결
   * @param mode 체크포인트 모드
   * @returns 체크포인트 실행 결과
   */
  private executeCheckpoint(db: Database.Database, mode: CheckpointMode): CheckpointResult {
    try {
      // better-sqlite3의 pragma는 배열을 반환 (기본 동작)
      const result = db.pragma(`wal_checkpoint(${mode})`) as Array<{ busy: number; log: number; checkpointed: number }>;
      
      // 결과가 배열인 경우 첫 번째 요소 사용
      const checkpointData = Array.isArray(result) && result.length > 0 ? result[0] : null;
      
      if (!checkpointData) {
        return {
          mode,
          success: false,
          log: 0,
          checkpointed: 0,
          busy: 1,
          error: new Error('체크포인트 결과를 파싱할 수 없습니다')
        };
      }
      
      return {
        mode,
        success: checkpointData.busy === 0,
        log: checkpointData.log >= 0 ? checkpointData.log : 0,
        checkpointed: checkpointData.checkpointed >= 0 ? checkpointData.checkpointed : 0,
        busy: checkpointData.busy
      };
    } catch (error) {
      // 에러 발생 시 실패 결과 반환
      return {
        mode,
        success: false,
        log: 0,
        checkpointed: 0,
        busy: 1,
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }

  /**
   * WAL 파일 크기 조회
   * 파일 시스템 API를 통한 크기 조회 (읽기 전용, 락 유발 없음)
   * 
   * @returns WAL 파일 크기 (바이트), 파일이 없거나 에러 발생 시 0 반환
   */
  private async getWalFileSize(): Promise<number> {
    // .db-wal 파일 크기 확인
    const walPath = `${this.mainDb.name}-wal`;
    try {
      const fs = await import('fs');
      const stats = fs.statSync(walPath);
      return stats.size;
    } catch (error) {
      // 파일이 없거나 접근할 수 없는 경우 0 반환
      return 0;
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
}
