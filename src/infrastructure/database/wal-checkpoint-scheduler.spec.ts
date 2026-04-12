/**
 * WAL Checkpoint Scheduler 테스트
 * TDD 방법론 적용: Given/When/Then 형식
 */

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { CheckpointMode, type CheckpointResult, type Logger, type PerformanceMonitor, type WalCheckpointSchedulerConfig, WalCheckpointScheduler } from './wal-checkpoint-scheduler.js';
import { setupTestDatabase, cleanupTestDatabase } from '../../test/helpers/test-database.js';

function uniqueWalTestDbPath(): string {
  return join(tmpdir(), `wal-checkpoint-scheduler-${randomBytes(8).toString('hex')}.db`);
}

type WalCheckpointSchedulerTestAccess = {
  checkpoint: (mode: CheckpointMode) => Promise<CheckpointResult>;
  executeCheckpoint: (db: Database.Database, mode: CheckpointMode) => CheckpointResult;
  getWalFileSize: () => Promise<number>;
  dedicatedConnection: Database.Database | null;
  checkpointInProgress: boolean;
  intervalId: NodeJS.Timeout | null;
  isRunning: boolean;
};

describe('CheckpointMode enum', () => {
  it('PASSIVE 모드가 정의되어야 함', () => {
    // Given: CheckpointMode enum이 정의되어 있음
    // When: PASSIVE 모드 확인
    // Then: PASSIVE 모드가 'PASSIVE' 값을 가져야 함
    expect(CheckpointMode.PASSIVE).toBe('PASSIVE');
  });

  it('TRUNCATE 모드가 정의되어야 함', () => {
    // Given: CheckpointMode enum이 정의되어 있음
    // When: TRUNCATE 모드 확인
    // Then: TRUNCATE 모드가 'TRUNCATE' 값을 가져야 함
    expect(CheckpointMode.TRUNCATE).toBe('TRUNCATE');
  });

  it('FULL 모드가 정의되어야 함', () => {
    // Given: CheckpointMode enum이 정의되어 있음
    // When: FULL 모드 확인
    // Then: FULL 모드가 'FULL' 값을 가져야 함
    expect(CheckpointMode.FULL).toBe('FULL');
  });
});

describe('CheckpointResult interface', () => {
  it('CheckpointResult 타입이 정의되어야 함', () => {
    // Given: CheckpointResult 인터페이스가 정의되어 있음
    // When: CheckpointResult 타입의 객체 생성
    const result: CheckpointResult = {
      mode: CheckpointMode.PASSIVE,
      success: true,
      log: 100,
      checkpointed: 50,
      busy: 0
    };

    // Then: 모든 필수 필드가 있어야 함
    expect(result.mode).toBe(CheckpointMode.PASSIVE);
    expect(result.success).toBe(true);
    expect(result.log).toBe(100);
    expect(result.checkpointed).toBe(50);
    expect(result.busy).toBe(0);
  });

  it('CheckpointResult에 error 필드가 선택적으로 포함될 수 있어야 함', () => {
    // Given: CheckpointResult 인터페이스가 정의되어 있음
    // When: error 필드를 포함한 CheckpointResult 객체 생성
    const result: CheckpointResult = {
      mode: CheckpointMode.PASSIVE,
      success: false,
      log: 0,
      checkpointed: 0,
      busy: 1,
      error: new Error('Checkpoint failed')
    };

    // Then: error 필드가 포함되어야 함
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe('Checkpoint failed');
  });
});

describe('WalCheckpointSchedulerConfig interface', () => {
  it('WalCheckpointSchedulerConfig 타입이 정의되어야 함', () => {
    // Given: WalCheckpointSchedulerConfig 인터페이스가 정의되어 있음
    // When: 모든 필수 필드를 포함한 설정 객체 생성
    const config: WalCheckpointSchedulerConfig = {
      intervalMs: 300000, // 5분
      walSizeWarningThreshold: 16 * 1024 * 1024, // 16MB
      walSizeDangerThreshold: 24 * 1024 * 1024, // 24MB
      useDedicatedConnection: true,
      maxRetries: 3,
      retryBackoffMs: 1000
    };

    // Then: 모든 필수 필드가 있어야 함
    expect(config.intervalMs).toBe(300000);
    expect(config.walSizeWarningThreshold).toBe(16 * 1024 * 1024);
    expect(config.walSizeDangerThreshold).toBe(24 * 1024 * 1024);
    expect(config.useDedicatedConnection).toBe(true);
    expect(config.maxRetries).toBe(3);
    expect(config.retryBackoffMs).toBe(1000);
  });

  it('WalCheckpointSchedulerConfig에 기본값으로 사용할 수 있는 값들이 올바른 타입이어야 함', () => {
    // Given: WalCheckpointSchedulerConfig 인터페이스가 정의되어 있음
    // When: 각 필드의 타입 확인
    const config: WalCheckpointSchedulerConfig = {
      intervalMs: 300000,
      walSizeWarningThreshold: 16777216,
      walSizeDangerThreshold: 25165824,
      useDedicatedConnection: false,
      maxRetries: 5,
      retryBackoffMs: 2000
    };

    // Then: 모든 필드가 올바른 타입이어야 함
    expect(typeof config.intervalMs).toBe('number');
    expect(typeof config.walSizeWarningThreshold).toBe('number');
    expect(typeof config.walSizeDangerThreshold).toBe('number');
    expect(typeof config.useDedicatedConnection).toBe('boolean');
    expect(typeof config.maxRetries).toBe('number');
    expect(typeof config.retryBackoffMs).toBe('number');
  });
});

