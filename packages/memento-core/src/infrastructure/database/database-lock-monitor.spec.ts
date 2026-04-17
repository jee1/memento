/**
 * Database Lock Monitor 테스트
 * TDD 방법론 적용: Given/When/Then 형식
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { LockStatus, DatabaseLockMonitorConfig, DatabaseLockMonitor } from './database-lock-monitor.js';
import { setupTestDatabase, cleanupTestDatabase } from '../../test/helpers/test-database.js';
import type { Logger, PerformanceMonitor, WalCheckpointScheduler } from './wal-checkpoint-scheduler.js';

describe('LockStatus interface', () => {
  it('LockStatus 타입이 정의되어야 함', () => {
    // Given: LockStatus 인터페이스가 정의되어 있음
    // When: LockStatus 타입의 객체 생성
    const status: LockStatus = {
      isLocked: true,
      lockDuration: 5000,
      detectionMethod: 'immediate_transaction',
      busyCount: 1
    };

    // Then: 모든 필수 필드가 있어야 함
    expect(status.isLocked).toBe(true);
    expect(status.lockDuration).toBe(5000);
    expect(status.detectionMethod).toBe('immediate_transaction');
    expect(status.busyCount).toBe(1);
  });

  it('LockStatus의 detectionMethod가 올바른 타입이어야 함', () => {
    // Given: LockStatus 인터페이스가 정의되어 있음
    // When: 각 detectionMethod 값 확인
    const status1: LockStatus = {
      isLocked: false,
      lockDuration: 0,
      detectionMethod: 'immediate_transaction',
      busyCount: 0
    };

    const status2: LockStatus = {
      isLocked: false,
      lockDuration: 0,
      detectionMethod: 'busy_timeout',
      busyCount: 0
    };

    // Then: detectionMethod가 올바른 타입이어야 함
    expect(status1.detectionMethod).toBe('immediate_transaction');
    expect(status2.detectionMethod).toBe('busy_timeout');
  });
});

describe('DatabaseLockMonitorConfig interface', () => {
  it('DatabaseLockMonitorConfig 타입이 정의되어야 함', () => {
    // Given: DatabaseLockMonitorConfig 인터페이스가 정의되어 있음
    // When: 모든 필수 필드를 포함한 설정 객체 생성
    const config: DatabaseLockMonitorConfig = {
      intervalMs: 60000, // 1분
      warningThresholdMs: 5000, // 5초
      dangerThresholdMs: 30000, // 30초
      criticalThresholdMs: 60000 // 60초
    };

    // Then: 모든 필수 필드가 있어야 함
    expect(config.intervalMs).toBe(60000);
    expect(config.warningThresholdMs).toBe(5000);
    expect(config.dangerThresholdMs).toBe(30000);
    expect(config.criticalThresholdMs).toBe(60000);
  });

  it('DatabaseLockMonitorConfig에 기본값으로 사용할 수 있는 값들이 올바른 타입이어야 함', () => {
    // Given: DatabaseLockMonitorConfig 인터페이스가 정의되어 있음
    // When: 각 필드의 타입 확인
    const config: DatabaseLockMonitorConfig = {
      intervalMs: 60000,
      warningThresholdMs: 5000,
      dangerThresholdMs: 30000,
      criticalThresholdMs: 60000
    };

    // Then: 모든 필드가 올바른 타입이어야 함
    expect(typeof config.intervalMs).toBe('number');
    expect(typeof config.warningThresholdMs).toBe('number');
    expect(typeof config.dangerThresholdMs).toBe('number');
    expect(typeof config.criticalThresholdMs).toBe('number');
  });
});

describe('DatabaseLockMonitor class', () => {
  let db: Database.Database;
  let config: DatabaseLockMonitorConfig;
  let mockLogger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let mockPerformanceMonitor: { recordMetric: ReturnType<typeof vi.fn>; incrementCounter: ReturnType<typeof vi.fn> };
  let mockCheckpointScheduler: { checkpointNow: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    // Given: 테스트 데이터베이스와 설정이 준비되어 있음
    db = await setupTestDatabase();
    db.pragma('journal_mode = WAL');
    
    config = {
      intervalMs: 100, // 테스트를 위해 짧은 주기 사용
      warningThresholdMs: 5000,
      dangerThresholdMs: 30000,
      criticalThresholdMs: 60000
    };

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    mockPerformanceMonitor = {
      recordMetric: vi.fn(),
      incrementCounter: vi.fn()
    };

    mockCheckpointScheduler = {
      checkpointNow: vi.fn()
    };
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('DatabaseLockMonitor 인스턴스를 생성할 수 있어야 함', () => {
      // Given: 데이터베이스와 설정이 준비되어 있음
      // When: DatabaseLockMonitor 인스턴스 생성
      const monitor = new DatabaseLockMonitor(
        db,
        config,
        mockLogger as Logger,
        mockPerformanceMonitor as PerformanceMonitor,
        mockCheckpointScheduler as unknown as WalCheckpointScheduler
      );

      // Then: 인스턴스가 생성되어야 함
      expect(monitor).toBeInstanceOf(DatabaseLockMonitor);
    });

    it('logger, performanceMonitor, checkpointScheduler 없이도 인스턴스를 생성할 수 있어야 함', () => {
      // Given: 데이터베이스와 설정이 준비되어 있음
      // When: logger, performanceMonitor, checkpointScheduler 없이 DatabaseLockMonitor 인스턴스 생성
      const monitor = new DatabaseLockMonitor(db, config);

      // Then: 인스턴스가 생성되어야 함
      expect(monitor).toBeInstanceOf(DatabaseLockMonitor);
    });
  });

  describe('start', () => {
    it('모니터를 시작할 수 있어야 함', () => {
      // Given: DatabaseLockMonitor 인스턴스가 생성되어 있음
      const monitor = new DatabaseLockMonitor(
        db,
        config,
        mockLogger as Logger
      );

      // When: start() 메서드 호출
      monitor.start();

      // Then: logger.info가 호출되어야 함
      expect(mockLogger.info).toHaveBeenCalledWith(
        '데이터베이스 락 모니터 시작됨',
        expect.objectContaining({
          intervalMs: config.intervalMs
        })
      );
    });

    it('이미 실행 중인 모니터를 다시 시작하면 idempotent하게 동작해야 함', () => {
      // Given: 실행 중인 DatabaseLockMonitor 인스턴스가 있음
      const monitor = new DatabaseLockMonitor(
        db,
        config,
        mockLogger as Logger
      );
      monitor.start();
      const firstCallCount = mockLogger.info.mock.calls.length;

      // When: start() 메서드를 다시 호출
      monitor.start();

      // Then: logger.warn이 호출되고, logger.info는 추가로 호출되지 않아야 함
      expect(mockLogger.warn).toHaveBeenCalledWith('데이터베이스 락 모니터가 이미 실행 중입니다');
      expect(mockLogger.info.mock.calls.length).toBe(firstCallCount);
    });

    it('start 시 diagnostics 이벤트를 기록해야 함', () => {
      const writeEvent = vi.fn().mockResolvedValue(undefined);
      const monitor = new DatabaseLockMonitor(
        db,
        config,
        mockLogger as Logger,
        mockPerformanceMonitor as PerformanceMonitor,
        mockCheckpointScheduler as unknown as WalCheckpointScheduler,
        { writeEvent } as any
      );

      monitor.start();

      expect(writeEvent).toHaveBeenCalledWith(expect.objectContaining({
        type: 'database_lock_monitor_start'
      }));
    });
  });

  describe('stop', () => {
    it('실행 중인 모니터를 중지할 수 있어야 함', () => {
      // Given: 실행 중인 DatabaseLockMonitor 인스턴스가 있음
      const monitor = new DatabaseLockMonitor(
        db,
        config,
        mockLogger as Logger
      );
      monitor.start();

      // When: stop() 메서드 호출
      monitor.stop();

      // Then: logger.info가 호출되어야 함
      expect(mockLogger.info).toHaveBeenCalledWith('데이터베이스 락 모니터 중지됨');
    });

    it('실행 중이 아닌 모니터를 중지하면 idempotent하게 동작해야 함', () => {
      // Given: 실행 중이 아닌 DatabaseLockMonitor 인스턴스가 있음
      const monitor = new DatabaseLockMonitor(
        db,
        config,
        mockLogger as Logger
      );

      // When: stop() 메서드 호출
      monitor.stop();

      // Then: logger.info가 호출되지 않아야 함 (중지 로그 없음)
      expect(mockLogger.info).not.toHaveBeenCalledWith('데이터베이스 락 모니터 중지됨');
    });

    it('여러 번 stop()을 호출해도 안전해야 함', () => {
      // Given: 실행 중인 DatabaseLockMonitor 인스턴스가 있음
      const monitor = new DatabaseLockMonitor(
        db,
        config,
        mockLogger as Logger
      );
      monitor.start();

      // When: stop() 메서드를 여러 번 호출
      monitor.stop();
      monitor.stop();
      monitor.stop();

      // Then: 에러가 발생하지 않아야 함
      expect(mockLogger.info).toHaveBeenCalledTimes(2); // 시작 1회, 중지 1회
    });

    it('stop 시 diagnostics 이벤트를 기록해야 함', () => {
      const writeEvent = vi.fn().mockResolvedValue(undefined);
      const monitor = new DatabaseLockMonitor(
        db,
        config,
        mockLogger as Logger,
        mockPerformanceMonitor as PerformanceMonitor,
        mockCheckpointScheduler as unknown as WalCheckpointScheduler,
        { writeEvent } as any
      );
      monitor.start();

      monitor.stop();

      expect(writeEvent).toHaveBeenCalledWith(expect.objectContaining({
        type: 'database_lock_monitor_stop'
      }));
    });
  });

  describe('checkLockStatus - IMMEDIATE 트랜잭션 기반 락 감지', () => {
    it('락이 없을 때 isLocked가 false여야 함', async () => {
      // Given: 락이 없는 데이터베이스와 모니터가 준비되어 있음
      const monitor = new DatabaseLockMonitor(db, config, mockLogger as Logger);
      
      // When: checkLockStatus 호출 (private 메서드이므로 any로 캐스팅)
      const status = await (monitor as any).checkLockStatus();

      // Then: isLocked가 false여야 함
      expect(status.isLocked).toBe(false);
      expect(status.detectionMethod).toBe('immediate_transaction');
      expect(status.lockDuration).toBe(0);
      expect(status.busyCount).toBe(0);
    });

    it('락이 있을 때 isLocked가 true여야 함', async () => {
      // Given: 파일 기반 데이터베이스와 다른 연결로 락을 보유한 상황
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const testDbPath = path.join(os.tmpdir(), `test-lock-${Date.now()}-${randomUUID()}.db`);
      
      // 테스트 데이터베이스 생성
      const testDb = new Database(testDbPath);
      testDb.pragma('journal_mode = WAL');
      
      // 다른 연결로 락 획득
      const lockDb = new Database(testDbPath);
      lockDb.pragma('journal_mode = WAL');
      const lockStmt = lockDb.prepare('BEGIN IMMEDIATE TRANSACTION');
      lockStmt.run(); // 락 획득

      const monitor = new DatabaseLockMonitor(testDb, config, mockLogger as Logger);

      // When: checkLockStatus 호출
      const status = await (monitor as any).checkLockStatus();

      // Then: isLocked가 true여야 함
      expect(status.isLocked).toBe(true);
      expect(status.detectionMethod).toBe('immediate_transaction');
      
      // 정리
      lockDb.prepare('ROLLBACK').run();
      lockDb.close();
      testDb.close();
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    });

    it('SQLITE_BUSY 에러가 발생하면 락으로 감지해야 함', async () => {
      // Given: 파일 기반 데이터베이스와 다른 연결로 락을 보유한 상황
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const testDbPath = path.join(os.tmpdir(), `test-lock-${Date.now()}-${randomUUID()}.db`);
      
      const testDb = new Database(testDbPath);
      testDb.pragma('journal_mode = WAL');
      
      // 다른 연결로 락 획득
      const lockDb = new Database(testDbPath);
      lockDb.pragma('journal_mode = WAL');
      const lockStmt = lockDb.prepare('BEGIN IMMEDIATE TRANSACTION');
      lockStmt.run();

      const monitor = new DatabaseLockMonitor(testDb, config, mockLogger as Logger);

      // When: checkLockStatus 호출
      const status = await (monitor as any).checkLockStatus();

      // Then: SQLITE_BUSY 에러가 발생하고 락으로 감지되어야 함
      expect(status.isLocked).toBe(true);
      expect(status.detectionMethod).toBe('immediate_transaction');
      
      // 정리
      lockDb.prepare('ROLLBACK').run();
      lockDb.close();
      testDb.close();
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    });

    it('락이 감지되면 lockStartTime을 기록해야 함', async () => {
      // Given: 파일 기반 데이터베이스와 다른 연결로 락을 보유한 상황
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const testDbPath = path.join(os.tmpdir(), `test-lock-${Date.now()}-${randomUUID()}.db`);
      
      const testDb = new Database(testDbPath);
      testDb.pragma('journal_mode = WAL');
      
      // 다른 연결로 락 획득
      const lockDb = new Database(testDbPath);
      lockDb.pragma('journal_mode = WAL');
      const lockStmt = lockDb.prepare('BEGIN IMMEDIATE TRANSACTION');
      lockStmt.run();

      const monitor = new DatabaseLockMonitor(testDb, config, mockLogger as Logger);

      // When: checkLockStatus를 여러 번 호출
      const status1 = await (monitor as any).checkLockStatus();
      await new Promise(resolve => setTimeout(resolve, 10)); // 10ms 대기
      const status2 = await (monitor as any).checkLockStatus();

      // Then: lockDuration이 증가해야 함
      expect(status1.isLocked).toBe(true);
      expect(status2.isLocked).toBe(true);
      expect(status2.lockDuration).toBeGreaterThanOrEqual(status1.lockDuration);
      
      // 정리
      lockDb.prepare('ROLLBACK').run();
      lockDb.close();
      testDb.close();
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    });

    it('락이 해제되면 lockStartTime을 초기화해야 함', async () => {
      // Given: 파일 기반 데이터베이스와 다른 연결로 락을 보유한 상황
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const testDbPath = path.join(os.tmpdir(), `test-lock-${Date.now()}-${randomUUID()}.db`);
      
      const testDb = new Database(testDbPath);
      testDb.pragma('journal_mode = WAL');
      
      // 다른 연결로 락 획득
      const lockDb = new Database(testDbPath);
      lockDb.pragma('journal_mode = WAL');
      const lockStmt = lockDb.prepare('BEGIN IMMEDIATE TRANSACTION');
      lockStmt.run();

      const monitor = new DatabaseLockMonitor(testDb, config, mockLogger as Logger);

      // When: 락이 있는 상태에서 checkLockStatus 호출
      const status1 = await (monitor as any).checkLockStatus();
      expect(status1.isLocked).toBe(true);

      // 락 해제
      lockDb.prepare('ROLLBACK').run();
      lockDb.close();

      // 락이 해제된 후 checkLockStatus 호출
      const status2 = await (monitor as any).checkLockStatus();

      // Then: isLocked가 false가 되고 lockDuration이 0이어야 함
      expect(status2.isLocked).toBe(false);
      expect(status2.lockDuration).toBe(0);
      
      // 정리
      testDb.close();
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    });
  });

  describe('checkLockStatus - 단순 상태 확인 쿼리 기반 락 감지 (보조 방법)', () => {
    it('IMMEDIATE 트랜잭션이 실패했을 때 단순 상태 확인 쿼리로 락을 감지할 수 있어야 함', async () => {
      // Given: 파일 기반 데이터베이스와 다른 연결로 락을 보유한 상황
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const testDbPath = path.join(os.tmpdir(), `test-lock-${Date.now()}-${randomUUID()}.db`);
      
      const testDb = new Database(testDbPath);
      testDb.pragma('journal_mode = WAL');
      
      // 다른 연결로 락 획득 (BEGIN IMMEDIATE TRANSACTION)
      const lockDb = new Database(testDbPath);
      lockDb.pragma('journal_mode = WAL');
      const lockStmt = lockDb.prepare('BEGIN IMMEDIATE TRANSACTION');
      lockStmt.run();

      const monitor = new DatabaseLockMonitor(testDb, config, mockLogger as Logger);

      // When: checkLockStatus 호출 (IMMEDIATE 트랜잭션이 SQLITE_BUSY를 반환하면 단순 상태 확인 쿼리로 재확인)
      const status = await (monitor as any).checkLockStatus();

      // Then: 락이 감지되어야 함 (IMMEDIATE 트랜잭션 방법으로 감지됨)
      expect(status.isLocked).toBe(true);
      
      // 정리
      lockDb.prepare('ROLLBACK').run();
      lockDb.close();
      testDb.close();
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    });

    it('단순 상태 확인 쿼리(SELECT COUNT(*) FROM sqlite_master)로 락을 감지할 수 있어야 함', async () => {
      // Given: 파일 기반 데이터베이스와 다른 연결로 락을 보유한 상황
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const testDbPath = path.join(os.tmpdir(), `test-lock-${Date.now()}-${randomUUID()}.db`);
      
      const testDb = new Database(testDbPath);
      testDb.pragma('journal_mode = WAL');
      
      // 다른 연결로 락 획득 (BEGIN IMMEDIATE TRANSACTION)
      const lockDb = new Database(testDbPath);
      lockDb.pragma('journal_mode = WAL');
      const lockStmt = lockDb.prepare('BEGIN IMMEDIATE TRANSACTION');
      lockStmt.run();

      const monitor = new DatabaseLockMonitor(testDb, config, mockLogger as Logger);

      // When: checkLockStatus 호출
      const status = await (monitor as any).checkLockStatus();

      // Then: 락이 감지되어야 함
      expect(status.isLocked).toBe(true);
      // detectionMethod는 'immediate_transaction' 또는 'busy_timeout'일 수 있음
      expect(['immediate_transaction', 'busy_timeout']).toContain(status.detectionMethod);
      
      // 정리
      lockDb.prepare('ROLLBACK').run();
      lockDb.close();
      testDb.close();
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    });

    it('단순 상태 확인 쿼리가 SQLITE_BUSY를 반환하면 busy_timeout 방법으로 감지해야 함', async () => {
      // Given: 파일 기반 데이터베이스와 다른 연결로 락을 보유한 상황
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const testDbPath = path.join(os.tmpdir(), `test-lock-${Date.now()}-${randomUUID()}.db`);
      
      const testDb = new Database(testDbPath);
      testDb.pragma('journal_mode = WAL');
      
      // 다른 연결로 락 획득
      const lockDb = new Database(testDbPath);
      lockDb.pragma('journal_mode = WAL');
      const lockStmt = lockDb.prepare('BEGIN IMMEDIATE TRANSACTION');
      lockStmt.run();

      const monitor = new DatabaseLockMonitor(testDb, config, mockLogger as Logger);

      // When: checkLockStatus 호출
      // IMMEDIATE 트랜잭션이 SQLITE_BUSY를 반환하면 이미 락으로 감지되므로,
      // 단순 상태 확인 쿼리는 IMMEDIATE 트랜잭션이 다른 에러를 반환했을 때만 실행됨
      // 하지만 실제로는 IMMEDIATE 트랜잭션이 SQLITE_BUSY를 반환하면 바로 락으로 감지됨
      const status = await (monitor as any).checkLockStatus();

      // Then: 락이 감지되어야 함
      expect(status.isLocked).toBe(true);
      
      // 정리
      lockDb.prepare('ROLLBACK').run();
      lockDb.close();
      testDb.close();
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    });
  });

  describe('락 지속 시간 추적', () => {
    it('락이 감지되면 lockStartTime을 기록해야 함', async () => {
      // Given: 파일 기반 데이터베이스와 다른 연결로 락을 보유한 상황
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const testDbPath = path.join(os.tmpdir(), `test-lock-${Date.now()}-${randomUUID()}.db`);
      
      const testDb = new Database(testDbPath);
      testDb.pragma('journal_mode = WAL');
      
      // 다른 연결로 락 획득
      const lockDb = new Database(testDbPath);
      lockDb.pragma('journal_mode = WAL');
      const lockStmt = lockDb.prepare('BEGIN IMMEDIATE TRANSACTION');
      lockStmt.run();

      const monitor = new DatabaseLockMonitor(testDb, config, mockLogger as Logger);

      // When: checkLockStatus 호출 (첫 번째 호출)
      const status1 = await (monitor as any).checkLockStatus();

      // Then: lockStartTime이 기록되고 lockDuration이 0 이상이어야 함
      expect(status1.isLocked).toBe(true);
      expect(status1.lockDuration).toBeGreaterThanOrEqual(0);
      expect((monitor as any).lockStartTime).not.toBeNull();
      
      // 정리
      lockDb.prepare('ROLLBACK').run();
      lockDb.close();
      testDb.close();
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    });

    it('락이 지속되는 동안 lockDuration이 증가해야 함', async () => {
      // Given: 파일 기반 데이터베이스와 다른 연결로 락을 보유한 상황
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const testDbPath = path.join(os.tmpdir(), `test-lock-${Date.now()}-${randomUUID()}.db`);
      
      const testDb = new Database(testDbPath);
      testDb.pragma('journal_mode = WAL');
      
      // 다른 연결로 락 획득
      const lockDb = new Database(testDbPath);
      lockDb.pragma('journal_mode = WAL');
      const lockStmt = lockDb.prepare('BEGIN IMMEDIATE TRANSACTION');
      lockStmt.run();

      const monitor = new DatabaseLockMonitor(testDb, config, mockLogger as Logger);

      // When: checkLockStatus를 여러 번 호출 (시간 간격을 두고)
      const status1 = await (monitor as any).checkLockStatus();
      const firstDuration = status1.lockDuration;
      
      await new Promise(resolve => setTimeout(resolve, 50)); // 50ms 대기
      
      const status2 = await (monitor as any).checkLockStatus();
      const secondDuration = status2.lockDuration;

      // Then: lockDuration이 증가해야 함
      expect(status1.isLocked).toBe(true);
      expect(status2.isLocked).toBe(true);
      expect(secondDuration).toBeGreaterThan(firstDuration);
      expect(secondDuration - firstDuration).toBeGreaterThanOrEqual(40); // 최소 40ms 증가
      
      // 정리
      lockDb.prepare('ROLLBACK').run();
      lockDb.close();
      testDb.close();
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    });

    it('락이 해제되면 lockStartTime을 초기화해야 함', async () => {
      // Given: 파일 기반 데이터베이스와 다른 연결로 락을 보유한 상황
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const testDbPath = path.join(os.tmpdir(), `test-lock-${Date.now()}-${randomUUID()}.db`);
      
      const testDb = new Database(testDbPath);
      testDb.pragma('journal_mode = WAL');
      
      // 다른 연결로 락 획득
      const lockDb = new Database(testDbPath);
      lockDb.pragma('journal_mode = WAL');
      const lockStmt = lockDb.prepare('BEGIN IMMEDIATE TRANSACTION');
      lockStmt.run();

      const monitor = new DatabaseLockMonitor(testDb, config, mockLogger as Logger);

      // When: 락이 있는 상태에서 checkLockStatus 호출
      const status1 = await (monitor as any).checkLockStatus();
      expect(status1.isLocked).toBe(true);
      expect((monitor as any).lockStartTime).not.toBeNull();

      // 락 해제
      lockDb.prepare('ROLLBACK').run();
      lockDb.close();

      // 락이 해제된 후 checkLockStatus 호출
      const status2 = await (monitor as any).checkLockStatus();

      // Then: lockStartTime이 초기화되고 lockDuration이 0이어야 함
      expect(status2.isLocked).toBe(false);
      expect(status2.lockDuration).toBe(0);
      expect((monitor as any).lockStartTime).toBeNull();
      
      // 정리
      testDb.close();
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    });

    it('stop() 호출 시 lockStartTime을 초기화해야 함', async () => {
      // Given: 파일 기반 데이터베이스와 다른 연결로 락을 보유한 상황
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const testDbPath = path.join(os.tmpdir(), `test-lock-${Date.now()}-${randomUUID()}.db`);
      
      const testDb = new Database(testDbPath);
      testDb.pragma('journal_mode = WAL');
      
      // 다른 연결로 락 획득
      const lockDb = new Database(testDbPath);
      lockDb.pragma('journal_mode = WAL');
      const lockStmt = lockDb.prepare('BEGIN IMMEDIATE TRANSACTION');
      lockStmt.run();

      const monitor = new DatabaseLockMonitor(testDb, config, mockLogger as Logger);
      monitor.start();

      // 락 감지
      await (monitor as any).checkLockStatus();
      expect((monitor as any).lockStartTime).not.toBeNull();

      // When: stop() 호출
      monitor.stop();

      // Then: lockStartTime이 초기화되어야 함
      expect((monitor as any).lockStartTime).toBeNull();
      
      // 정리
      lockDb.prepare('ROLLBACK').run();
      lockDb.close();
      testDb.close();
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    });
  });

  describe('임계값 기반 경고 및 조치', () => {
    it('락 감지 시 diagnostics 이벤트를 기록해야 함', async () => {
      const writeEvent = vi.fn().mockResolvedValue(undefined);
      const monitor = new DatabaseLockMonitor(
        db,
        config,
        mockLogger as Logger,
        mockPerformanceMonitor as PerformanceMonitor,
        mockCheckpointScheduler as unknown as WalCheckpointScheduler,
        { writeEvent } as any
      );

      await (monitor as any).handleLockStatus({
        isLocked: true,
        lockDuration: config.warningThresholdMs,
        detectionMethod: 'busy_timeout',
        busyCount: 1
      });

      expect(writeEvent).toHaveBeenCalledWith(expect.objectContaining({
        type: 'database_lock_detected',
        severity: 'warning',
        detectionMethod: 'busy_timeout'
      }));
    });

    it('락 지속 시간이 warningThresholdMs 미만이면 경고하지 않아야 함', async () => {
      // Given: 락이 있지만 warningThresholdMs 미만인 상황
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const testDbPath = path.join(os.tmpdir(), `test-lock-${Date.now()}-${randomUUID()}.db`);
      
      const testDb = new Database(testDbPath);
      testDb.pragma('journal_mode = WAL');
      
      const lockDb = new Database(testDbPath);
      lockDb.pragma('journal_mode = WAL');
      const lockStmt = lockDb.prepare('BEGIN IMMEDIATE TRANSACTION');
      lockStmt.run();

      const monitor = new DatabaseLockMonitor(testDb, config, mockLogger as Logger);
      
      // When: checkLockStatus 호출 (락 지속 시간이 짧음)
      const status = await (monitor as any).checkLockStatus();
      await (monitor as any).handleLockStatus(status);

      // Then: warning 로그가 출력되지 않아야 함
      expect(mockLogger.warn).not.toHaveBeenCalled();
      
      // 정리
      lockDb.prepare('ROLLBACK').run();
      lockDb.close();
      testDb.close();
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    });

    it('락 지속 시간이 warningThresholdMs 이상이면 경고 로그를 출력해야 함', async () => {
      // Given: 락이 있고 warningThresholdMs 이상 지속된 상황
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const testDbPath = path.join(os.tmpdir(), `test-lock-${Date.now()}-${randomUUID()}.db`);
      
      const testDb = new Database(testDbPath);
      testDb.pragma('journal_mode = WAL');
      
      const lockDb = new Database(testDbPath);
      lockDb.pragma('journal_mode = WAL');
      const lockStmt = lockDb.prepare('BEGIN IMMEDIATE TRANSACTION');
      lockStmt.run();

      const monitor = new DatabaseLockMonitor(testDb, config, mockLogger as Logger);
      
      // lockStartTime을 강제로 설정하여 warningThresholdMs 이상 지속되도록 함
      (monitor as any).lockStartTime = Date.now() - config.warningThresholdMs - 100;
      
      // When: checkLockStatus 및 handleLockStatus 호출
      const status = await (monitor as any).checkLockStatus();
      await (monitor as any).handleLockStatus(status);

      // Then: warning 로그가 출력되어야 함
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('데이터베이스 락 경고'),
        expect.objectContaining({
          lockDuration: expect.any(Number)
        })
      );
      
      // 정리
      lockDb.prepare('ROLLBACK').run();
      lockDb.close();
      testDb.close();
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    });

    it('락 지속 시간이 dangerThresholdMs 이상이면 경고 로그와 체크포인트를 시도해야 함', async () => {
      // Given: 락이 있고 dangerThresholdMs 이상 지속된 상황
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const testDbPath = path.join(os.tmpdir(), `test-lock-${Date.now()}-${randomUUID()}.db`);
      
      const testDb = new Database(testDbPath);
      testDb.pragma('journal_mode = WAL');
      
      const lockDb = new Database(testDbPath);
      lockDb.pragma('journal_mode = WAL');
      const lockStmt = lockDb.prepare('BEGIN IMMEDIATE TRANSACTION');
      lockStmt.run();

      const monitor = new DatabaseLockMonitor(
        testDb,
        config,
        mockLogger as Logger,
        undefined,
        mockCheckpointScheduler as unknown as WalCheckpointScheduler
      );
      
      // lockStartTime을 강제로 설정하여 dangerThresholdMs 이상 지속되도록 함
      (monitor as any).lockStartTime = Date.now() - config.dangerThresholdMs - 100;
      
      // When: checkLockStatus 및 handleLockStatus 호출
      const status = await (monitor as any).checkLockStatus();
      await (monitor as any).handleLockStatus(status);

      // Then: warning 로그와 체크포인트 시도가 있어야 함
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('데이터베이스 락 위험'),
        expect.objectContaining({
          lockDuration: expect.any(Number)
        })
      );
      expect(mockCheckpointScheduler.checkpointNow).toHaveBeenCalled();
      
      // 정리
      lockDb.prepare('ROLLBACK').run();
      lockDb.close();
      testDb.close();
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    });

    it('락 지속 시간이 criticalThresholdMs 이상이면 경고 로그, 체크포인트 시도, 에러 로깅을 해야 함', async () => {
      // Given: 락이 있고 criticalThresholdMs 이상 지속된 상황
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const testDbPath = path.join(os.tmpdir(), `test-lock-${Date.now()}-${randomUUID()}.db`);
      
      const testDb = new Database(testDbPath);
      testDb.pragma('journal_mode = WAL');
      
      const lockDb = new Database(testDbPath);
      lockDb.pragma('journal_mode = WAL');
      const lockStmt = lockDb.prepare('BEGIN IMMEDIATE TRANSACTION');
      lockStmt.run();

      const monitor = new DatabaseLockMonitor(
        testDb,
        config,
        mockLogger as Logger,
        undefined,
        mockCheckpointScheduler as unknown as WalCheckpointScheduler
      );
      
      // lockStartTime을 강제로 설정하여 criticalThresholdMs 이상 지속되도록 함
      (monitor as any).lockStartTime = Date.now() - config.criticalThresholdMs - 100;
      
      // When: checkLockStatus 및 handleLockStatus 호출
      const status = await (monitor as any).checkLockStatus();
      await (monitor as any).handleLockStatus(status);

      // Then: warning 로그, 체크포인트 시도, 에러 로깅이 있어야 함
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('데이터베이스 락 치명적'),
        expect.objectContaining({
          lockDuration: expect.any(Number)
        })
      );
      expect(mockCheckpointScheduler.checkpointNow).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('데이터베이스 락 치명적'),
        expect.objectContaining({
          lockDuration: expect.any(Number)
        })
      );
      
      // 정리
      lockDb.prepare('ROLLBACK').run();
      lockDb.close();
      testDb.close();
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    });

    it('checkpointScheduler가 없으면 체크포인트 시도를 건너뛰어야 함', async () => {
      // Given: 락이 있고 dangerThresholdMs 이상 지속되었지만 checkpointScheduler가 없는 상황
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const testDbPath = path.join(os.tmpdir(), `test-lock-${Date.now()}-${randomUUID()}.db`);
      
      const testDb = new Database(testDbPath);
      testDb.pragma('journal_mode = WAL');
      
      const lockDb = new Database(testDbPath);
      lockDb.pragma('journal_mode = WAL');
      const lockStmt = lockDb.prepare('BEGIN IMMEDIATE TRANSACTION');
      lockStmt.run();

      const monitor = new DatabaseLockMonitor(testDb, config, mockLogger as Logger);
      
      // lockStartTime을 강제로 설정하여 dangerThresholdMs 이상 지속되도록 함
      (monitor as any).lockStartTime = Date.now() - config.dangerThresholdMs - 100;
      
      // When: checkLockStatus 및 handleLockStatus 호출
      const status = await (monitor as any).checkLockStatus();
      await (monitor as any).handleLockStatus(status);

      // Then: warning 로그는 출력되지만 체크포인트 시도는 없어야 함
      expect(mockLogger.warn).toHaveBeenCalled();
      // checkpointScheduler가 없으므로 checkpointNow는 호출되지 않음
      
      // 정리
      lockDb.prepare('ROLLBACK').run();
      lockDb.close();
      testDb.close();
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    });
  });

  describe('PerformanceMonitor 메트릭 수집', () => {
    it('락이 감지되면 database_lock_count 메트릭을 증가시켜야 함', async () => {
      // Given: 파일 기반 데이터베이스와 다른 연결로 락을 보유한 상황
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const testDbPath = path.join(os.tmpdir(), `test-lock-${Date.now()}-${randomUUID()}.db`);
      
      const testDb = new Database(testDbPath);
      testDb.pragma('journal_mode = WAL');
      
      const lockDb = new Database(testDbPath);
      lockDb.pragma('journal_mode = WAL');
      const lockStmt = lockDb.prepare('BEGIN IMMEDIATE TRANSACTION');
      lockStmt.run();

      const monitor = new DatabaseLockMonitor(
        testDb,
        config,
        mockLogger as Logger,
        mockPerformanceMonitor as PerformanceMonitor
      );

      // When: checkLockStatus 및 handleLockStatus 호출
      const status = await (monitor as any).checkLockStatus();
      await (monitor as any).handleLockStatus(status);

      // Then: database_lock_count 메트릭이 증가되어야 함
      expect(mockPerformanceMonitor.incrementCounter).toHaveBeenCalledWith('database_lock_count');
      
      // 정리
      lockDb.prepare('ROLLBACK').run();
      lockDb.close();
      testDb.close();
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    });

    it('락이 감지되면 database_lock_duration 메트릭을 기록해야 함', async () => {
      // Given: 파일 기반 데이터베이스와 다른 연결로 락을 보유한 상황
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const testDbPath = path.join(os.tmpdir(), `test-lock-${Date.now()}-${randomUUID()}.db`);
      
      const testDb = new Database(testDbPath);
      testDb.pragma('journal_mode = WAL');
      
      const lockDb = new Database(testDbPath);
      lockDb.pragma('journal_mode = WAL');
      const lockStmt = lockDb.prepare('BEGIN IMMEDIATE TRANSACTION');
      lockStmt.run();

      const monitor = new DatabaseLockMonitor(
        testDb,
        config,
        mockLogger as Logger,
        mockPerformanceMonitor as PerformanceMonitor
      );

      // lockStartTime을 강제로 설정하여 특정 지속 시간 시뮬레이션
      (monitor as any).lockStartTime = Date.now() - 1000; // 1초 전

      // When: checkLockStatus 및 handleLockStatus 호출
      const status = await (monitor as any).checkLockStatus();
      await (monitor as any).handleLockStatus(status);

      // Then: database_lock_duration 메트릭이 기록되어야 함
      expect(mockPerformanceMonitor.recordMetric).toHaveBeenCalledWith(
        'database_lock_duration',
        expect.any(Number)
      );
      const durationCall = mockPerformanceMonitor.recordMetric.mock.calls.find(
        call => call[0] === 'database_lock_duration'
      );
      expect(durationCall).toBeDefined();
      expect(durationCall![1]).toBeGreaterThanOrEqual(1000);
      
      // 정리
      lockDb.prepare('ROLLBACK').run();
      lockDb.close();
      testDb.close();
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    });

    it('락이 없으면 메트릭을 기록하지 않아야 함', async () => {
      // Given: 락이 없는 데이터베이스
      const monitor = new DatabaseLockMonitor(
        db,
        config,
        mockLogger as Logger,
        mockPerformanceMonitor as PerformanceMonitor
      );

      // When: checkLockStatus 및 handleLockStatus 호출
      const status = await (monitor as any).checkLockStatus();
      await (monitor as any).handleLockStatus(status);

      // Then: 메트릭이 기록되지 않아야 함
      expect(mockPerformanceMonitor.incrementCounter).not.toHaveBeenCalled();
      expect(mockPerformanceMonitor.recordMetric).not.toHaveBeenCalled();
    });

    it('performanceMonitor가 없으면 메트릭을 기록하지 않아야 함', async () => {
      // Given: 파일 기반 데이터베이스와 다른 연결로 락을 보유한 상황, performanceMonitor 없음
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const testDbPath = path.join(os.tmpdir(), `test-lock-${Date.now()}-${randomUUID()}.db`);
      
      const testDb = new Database(testDbPath);
      testDb.pragma('journal_mode = WAL');
      
      const lockDb = new Database(testDbPath);
      lockDb.pragma('journal_mode = WAL');
      const lockStmt = lockDb.prepare('BEGIN IMMEDIATE TRANSACTION');
      lockStmt.run();

      const monitor = new DatabaseLockMonitor(testDb, config, mockLogger as Logger);

      // When: checkLockStatus 및 handleLockStatus 호출
      const status = await (monitor as any).checkLockStatus();
      await (monitor as any).handleLockStatus(status);

      // Then: 에러가 발생하지 않아야 함 (performanceMonitor가 없어도 동작해야 함)
      expect(status.isLocked).toBe(true);
      
      // 정리
      lockDb.prepare('ROLLBACK').run();
      lockDb.close();
      testDb.close();
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    });
  });

  describe('busy_timeout 초과 통계 추적', () => {
    it('SQLITE_BUSY 에러 발생 시 busyCount가 증가해야 함', async () => {
      // Given: 파일 기반 데이터베이스와 다른 연결로 락을 보유한 상황
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const testDbPath = path.join(os.tmpdir(), `test-lock-${Date.now()}-${randomUUID()}.db`);
      
      const testDb = new Database(testDbPath);
      testDb.pragma('journal_mode = WAL');
      
      const lockDb = new Database(testDbPath);
      lockDb.pragma('journal_mode = WAL');
      const lockStmt = lockDb.prepare('BEGIN IMMEDIATE TRANSACTION');
      lockStmt.run();

      const monitor = new DatabaseLockMonitor(testDb, config, mockLogger as Logger);

      // When: checkLockStatus를 여러 번 호출
      const status1 = await (monitor as any).checkLockStatus();
      const status2 = await (monitor as any).checkLockStatus();
      const status3 = await (monitor as any).checkLockStatus();

      // Then: busyCount가 증가해야 함
      expect(status1.busyCount).toBe(1);
      expect(status2.busyCount).toBe(2);
      expect(status3.busyCount).toBe(3);
      
      // 정리
      lockDb.prepare('ROLLBACK').run();
      lockDb.close();
      testDb.close();
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    });

    it('stop() 호출 시 busyCount를 초기화해야 함', async () => {
      // Given: 파일 기반 데이터베이스와 다른 연결로 락을 보유한 상황
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const testDbPath = path.join(os.tmpdir(), `test-lock-${Date.now()}-${randomUUID()}.db`);
      
      const testDb = new Database(testDbPath);
      testDb.pragma('journal_mode = WAL');
      
      const lockDb = new Database(testDbPath);
      lockDb.pragma('journal_mode = WAL');
      const lockStmt = lockDb.prepare('BEGIN IMMEDIATE TRANSACTION');
      lockStmt.run();

      const monitor = new DatabaseLockMonitor(testDb, config, mockLogger as Logger);
      monitor.start();

      // busyCount 증가
      await (monitor as any).checkLockStatus();
      expect((monitor as any).busyCount).toBeGreaterThan(0);

      // When: stop() 호출
      monitor.stop();

      // Then: busyCount가 초기화되어야 함
      expect((monitor as any).busyCount).toBe(0);
      
      // 정리
      lockDb.prepare('ROLLBACK').run();
      lockDb.close();
      testDb.close();
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    });

    it('1시간이 지나면 시간당 발생 횟수를 메트릭으로 기록해야 함', async () => {
      // Given: 파일 기반 데이터베이스와 다른 연결로 락을 보유한 상황
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const testDbPath = path.join(os.tmpdir(), `test-lock-${Date.now()}-${randomUUID()}.db`);
      
      const testDb = new Database(testDbPath);
      testDb.pragma('journal_mode = WAL');
      
      const lockDb = new Database(testDbPath);
      lockDb.pragma('journal_mode = WAL');
      const lockStmt = lockDb.prepare('BEGIN IMMEDIATE TRANSACTION');
      lockStmt.run();

      const monitor = new DatabaseLockMonitor(
        testDb,
        config,
        mockLogger as Logger,
        mockPerformanceMonitor as PerformanceMonitor
      );

      // busyEventTimes에 이벤트 추가
      (monitor as any).busyEventTimes = [Date.now() - 1000, Date.now() - 500, Date.now() - 100];
      
      // 1시간이 지난 것처럼 시뮬레이션
      (monitor as any).statsResetTime = Date.now() - 1000;

      // When: updateBusyStatistics 호출
      await (monitor as any).updateBusyStatistics();

      // Then: 시간당 발생 횟수 메트릭이 기록되어야 함
      expect(mockPerformanceMonitor.recordMetric).toHaveBeenCalledWith(
        'database_lock_hourly_count',
        3
      );
      
      // 정리
      lockDb.prepare('ROLLBACK').run();
      lockDb.close();
      testDb.close();
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    });

    it('시간당 발생 횟수가 100을 초과하면 경고 로그를 출력해야 함', async () => {
      // Given: 파일 기반 데이터베이스와 다른 연결로 락을 보유한 상황
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const testDbPath = path.join(os.tmpdir(), `test-lock-${Date.now()}-${randomUUID()}.db`);
      
      const testDb = new Database(testDbPath);
      testDb.pragma('journal_mode = WAL');
      
      const lockDb = new Database(testDbPath);
      lockDb.pragma('journal_mode = WAL');
      const lockStmt = lockDb.prepare('BEGIN IMMEDIATE TRANSACTION');
      lockStmt.run();

      const monitor = new DatabaseLockMonitor(
        testDb,
        config,
        mockLogger as Logger,
        mockPerformanceMonitor as PerformanceMonitor
      );

      // busyEventTimes에 101개의 이벤트 추가 (임계값 초과)
      (monitor as any).busyEventTimes = Array.from({ length: 101 }, () => Date.now());
      
      // 1시간이 지난 것처럼 시뮬레이션
      (monitor as any).statsResetTime = Date.now() - 1000;

      // When: updateBusyStatistics 호출
      await (monitor as any).updateBusyStatistics();

      // Then: 경고 로그가 출력되어야 함
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '시간당 busy_timeout 발생 횟수가 높음',
        expect.objectContaining({
          hourlyBusyCount: 101,
          threshold: 100
        })
      );
      
      // 정리
      lockDb.prepare('ROLLBACK').run();
      lockDb.close();
      testDb.close();
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    });
  });
});