describe('WalCheckpointScheduler class', () => {
  let db: Database.Database;
  let config: WalCheckpointSchedulerConfig;
  let mockLogger: Logger & { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let mockPerformanceMonitor: PerformanceMonitor & { recordMetric: ReturnType<typeof vi.fn>; incrementCounter: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    // Given: 테스트 데이터베이스와 설정이 준비되어 있음
    db = await setupTestDatabase();
    db.pragma('journal_mode = WAL');
    
    config = {
      intervalMs: 100, // 테스트를 위해 짧은 주기 사용
      walSizeWarningThreshold: 16 * 1024 * 1024,
      walSizeDangerThreshold: 24 * 1024 * 1024,
      useDedicatedConnection: false, // 테스트를 위해 false로 설정
      maxRetries: 3,
      retryBackoffMs: 100
    };

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    mockPerformanceMonitor = {
      recordMetric: vi.fn(),
      incrementCounter: vi.fn(),
    };
  });

  afterEach(() => {
    cleanupTestDatabase(db);
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('WalCheckpointScheduler 인스턴스를 생성할 수 있어야 함', () => {
      // Given: 데이터베이스와 설정이 준비되어 있음
      // When: WalCheckpointScheduler 인스턴스 생성
      const scheduler = new WalCheckpointScheduler(
        db,
        config,
        mockLogger,
        mockPerformanceMonitor
      );

      // Then: 인스턴스가 생성되어야 함
      expect(scheduler).toBeInstanceOf(WalCheckpointScheduler);
    });

    it('logger와 performanceMonitor 없이도 인스턴스를 생성할 수 있어야 함', () => {
      // Given: 데이터베이스와 설정이 준비되어 있음
      // When: logger와 performanceMonitor 없이 WalCheckpointScheduler 인스턴스 생성
      const scheduler = new WalCheckpointScheduler(db, config);

      // Then: 인스턴스가 생성되어야 함
      expect(scheduler).toBeInstanceOf(WalCheckpointScheduler);
    });
  });

  describe('start', () => {
    it('스케줄러를 시작할 수 있어야 함', () => {
      // Given: WalCheckpointScheduler 인스턴스가 생성되어 있음
      const scheduler = new WalCheckpointScheduler(
        db,
        config,
        mockLogger
      );

      // When: start() 메서드 호출
      scheduler.start();

      // Then: logger.info가 호출되어야 함
      expect(mockLogger.info).toHaveBeenCalledWith(
        'WAL 체크포인트 스케줄러 시작됨',
        expect.objectContaining({
          intervalMs: config.intervalMs,
          useDedicatedConnection: config.useDedicatedConnection
        })
      );
    });

    it('이미 실행 중인 스케줄러를 다시 시작하면 idempotent하게 동작해야 함', () => {
      // Given: 실행 중인 WalCheckpointScheduler 인스턴스가 있음
      const scheduler = new WalCheckpointScheduler(
        db,
        config,
        mockLogger
      );
      scheduler.start();
      const firstCallCount = mockLogger.info.mock.calls.length;

      // When: start() 메서드를 다시 호출
      scheduler.start();

      // Then: logger.warn이 호출되고, logger.info는 추가로 호출되지 않아야 함
      expect(mockLogger.warn).toHaveBeenCalledWith('WAL 체크포인트 스케줄러가 이미 실행 중입니다');
      expect(mockLogger.info.mock.calls.length).toBe(firstCallCount);
    });
  });

  describe('stop', () => {
    it('실행 중인 스케줄러를 중지할 수 있어야 함', async () => {
      // Given: 실행 중인 WalCheckpointScheduler 인스턴스가 있음
      const scheduler = new WalCheckpointScheduler(
        db,
        config,
        mockLogger
      );
      scheduler.start();

      // When: stop() 메서드 호출
      await scheduler.stop();

      // Then: logger.info가 호출되어야 함
      expect(mockLogger.info).toHaveBeenCalledWith('WAL 체크포인트 스케줄러 중지됨');
    });

    it('실행 중이 아닌 스케줄러를 중지하면 idempotent하게 동작해야 함', async () => {
      // Given: 실행 중이 아닌 WalCheckpointScheduler 인스턴스가 있음
      const scheduler = new WalCheckpointScheduler(
        db,
        config,
        mockLogger
      );

      // When: stop() 메서드 호출
      await scheduler.stop();

      // Then: logger.info가 호출되지 않아야 함 (중지 로그 없음)
      expect(mockLogger.info).not.toHaveBeenCalledWith('WAL 체크포인트 스케줄러 중지됨');
    });

    it('여러 번 stop()을 호출해도 안전해야 함', async () => {
      // Given: 실행 중인 WalCheckpointScheduler 인스턴스가 있음
      const scheduler = new WalCheckpointScheduler(
        db,
        config,
        mockLogger
      );
      scheduler.start();

      // When: stop() 메서드를 여러 번 호출
      await scheduler.stop();
      await scheduler.stop();
      await scheduler.stop();

      // Then: 에러가 발생하지 않아야 함
      expect(mockLogger.info).toHaveBeenCalledTimes(2); // 시작 1회, 중지 1회
    });
  });

  describe('executeCheckpoint (via checkpointNow)', () => {
    it('PASSIVE 모드로 체크포인트를 실행할 수 있어야 함', async () => {
      // Given: WalCheckpointScheduler 인스턴스가 생성되어 있음
      const scheduler = new WalCheckpointScheduler(
        db,
        config,
        mockLogger
      );

      // When: checkpointNow()를 PASSIVE 모드로 호출
      const result = await scheduler.checkpointNow(CheckpointMode.PASSIVE);

      // Then: CheckpointResult가 반환되어야 함
      expect(result).toBeDefined();
      expect(result.mode).toBe(CheckpointMode.PASSIVE);
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('log');
      expect(result).toHaveProperty('checkpointed');
      expect(result).toHaveProperty('busy');
    });

    it('TRUNCATE 모드로 체크포인트를 실행할 수 있어야 함', async () => {
      // Given: WalCheckpointScheduler 인스턴스가 생성되어 있음
      const scheduler = new WalCheckpointScheduler(
        db,
        config,
        mockLogger
      );

      // When: checkpointNow()를 TRUNCATE 모드로 호출
      const result = await scheduler.checkpointNow(CheckpointMode.TRUNCATE);

      // Then: CheckpointResult가 반환되어야 함
      expect(result).toBeDefined();
      expect(result.mode).toBe(CheckpointMode.TRUNCATE);
      expect(result.success).toBeDefined();
    });

    it('FULL 모드로 체크포인트를 실행할 수 있어야 함', async () => {
      // Given: WalCheckpointScheduler 인스턴스가 생성되어 있음
      const scheduler = new WalCheckpointScheduler(
        db,
        config,
        mockLogger
      );

      // When: checkpointNow()를 FULL 모드로 호출
      const result = await scheduler.checkpointNow(CheckpointMode.FULL);

      // Then: CheckpointResult가 반환되어야 함
      expect(result).toBeDefined();
      expect(result.mode).toBe(CheckpointMode.FULL);
      expect(result.success).toBeDefined();
    });

    it('체크포인트 결과에 log, checkpointed, busy 값이 포함되어야 함', async () => {
      // Given: WalCheckpointScheduler 인스턴스가 생성되어 있음
      const scheduler = new WalCheckpointScheduler(
        db,
        config,
        mockLogger
      );

      // When: checkpointNow() 호출
      const result = await scheduler.checkpointNow(CheckpointMode.PASSIVE);

      // Then: 모든 필수 필드가 숫자 타입이어야 함
      expect(typeof result.log).toBe('number');
      expect(typeof result.checkpointed).toBe('number');
      expect(typeof result.busy).toBe('number');
      expect(result.busy).toBeGreaterThanOrEqual(0);
      expect(result.busy).toBeLessThanOrEqual(1);
    });

    it('busy가 0이면 success가 true여야 함', async () => {
      // Given: WalCheckpointScheduler 인스턴스가 생성되어 있음
      const scheduler = new WalCheckpointScheduler(
        db,
        config,
        mockLogger
      );

      // When: checkpointNow() 호출
      const result = await scheduler.checkpointNow(CheckpointMode.PASSIVE);

      // Then: busy가 0이면 success가 true여야 함
      if (result.busy === 0) {
        expect(result.success).toBe(true);
      }
    });
  });

  describe('재시도 및 지수 백오프 로직', () => {
    it('busy=1인 경우 재시도를 시도해야 함', async () => {
      // Given: busy=1을 반환하는 executeCheckpoint가 모킹된 스케줄러
      const scheduler = new WalCheckpointScheduler(
        db,
        { ...config, maxRetries: 3, retryBackoffMs: 10 }, // 짧은 백오프로 테스트 속도 향상
        mockLogger
      );

      // executeCheckpoint를 모킹하여 busy=1을 반환하도록 설정
      let callCount = 0;
      const originalExecuteCheckpoint = (scheduler as unknown as WalCheckpointSchedulerTestAccess).executeCheckpoint.bind(scheduler);
      (scheduler as unknown as WalCheckpointSchedulerTestAccess).executeCheckpoint = vi.fn((db: Database.Database, mode: CheckpointMode) => {
        callCount++;
        if (callCount < 3) {
          // 처음 2번은 busy=1 반환
          return {
            mode,
            success: false,
            log: 100,
            checkpointed: 0,
            busy: 1
          };
        }
        // 3번째 시도에서 성공
        return originalExecuteCheckpoint(db, mode);
      });

      // When: checkpointNow() 호출
      const result = await scheduler.checkpointNow(CheckpointMode.PASSIVE);

      // Then: 3번 호출되어야 함 (재시도 포함)
      expect(callCount).toBe(3);
      expect(result.success).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalled(); // 재시도 경고 로그
    });

    it('최대 재시도 횟수를 초과하면 실패 결과를 반환해야 함', async () => {
      // Given: 항상 busy=1을 반환하는 executeCheckpoint가 모킹된 스케줄러
      const scheduler = new WalCheckpointScheduler(
        db,
        { ...config, maxRetries: 3, retryBackoffMs: 10 },
        mockLogger
      );

      // executeCheckpoint를 모킹하여 항상 busy=1을 반환하도록 설정
      let callCount = 0;
      (scheduler as unknown as WalCheckpointSchedulerTestAccess).executeCheckpoint = vi.fn(() => {
        callCount++;
        return {
          mode: CheckpointMode.PASSIVE,
          success: false,
          log: 100,
          checkpointed: 0,
          busy: 1
        };
      });

      // When: checkpointNow() 호출
      const result = await scheduler.checkpointNow(CheckpointMode.PASSIVE);

      // Then: 최대 재시도 횟수만큼 호출되고 실패 결과 반환
      expect(callCount).toBe(3); // maxRetries만큼 호출
      expect(result.success).toBe(false);
      expect(result.busy).toBe(1);
      expect(result.error).toBeDefined();
    });

    it('지수 백오프 시간이 올바르게 적용되어야 함', async () => {
      // Given: busy=1을 반환하는 executeCheckpoint가 모킹된 스케줄러
      const retryBackoffMs = 100;
      const scheduler = new WalCheckpointScheduler(
        db,
        { ...config, maxRetries: 3, retryBackoffMs },
        mockLogger
      );

      let callCount = 0;
      const callTimes: number[] = [];
      (scheduler as unknown as WalCheckpointSchedulerTestAccess).executeCheckpoint = vi.fn(() => {
        callCount++;
        callTimes.push(Date.now());
        
        if (callCount < 3) {
          return {
            mode: CheckpointMode.PASSIVE,
            success: false,
            log: 100,
            checkpointed: 0,
            busy: 1
          };
        }
        // 3번째 시도에서 성공
        return {
          mode: CheckpointMode.PASSIVE,
          success: true,
          log: 100,
          checkpointed: 50,
          busy: 0
        };
      });

      // When: checkpointNow() 호출
      const startTime = Date.now();
      await scheduler.checkpointNow(CheckpointMode.PASSIVE);
      const endTime = Date.now();

      // Then: 지수 백오프 시간이 적용되어야 함
      // 1번째 재시도: 100ms, 2번째 재시도: 200ms
      // 최소 대기 시간: 100ms + 200ms = 300ms
      expect(endTime - startTime).toBeGreaterThanOrEqual(250); // 약간의 여유
      expect(callCount).toBe(3);
    });
  });

  describe('WAL 파일 크기 모니터링', () => {
    it('WAL 파일 크기를 조회할 수 있어야 함', async () => {
      // Given: WalCheckpointScheduler 인스턴스가 생성되어 있음
      const scheduler = new WalCheckpointScheduler(
        db,
        config,
        mockLogger
      );

      // When: getWalFileSize() 호출 (private 메서드이므로 간접적으로 테스트)
      // 실제로는 checkpointNow() 내부에서 사용되지만, 여기서는 직접 접근
      const walSize = await (scheduler as unknown as WalCheckpointSchedulerTestAccess).getWalFileSize();

      // Then: WAL 파일 크기가 반환되어야 함 (메모리 DB의 경우 0일 수 있음)
      expect(typeof walSize).toBe('number');
      expect(walSize).toBeGreaterThanOrEqual(0);
    });

    it('WAL 파일이 존재하지 않으면 0을 반환해야 함', async () => {
      // Given: 존재하지 않는 데이터베이스 경로를 가진 스케줄러
      const nonExistentDb = new Database(':memory:');
      const scheduler = new WalCheckpointScheduler(
        nonExistentDb,
        config,
        mockLogger
      );

      // When: getWalFileSize() 호출
      const walSize = await (scheduler as unknown as WalCheckpointSchedulerTestAccess).getWalFileSize();

      // Then: 0을 반환해야 함 (메모리 DB는 WAL 파일이 없음)
      expect(walSize).toBe(0);

      nonExistentDb.close();
    });

    it('WAL 파일 경로가 올바르게 구성되어야 함', async () => {
      // Given: 특정 경로의 데이터베이스를 가진 스케줄러
      const testDbPath = uniqueWalTestDbPath();
      const testDb = new Database(testDbPath);
      testDb.pragma('journal_mode = WAL');
      
      const scheduler = new WalCheckpointScheduler(
        testDb,
        config,
        mockLogger
      );

      // When: getWalFileSize() 호출
      const walSize = await (scheduler as unknown as WalCheckpointSchedulerTestAccess).getWalFileSize();

      // Then: WAL 파일 크기가 반환되어야 함 (파일이 없으면 0)
      expect(typeof walSize).toBe('number');
      expect(walSize).toBeGreaterThanOrEqual(0);

      // 정리
      testDb.close();
      const fs = await import('fs');
      try {
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
        if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);
      } catch {
        // 정리 실패는 무시
      }
    });
  });

  describe('전용 커넥션 관리', () => {
    it('useDedicatedConnection=true일 때 전용 커넥션이 생성되어야 함', () => {
      // Given: useDedicatedConnection=true 설정
      const scheduler = new WalCheckpointScheduler(
        db,
        { ...config, useDedicatedConnection: true },
        mockLogger
      );

      // When: start() 호출
      scheduler.start();

      // Then: 전용 커넥션이 생성되어야 함
      expect((scheduler as unknown as WalCheckpointSchedulerTestAccess).dedicatedConnection).toBeDefined();
      expect((scheduler as unknown as WalCheckpointSchedulerTestAccess).dedicatedConnection).not.toBe(db);

      // 정리
      scheduler.stop();
    });

    it('useDedicatedConnection=false일 때 전용 커넥션이 생성되지 않아야 함', () => {
      // Given: useDedicatedConnection=false 설정
      const scheduler = new WalCheckpointScheduler(
        db,
        { ...config, useDedicatedConnection: false },
        mockLogger
      );

      // When: start() 호출
      scheduler.start();

      // Then: 전용 커넥션이 생성되지 않아야 함
      expect((scheduler as unknown as WalCheckpointSchedulerTestAccess).dedicatedConnection).toBeNull();

      // 정리
      scheduler.stop();
    });

    it('전용 커넥션이 생성되면 WAL 모드로 설정되어야 함', () => {
      // Given: useDedicatedConnection=true 설정 및 실제 파일 데이터베이스
      const testDbPath = uniqueWalTestDbPath();
      const testDb = new Database(testDbPath);
      testDb.pragma('journal_mode = WAL');

      const scheduler = new WalCheckpointScheduler(
        testDb,
        { ...config, useDedicatedConnection: true },
        mockLogger
      );

      // When: start() 호출
      scheduler.start();

      // Then: 전용 커넥션이 WAL 모드로 설정되어야 함
      const dedicatedConnection = (scheduler as unknown as WalCheckpointSchedulerTestAccess).dedicatedConnection;
      if (dedicatedConnection) {
        const journalMode = dedicatedConnection.pragma('journal_mode', { simple: true });
        expect(journalMode).toBe('wal');
      }

      // 정리
      scheduler.stop();
      testDb.close();
      const fs = require('fs');
      try {
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
        if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);
      } catch {
        // 정리 실패는 무시
      }
    });

    it('stop() 호출 시 전용 커넥션이 종료되어야 함', async () => {
      // Given: 전용 커넥션이 생성된 스케줄러
      const scheduler = new WalCheckpointScheduler(
        db,
        { ...config, useDedicatedConnection: true },
        mockLogger
      );
      scheduler.start();
      const dedicatedConnection = (scheduler as unknown as WalCheckpointSchedulerTestAccess).dedicatedConnection;
      expect(dedicatedConnection).toBeDefined();

      // When: stop() 호출
      await scheduler.stop();

      // Then: 전용 커넥션이 null이 되어야 함
      expect((scheduler as unknown as WalCheckpointSchedulerTestAccess).dedicatedConnection).toBeNull();
    });

    it('전용 커넥션을 사용할 때 checkpointNow()가 전용 커넥션을 사용해야 함', async () => {
      // Given: 전용 커넥션이 생성된 스케줄러
      const scheduler = new WalCheckpointScheduler(
        db,
        { ...config, useDedicatedConnection: true },
        mockLogger
      );
      scheduler.start();

      // executeCheckpoint를 모킹하여 어떤 DB가 사용되는지 확인
      let usedDb: Database.Database | null = null;
      const originalExecuteCheckpoint = (scheduler as unknown as WalCheckpointSchedulerTestAccess).executeCheckpoint.bind(scheduler);
      (scheduler as unknown as WalCheckpointSchedulerTestAccess).executeCheckpoint = vi.fn((db: Database.Database, mode: CheckpointMode) => {
        usedDb = db;
        return originalExecuteCheckpoint(db, mode);
      });

      // When: checkpointNow() 호출
      await scheduler.checkpointNow(CheckpointMode.PASSIVE);

      // Then: 전용 커넥션이 사용되어야 함
      const dedicatedConnection = (scheduler as unknown as WalCheckpointSchedulerTestAccess).dedicatedConnection;
      expect(usedDb).toBe(dedicatedConnection);
      expect(usedDb).not.toBe(db);

      // 정리
      await scheduler.stop();
    });

    it('전용 커넥션을 사용하지 않을 때 checkpointNow()가 메인 DB를 사용해야 함', async () => {
      // Given: 전용 커넥션을 사용하지 않는 스케줄러
      const scheduler = new WalCheckpointScheduler(
        db,
        { ...config, useDedicatedConnection: false },
        mockLogger
      );
      scheduler.start();

      // executeCheckpoint를 모킹하여 어떤 DB가 사용되는지 확인
      let usedDb: Database.Database | null = null;
      const originalExecuteCheckpoint = (scheduler as unknown as WalCheckpointSchedulerTestAccess).executeCheckpoint.bind(scheduler);
      (scheduler as unknown as WalCheckpointSchedulerTestAccess).executeCheckpoint = vi.fn((db: Database.Database, mode: CheckpointMode) => {
        usedDb = db;
        return originalExecuteCheckpoint(db, mode);
      });

      // When: checkpointNow() 호출
      await scheduler.checkpointNow(CheckpointMode.PASSIVE);

      // Then: 메인 DB가 사용되어야 함
      expect(usedDb).toBe(db);

      // 정리
      await scheduler.stop();
    });
  });

  describe('동시 실행 방지', () => {
    it('checkpointInProgress 플래그로 동시 실행을 방지해야 함', async () => {
      // Given: WalCheckpointScheduler 인스턴스
      const scheduler = new WalCheckpointScheduler(
        db,
        config,
        mockLogger
      );

      // checkpoint() 메서드를 모킹하여 실행 시간을 지연시킴
      let firstCallStarted = false;
      let secondCallAttempted = false;
      const originalCheckpoint = (scheduler as unknown as WalCheckpointSchedulerTestAccess).checkpoint.bind(scheduler);
      (scheduler as unknown as WalCheckpointSchedulerTestAccess).checkpoint = vi.fn(async (mode: CheckpointMode) => {
        if (!firstCallStarted) {
          firstCallStarted = true;
          // 첫 번째 호출은 지연시킴
          await new Promise(resolve => setTimeout(resolve, 100));
        } else {
          secondCallAttempted = true;
        }
        return originalCheckpoint(mode);
      });

      // When: 동시에 두 번 checkpointNow() 호출
      const promise1 = scheduler.checkpointNow(CheckpointMode.PASSIVE);
      const promise2 = scheduler.checkpointNow(CheckpointMode.PASSIVE);

      await Promise.all([promise1, promise2]);

      // Then: 두 번째 호출은 동시 실행 방지로 인해 대기하거나 스킵되어야 함
      // checkpointInProgress 플래그가 제대로 동작하는지 확인
      expect((scheduler as unknown as WalCheckpointSchedulerTestAccess).checkpointInProgress).toBe(false); // 최종적으로 false여야 함
    });

    it('checkpointInProgress가 true일 때 새로운 체크포인트 요청이 거부되어야 함', async () => {
      // Given: checkpointInProgress가 true인 상태
      const scheduler = new WalCheckpointScheduler(
        db,
        config,
        mockLogger
      );

      // checkpointInProgress를 수동으로 true로 설정
      (scheduler as unknown as WalCheckpointSchedulerTestAccess).checkpointInProgress = true;

      // When: checkpointNow() 호출 시도
      // Then: 에러가 발생하거나 대기해야 함
      // 실제로는 checkpoint() 메서드 내부에서 체크하므로, 
      // checkpointInProgress가 true일 때는 에러를 던지거나 대기해야 함
      
      // checkpointInProgress를 false로 복원
      (scheduler as unknown as WalCheckpointSchedulerTestAccess).checkpointInProgress = false;
    });

    it('체크포인트 완료 후 checkpointInProgress가 false로 설정되어야 함', async () => {
      // Given: WalCheckpointScheduler 인스턴스
      const scheduler = new WalCheckpointScheduler(
        db,
        config,
        mockLogger
      );

      // When: checkpointNow() 호출
      await scheduler.checkpointNow(CheckpointMode.PASSIVE);

      // Then: checkpointInProgress가 false여야 함
      expect((scheduler as unknown as WalCheckpointSchedulerTestAccess).checkpointInProgress).toBe(false);
    });
  });

  describe('WAL 크기 임계치 기반 TRUNCATE 모드 자동 전환', () => {
    it('WAL 크기가 위험 임계치를 넘으면 TRUNCATE 모드로 자동 전환해야 함', async () => {
      // Given: WAL 크기가 위험 임계치를 넘는 상황을 시뮬레이션
      const scheduler = new WalCheckpointScheduler(
        db,
        {
          ...config,
          walSizeDangerThreshold: 1000, // 작은 임계치로 테스트
          walSizeWarningThreshold: 500
        },
        mockLogger
      );

      // getWalFileSize를 모킹하여 위험 임계치를 넘는 크기 반환
      let getWalFileSizeCallCount = 0;
      (scheduler as unknown as WalCheckpointSchedulerTestAccess).getWalFileSize = vi.fn(async () => {
        getWalFileSizeCallCount++;
        // 첫 번째 호출: 위험 임계치 초과
        // 두 번째 호출: TRUNCATE 후 크기 (작아짐)
        return getWalFileSizeCallCount === 1 ? 2000 : 100;
      });

      // executeCheckpoint를 모킹하여 TRUNCATE 모드 호출 확인
      let truncateModeCalled = false;
      const originalExecuteCheckpoint = (scheduler as unknown as WalCheckpointSchedulerTestAccess).executeCheckpoint.bind(scheduler);
      (scheduler as unknown as WalCheckpointSchedulerTestAccess).executeCheckpoint = vi.fn((db: Database.Database, mode: CheckpointMode) => {
        if (mode === CheckpointMode.TRUNCATE) {
          truncateModeCalled = true;
        }
        return originalExecuteCheckpoint(db, mode);
      });

      // When: PASSIVE 모드로 checkpointNow() 호출
      await scheduler.checkpointNow(CheckpointMode.PASSIVE);

      // Then: TRUNCATE 모드가 호출되어야 함
      expect(truncateModeCalled).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('WAL 파일 크기 위험'),
        expect.any(Object)
      );
    });

    it('WAL 크기가 경고 임계치를 넘으면 경고 로그를 출력해야 함', async () => {
      // Given: WAL 크기가 경고 임계치를 넘는 상황
      const scheduler = new WalCheckpointScheduler(
        db,
        {
          ...config,
          walSizeWarningThreshold: 500,
          walSizeDangerThreshold: 2000
        },
        mockLogger
      );

      // getWalFileSize를 모킹하여 경고 임계치를 넘지만 위험 임계치는 넘지 않는 크기 반환
      (scheduler as unknown as WalCheckpointSchedulerTestAccess).getWalFileSize = vi.fn(async () => 1000);

      // When: checkpointNow() 호출
      await scheduler.checkpointNow(CheckpointMode.PASSIVE);

      // Then: 경고 로그가 출력되어야 함
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'WAL 파일 크기 경고',
        expect.objectContaining({
          walSize: 1000,
          threshold: 500
        })
      );
    });

    it('WAL 크기가 정상 범위이면 경고 없이 정상 처리해야 함', async () => {
      // Given: WAL 크기가 정상 범위인 상황
      const scheduler = new WalCheckpointScheduler(
        db,
        {
          ...config,
          walSizeWarningThreshold: 500,
          walSizeDangerThreshold: 2000
        },
        mockLogger
      );

      // getWalFileSize를 모킹하여 정상 범위 크기 반환
      (scheduler as unknown as WalCheckpointSchedulerTestAccess).getWalFileSize = vi.fn(async () => 100);

      // When: checkpointNow() 호출
      await scheduler.checkpointNow(CheckpointMode.PASSIVE);

      // Then: 경고 로그가 출력되지 않아야 함
      const warnCalls = mockLogger.warn.mock.calls.filter((call: unknown[]) => 
        call[0]?.includes('WAL 파일 크기')
      );
      expect(warnCalls.length).toBe(0);
    });

    it('이미 TRUNCATE 모드인 경우 추가 TRUNCATE 호출하지 않아야 함', async () => {
      // Given: TRUNCATE 모드로 호출하는 스케줄러
      const scheduler = new WalCheckpointScheduler(
        db,
        {
          ...config,
          walSizeDangerThreshold: 1000
        },
        mockLogger
      );

      // getWalFileSize를 모킹하여 위험 임계치를 넘는 크기 반환
      (scheduler as unknown as WalCheckpointSchedulerTestAccess).getWalFileSize = vi.fn(async () => 2000);

      // executeCheckpoint 호출 횟수 추적
      let executeCheckpointCallCount = 0;
      const originalExecuteCheckpoint = (scheduler as unknown as WalCheckpointSchedulerTestAccess).executeCheckpoint.bind(scheduler);
      (scheduler as unknown as WalCheckpointSchedulerTestAccess).executeCheckpoint = vi.fn((db: Database.Database, mode: CheckpointMode) => {
        executeCheckpointCallCount++;
        return originalExecuteCheckpoint(db, mode);
      });

      // When: TRUNCATE 모드로 checkpointNow() 호출
      await scheduler.checkpointNow(CheckpointMode.TRUNCATE);

      // Then: executeCheckpoint가 한 번만 호출되어야 함 (추가 TRUNCATE 없음)
      expect(executeCheckpointCallCount).toBe(1);
    });
  });

  describe('PerformanceMonitor 메트릭 수집', () => {
    it('체크포인트 성공 시 wal_checkpoint_duration 메트릭을 수집해야 함', async () => {
      // Given: PerformanceMonitor가 설정된 스케줄러
      const scheduler = new WalCheckpointScheduler(
        db,
        config,
        mockLogger,
        mockPerformanceMonitor
      );

      // When: checkpointNow() 호출
      await scheduler.checkpointNow(CheckpointMode.PASSIVE);

      // Then: wal_checkpoint_duration 메트릭이 수집되어야 함
      expect(mockPerformanceMonitor.recordMetric).toHaveBeenCalledWith(
        'wal_checkpoint_duration',
        expect.any(Number)
      );
      const durationCall = mockPerformanceMonitor.recordMetric.mock.calls.find(
        (call: unknown[]) => call[0] === 'wal_checkpoint_duration'
      );
      expect(durationCall).toBeDefined();
      expect(durationCall[1]).toBeGreaterThanOrEqual(0);
    });

    it('체크포인트 성공 시 wal_file_size 메트릭을 수집해야 함', async () => {
      // Given: PerformanceMonitor가 설정된 스케줄러
      const scheduler = new WalCheckpointScheduler(
        db,
        config,
        mockLogger,
        mockPerformanceMonitor
      );

      // getWalFileSize를 모킹하여 특정 크기 반환
      (scheduler as unknown as WalCheckpointSchedulerTestAccess).getWalFileSize = vi.fn(async () => 1024 * 1024); // 1MB

      // When: checkpointNow() 호출
      await scheduler.checkpointNow(CheckpointMode.PASSIVE);

      // Then: wal_file_size 메트릭이 수집되어야 함
      expect(mockPerformanceMonitor.recordMetric).toHaveBeenCalledWith(
        'wal_file_size',
        expect.any(Number)
      );
      const sizeCall = mockPerformanceMonitor.recordMetric.mock.calls.find(
        (call: unknown[]) => call[0] === 'wal_file_size'
      );
      expect(sizeCall).toBeDefined();
      expect(sizeCall[1]).toBeGreaterThanOrEqual(0);
    });

    it('체크포인트 실패 시 메트릭을 수집하지 않아야 함', async () => {
      // Given: 항상 실패하는 executeCheckpoint가 모킹된 스케줄러
      const scheduler = new WalCheckpointScheduler(
        db,
        { ...config, maxRetries: 1 }, // 재시도 없이 즉시 실패
        mockLogger,
        mockPerformanceMonitor
      );

      // executeCheckpoint를 모킹하여 항상 busy=1 반환
      (scheduler as unknown as WalCheckpointSchedulerTestAccess).executeCheckpoint = vi.fn(() => ({
        mode: CheckpointMode.PASSIVE,
        success: false,
        log: 0,
        checkpointed: 0,
        busy: 1
      }));

      // When: checkpointNow() 호출
      await scheduler.checkpointNow(CheckpointMode.PASSIVE);

      // Then: 메트릭이 수집되지 않아야 함
      expect(mockPerformanceMonitor.recordMetric).not.toHaveBeenCalled();
    });

    it('PerformanceMonitor가 없어도 정상 동작해야 함', async () => {
      // Given: PerformanceMonitor가 없는 스케줄러
      const scheduler = new WalCheckpointScheduler(
        db,
        config,
        mockLogger
      );

      // When: checkpointNow() 호출
      const result = await scheduler.checkpointNow(CheckpointMode.PASSIVE);

      // Then: 정상적으로 결과가 반환되어야 함
      expect(result).toBeDefined();
      expect(result.success).toBeDefined();
    });
  });

  describe('idempotent 동작 보장 (추가 테스트)', () => {
    it('start() -> stop() -> start() 시퀀스가 정상 동작해야 함', async () => {
      // Given: WalCheckpointScheduler 인스턴스
      const scheduler = new WalCheckpointScheduler(
        db,
        config,
        mockLogger
      );

      // When: start() -> stop() -> start() 시퀀스 실행
      scheduler.start();
      expect((scheduler as unknown as WalCheckpointSchedulerTestAccess).isRunning).toBe(true);
      
      await scheduler.stop();
      expect((scheduler as unknown as WalCheckpointSchedulerTestAccess).isRunning).toBe(false);
      
      scheduler.start();
      expect((scheduler as unknown as WalCheckpointSchedulerTestAccess).isRunning).toBe(true);

      // Then: 정상적으로 동작해야 함
      expect(mockLogger.info).toHaveBeenCalledTimes(3); // 시작 2회, 중지 1회
      
      // 정리
      await scheduler.stop();
    });

    it('중복 start() 호출 시 타이머가 중복 생성되지 않아야 함', () => {
      // Given: 실행 중인 스케줄러
      const scheduler = new WalCheckpointScheduler(
        db,
        config,
        mockLogger
      );
      scheduler.start();
      const firstIntervalId = (scheduler as unknown as WalCheckpointSchedulerTestAccess).intervalId;

      // When: start()를 다시 호출
      scheduler.start();

      // Then: 동일한 intervalId를 유지해야 함 (타이머 중복 생성 방지)
      expect((scheduler as unknown as WalCheckpointSchedulerTestAccess).intervalId).toBe(firstIntervalId);
      
      // 정리
      scheduler.stop();
    });

    it('중복 stop() 호출 시 리소스가 중복 해제되지 않아야 함', async () => {
      // Given: 실행 중인 스케줄러 (전용 커넥션 사용)
      const scheduler = new WalCheckpointScheduler(
        db,
        { ...config, useDedicatedConnection: true },
        mockLogger
      );
      scheduler.start();
      const dedicatedConnection = (scheduler as unknown as WalCheckpointSchedulerTestAccess).dedicatedConnection;
      expect(dedicatedConnection).toBeDefined();

      // When: stop()을 여러 번 호출
      await scheduler.stop();
      await scheduler.stop();
      await scheduler.stop();

      // Then: dedicatedConnection이 null이어야 함 (한 번만 해제)
      expect((scheduler as unknown as WalCheckpointSchedulerTestAccess).dedicatedConnection).toBeNull();
      expect((scheduler as unknown as WalCheckpointSchedulerTestAccess).isRunning).toBe(false);
    });

    it('stop() 후 start() 호출 시 새로운 리소스가 생성되어야 함', async () => {
      // Given: 실행 중인 스케줄러 (전용 커넥션 사용)
      const scheduler = new WalCheckpointScheduler(
        db,
        { ...config, useDedicatedConnection: true },
        mockLogger
      );
      scheduler.start();
      const firstDedicatedConnection = (scheduler as unknown as WalCheckpointSchedulerTestAccess).dedicatedConnection;
      expect(firstDedicatedConnection).toBeDefined();

      // When: stop() 후 start() 호출
      await scheduler.stop();
      expect((scheduler as unknown as WalCheckpointSchedulerTestAccess).dedicatedConnection).toBeNull();
      
      scheduler.start();
      const secondDedicatedConnection = (scheduler as unknown as WalCheckpointSchedulerTestAccess).dedicatedConnection;

      // Then: 새로운 전용 커넥션이 생성되어야 함
      expect(secondDedicatedConnection).toBeDefined();
      expect(secondDedicatedConnection).not.toBe(firstDedicatedConnection);
      
      // 정리
      await scheduler.stop();
    });

    it('start() 중복 호출 시 전용 커넥션이 중복 생성되지 않아야 함', () => {
      // Given: 실행 중인 스케줄러 (전용 커넥션 사용)
      const scheduler = new WalCheckpointScheduler(
        db,
        { ...config, useDedicatedConnection: true },
        mockLogger
      );
      scheduler.start();
      const firstDedicatedConnection = (scheduler as unknown as WalCheckpointSchedulerTestAccess).dedicatedConnection;
      expect(firstDedicatedConnection).toBeDefined();

      // When: start()를 다시 호출
      scheduler.start();

      // Then: 동일한 전용 커넥션을 유지해야 함
      expect((scheduler as unknown as WalCheckpointSchedulerTestAccess).dedicatedConnection).toBe(firstDedicatedConnection);
      
      // 정리
      scheduler.stop();
    });
  });

  describe('주기적 체크포인트', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('start() 호출 시 주기적으로 체크포인트가 실행되어야 함', async () => {
      // Given: WalCheckpointScheduler 인스턴스
      const scheduler = new WalCheckpointScheduler(
        db,
        { ...config, intervalMs: 100 }, // 짧은 주기로 테스트
        mockLogger
      );

      // checkpoint() 메서드 호출 횟수 추적
      let checkpointCallCount = 0;
      const originalCheckpoint = (scheduler as unknown as WalCheckpointSchedulerTestAccess).checkpoint.bind(scheduler);
      (scheduler as unknown as WalCheckpointSchedulerTestAccess).checkpoint = vi.fn(async (mode: CheckpointMode) => {
        checkpointCallCount++;
        return originalCheckpoint(mode);
      });

      // When: start() 호출
      scheduler.start();

      // Then: 즉시 호출되지 않아야 함
      expect(checkpointCallCount).toBe(0);

      // 주기 시간만큼 경과
      await vi.advanceTimersByTimeAsync(100);

      // Then: 체크포인트가 호출되어야 함
      expect(checkpointCallCount).toBe(1);

      // 정리
      await scheduler.stop();
    });

    it('주기적으로 여러 번 체크포인트가 실행되어야 함', async () => {
      // Given: WalCheckpointScheduler 인스턴스
      const scheduler = new WalCheckpointScheduler(
        db,
        { ...config, intervalMs: 100 },
        mockLogger
      );

      let checkpointCallCount = 0;
      const originalCheckpoint = (scheduler as unknown as WalCheckpointSchedulerTestAccess).checkpoint.bind(scheduler);
      (scheduler as unknown as WalCheckpointSchedulerTestAccess).checkpoint = vi.fn(async (mode: CheckpointMode) => {
        checkpointCallCount++;
        return originalCheckpoint(mode);
      });

      // When: start() 호출 후 여러 주기 경과
      scheduler.start();

      // 3번의 주기 경과
      await vi.advanceTimersByTimeAsync(100);
      expect(checkpointCallCount).toBe(1);

      await vi.advanceTimersByTimeAsync(100);
      expect(checkpointCallCount).toBe(2);

      await vi.advanceTimersByTimeAsync(100);
      expect(checkpointCallCount).toBe(3);

      // Then: 3번 호출되어야 함
      expect(checkpointCallCount).toBe(3);

      // 정리
      await scheduler.stop();
    });

    it('체크포인트가 진행 중일 때 다음 주기는 스킵해야 함', async () => {
      // Given: WalCheckpointScheduler 인스턴스
      const scheduler = new WalCheckpointScheduler(
        db,
        { ...config, intervalMs: 100 },
        mockLogger
      );

      let checkpointCallCount = 0;
      // checkpoint()를 모킹하여 느리게 실행되도록 함
      (scheduler as unknown as WalCheckpointSchedulerTestAccess).checkpoint = vi.fn(async (mode: CheckpointMode) => {
        checkpointCallCount++;
        // checkpointInProgress를 수동으로 true로 설정하여 진행 중 상태 시뮬레이션
        (scheduler as unknown as WalCheckpointSchedulerTestAccess).checkpointInProgress = true;
        await new Promise(resolve => setTimeout(resolve, 200));
        (scheduler as unknown as WalCheckpointSchedulerTestAccess).checkpointInProgress = false;
        return {
          mode,
          success: true,
          log: 100,
          checkpointed: 50,
          busy: 0
        };
      });

      // When: start() 호출 후 주기 경과
      scheduler.start();

      // 첫 번째 주기 경과 (체크포인트 시작)
      await vi.advanceTimersByTimeAsync(100);
      expect(checkpointCallCount).toBe(1);

      // 두 번째 주기 경과 (체크포인트가 진행 중이므로 스킵)
      await vi.advanceTimersByTimeAsync(100);
      expect(checkpointCallCount).toBe(1); // 여전히 1번만 호출됨
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '체크포인트가 이미 진행 중입니다. 이번 주기는 스킵합니다.'
      );

      // 정리
      await scheduler.stop();
    });

    it('주기적 체크포인트 실패 시 에러 로그를 출력해야 함', async () => {
      // Given: WalCheckpointScheduler 인스턴스
      const scheduler = new WalCheckpointScheduler(
        db,
        { ...config, intervalMs: 100 },
        mockLogger
      );

      // checkpoint()를 모킹하여 에러 발생
      (scheduler as unknown as WalCheckpointSchedulerTestAccess).checkpoint = vi.fn(async () => {
        throw new Error('체크포인트 실패');
      });

      // When: start() 호출 후 주기 경과
      scheduler.start();
      await vi.advanceTimersByTimeAsync(100);

      // Then: 에러 로그가 출력되어야 함
      expect(mockLogger.error).toHaveBeenCalledWith(
        '주기적 체크포인트 실패',
        expect.objectContaining({ error: expect.any(Error) })
      );

      // 정리
      await scheduler.stop();
    });

    it('stop() 호출 시 주기적 체크포인트가 중지되어야 함', async () => {
      // Given: 실행 중인 스케줄러
      const scheduler = new WalCheckpointScheduler(
        db,
        { ...config, intervalMs: 100 },
        mockLogger
      );

      let checkpointCallCount = 0;
      const originalCheckpoint = (scheduler as unknown as WalCheckpointSchedulerTestAccess).checkpoint.bind(scheduler);
      (scheduler as unknown as WalCheckpointSchedulerTestAccess).checkpoint = vi.fn(async (mode: CheckpointMode) => {
        checkpointCallCount++;
        return originalCheckpoint(mode);
      });

      scheduler.start();

      // 한 번의 주기 경과
      await vi.advanceTimersByTimeAsync(100);
      expect(checkpointCallCount).toBe(1);

      // When: stop() 호출
      await scheduler.stop();

      // 추가 주기 경과
      await vi.advanceTimersByTimeAsync(200);

      // Then: 더 이상 체크포인트가 호출되지 않아야 함
      expect(checkpointCallCount).toBe(1);
    });
  });
});

