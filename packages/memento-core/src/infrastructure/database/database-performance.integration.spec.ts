/**
 * 데이터베이스 성능 테스트
 * 
 * 이 테스트는 다음의 성능을 측정합니다:
 * 1. WAL 체크포인트 오버헤드
 * 2. 락 모니터링 오버헤드
 * 3. 캐시 동기화 성능
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { join } from 'path';
import { tmpdir } from 'os';
import { unlinkSync, existsSync, statSync } from 'fs';
import { randomUUID } from 'crypto';
import { WalCheckpointScheduler, CheckpointMode } from './wal-checkpoint-scheduler.js';
import { DatabaseLockMonitor } from './database-lock-monitor.js';
import { getPerformanceMonitor } from '../../domains/monitoring/services/performance-monitor.js';
import { createCoreMemoryRepository } from './factories/core-memory-repository.factory.js';
import { CoreMemoryService } from '../../domains/memory/services/core-memory-service.js';
import { CoreMemoryCacheService } from '../../domains/memory/services/core-memory-cache-service.js';

/**
 * 기본 스키마 생성
 */
function createBaseSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS core_memory (
      core_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL DEFAULT 'default',
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      always_load BOOLEAN NOT NULL DEFAULT 0,
      origin_source TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agent_id, key)
    );
    CREATE INDEX IF NOT EXISTS idx_core_memory_agent_id ON core_memory(agent_id);
    CREATE INDEX IF NOT EXISTS idx_core_memory_key ON core_memory(key);
    CREATE INDEX IF NOT EXISTS idx_core_memory_version ON core_memory(version);
    UPDATE core_memory SET version = 1 WHERE version = 0;
  `);
}

/**
 * 성능 측정 헬퍼
 */
function measureTime(fn: () => void | Promise<void>): Promise<number> {
  return new Promise(async (resolve) => {
    const start = performance.now();
    await fn();
    const end = performance.now();
    resolve(end - start);
  });
}

describe('데이터베이스 성능 테스트', () => {
  let db: Database.Database;
  let dbPath: string;
  let walCheckpointScheduler: WalCheckpointScheduler;
  let lockMonitor: DatabaseLockMonitor;
  let performanceMonitor: ReturnType<typeof getPerformanceMonitor>;
  let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let cache: CoreMemoryCacheService;
  let service: CoreMemoryService;

  beforeEach(() => {
    // Given: 임시 데이터베이스 파일 생성 (고유 경로로 병렬 충돌 방지)
    dbPath = join(tmpdir(), `test-performance-${Date.now()}-${randomUUID()}.db`);
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    
    createBaseSchema(db);
    
    // 서비스 초기화
    const repository = createCoreMemoryRepository(db);
    cache = new CoreMemoryCacheService();
    service = new CoreMemoryService(repository, cache);
    
    // 모니터링 서비스 초기화
    performanceMonitor = getPerformanceMonitor();
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    
    // WAL 체크포인트 스케줄러 초기화
    walCheckpointScheduler = new WalCheckpointScheduler(
      db,
      {
        intervalMs: 5000, // 5초 (성능 테스트용)
        walSizeWarningThreshold: 16 * 1024 * 1024,
        walSizeDangerThreshold: 24 * 1024 * 1024,
        useDedicatedConnection: true,
        maxRetries: 3,
        retryBackoffMs: 1000
      },
      logger,
      performanceMonitor
    );
    
    // 데이터베이스 락 모니터 초기화
    lockMonitor = new DatabaseLockMonitor(
      db,
      {
        intervalMs: 1000,
        warningThresholdMs: 5000,
        dangerThresholdMs: 30000,
        criticalThresholdMs: 60000
      },
      logger,
      performanceMonitor,
      walCheckpointScheduler
    );
  });

  afterEach(async () => {
    // 정리: 모니터 및 스케줄러 중지
    if (lockMonitor) {
      await lockMonitor.stop();
    }
    if (walCheckpointScheduler) {
      await walCheckpointScheduler.stop();
    }
    
    // 데이터베이스 연결 종료
    if (db) {
      db.close();
    }
    
    // 임시 파일 삭제 (WAL 모드 시 -wal, -shm 포함)
    for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      if (existsSync(p)) {
        try {
          unlinkSync(p);
        } catch {
          // 무시
        }
      }
    }

    // 캐시 클리어
    if (cache) {
      cache.clear();
    }
  });

  describe('WAL 체크포인트 오버헤드', () => {
    it('WAL 체크포인트 실행 시간을 측정해야 함', async () => {
      // Given: 많은 쓰기 작업으로 WAL 파일 생성
      for (let i = 0; i < 1000; i++) {
        db.prepare('INSERT INTO core_memory (core_id, agent_id, key, value, version) VALUES (?, ?, ?, ?, 1)')
          .run(`core_${i}`, 'agent1', `key_${i}`, `value_${i}`);
      }

      // When: WAL 체크포인트 실행 시간 측정
      const checkpointTime = await measureTime(async () => {
        await walCheckpointScheduler.checkpointNow(CheckpointMode.TRUNCATE);
      });

      // Then: 체크포인트가 합리적인 시간 내에 완료되어야 함 (예: 1초 이내)
      expect(checkpointTime).toBeLessThan(1000);
      
      // 로그 출력 (성능 정보)
      console.log(`WAL 체크포인트 실행 시간: ${checkpointTime.toFixed(2)}ms`);
    });

    it('WAL 파일 크기가 체크포인트 후 감소해야 함', async () => {
      // Given: 많은 쓰기 작업으로 WAL 파일 생성
      for (let i = 0; i < 1000; i++) {
        db.prepare('INSERT INTO core_memory (core_id, agent_id, key, value, version) VALUES (?, ?, ?, ?, 1)')
          .run(`core_${i}`, 'agent1', `key_${i}`, `value_${i}`);
      }

      // WAL 파일 경로
      const walPath = `${dbPath}-wal`;
      const shmPath = `${dbPath}-shm`;

      // When: WAL 파일 크기 확인 (존재하는 경우)
      let walSizeBefore = 0;
      if (existsSync(walPath)) {
        walSizeBefore = statSync(walPath).size;
      }

      // When: 체크포인트 실행
      await walCheckpointScheduler.checkpointNow(CheckpointMode.TRUNCATE);

      // Then: WAL 파일 크기가 감소했거나 작아야 함
      let walSizeAfter = 0;
      if (existsSync(walPath)) {
        walSizeAfter = statSync(walPath).size;
      }

      // 체크포인트 후 WAL 파일이 작아지거나 유지되어야 함
      expect(walSizeAfter).toBeLessThanOrEqual(walSizeBefore);
      
      console.log(`WAL 파일 크기: ${walSizeBefore} → ${walSizeAfter} bytes`);
    });
  });

  describe('락 모니터링 오버헤드', () => {
    it('락 모니터링이 성능에 미치는 영향을 측정해야 함', async () => {
      // Given: 락 모니터 시작
      await lockMonitor.start();

      // When: 모니터링 오버헤드 측정 (락 체크 시간)
      const checkTime = await measureTime(async () => {
        const status = await lockMonitor.checkLockStatus();
        expect(status).toBeDefined();
      });

      // Then: 락 체크가 빠르게 완료되어야 함 (예: 100ms 이내)
      expect(checkTime).toBeLessThan(100);
      
      console.log(`락 상태 체크 시간: ${checkTime.toFixed(2)}ms`);

      // 정리
      await lockMonitor.stop();
    });

    it('락 모니터가 주기적으로 실행되는 동안의 오버헤드를 측정해야 함', async () => {
      // Given: 락 모니터 시작
      await lockMonitor.start();

      // When: 모니터가 여러 번 실행되는 동안의 시간 측정
      const totalTime = await measureTime(async () => {
        // 모니터가 3번 실행될 시간 대기 (intervalMs * 3)
        await new Promise(resolve => setTimeout(resolve, 2000));
      });

      // Then: 모니터링이 백그라운드에서 실행되어야 함 (메인 작업에 영향 최소)
      expect(totalTime).toBeLessThan(3000); // 대기 시간 + 오버헤드
      
      console.log(`락 모니터 백그라운드 실행 시간: ${totalTime.toFixed(2)}ms`);

      // 정리
      await lockMonitor.stop();
    });
  });

  describe('캐시 동기화 성능', () => {
    it('캐시 조회 성능을 측정해야 함', async () => {
      // Given: CoreMemory 생성 및 캐시에 저장
      const record = await service.create({
        agent_id: 'agent1',
        key: 'test_key',
        value: 'test_value',
        always_load: true
      });

      // When: 캐시 조회 시간 측정
      const cacheReadTime = await measureTime(() => {
        for (let i = 0; i < 1000; i++) {
          cache.get('agent1:test_key');
        }
      });

      // Then: 캐시 조회가 매우 빠르게 완료되어야 함 (CI/로컬 변동 고려하여 50ms 이내)
      expect(cacheReadTime).toBeLessThan(50);
      
      console.log(`캐시 조회 시간 (1000회): ${cacheReadTime.toFixed(2)}ms`);
      console.log(`평균 캐시 조회 시간: ${(cacheReadTime / 1000).toFixed(4)}ms`);
    });

    it('버전 비교를 포함한 조회 성능을 측정해야 함', async () => {
      // Given: CoreMemory 생성 및 캐시에 저장
      const record = await service.create({
        agent_id: 'agent1',
        key: 'test_key',
        value: 'test_value',
        always_load: true
      });

      // When: 버전 비교를 포함한 조회 시간 측정
      const readWithVersionCheckTime = await measureTime(async () => {
        for (let i = 0; i < 100; i++) {
          await service.findByKey('agent1', 'test_key');
        }
      });

      // Then: 버전 비교를 포함해도 합리적인 시간 내에 완료되어야 함
      // DB 조회가 포함되므로 캐시만 조회하는 것보다 느림
      expect(readWithVersionCheckTime).toBeLessThan(1000); // 100회 조회 시 1초 이내
      
      console.log(`버전 비교 포함 조회 시간 (100회): ${readWithVersionCheckTime.toFixed(2)}ms`);
      console.log(`평균 조회 시간: ${(readWithVersionCheckTime / 100).toFixed(2)}ms`);
    });

    it('캐시 무효화 및 재로드 성능을 측정해야 함', async () => {
      // Given: CoreMemory 생성 및 캐시에 저장
      const record = await service.create({
        agent_id: 'agent1',
        key: 'test_key',
        value: 'test_value',
        always_load: true
      });

      // When: 업데이트 (캐시 무효화 및 재로드 발생)
      const invalidationTime = await measureTime(async () => {
        await service.update(record.core_id, {
          value: 'updated_value'
        });
      });

      // Then: 캐시 무효화 및 재로드가 빠르게 완료되어야 함
      expect(invalidationTime).toBeLessThan(100);
      
      console.log(`캐시 무효화 및 재로드 시간: ${invalidationTime.toFixed(2)}ms`);
    });

    it('대량 데이터에서의 캐시 성능을 측정해야 함', async () => {
      // Given: 많은 CoreMemory 항목 생성
      const records = [];
      for (let i = 0; i < 100; i++) {
        const record = await service.create({
          agent_id: 'agent1',
          key: `key_${i}`,
          value: `value_${i}`,
          always_load: true
        });
        records.push(record);
      }

      // When: 모든 항목 조회 시간 측정
      const bulkReadTime = await measureTime(async () => {
        for (let i = 0; i < 100; i++) {
          await service.findByKey('agent1', `key_${i}`);
        }
      });

      // Then: 대량 조회도 합리적인 시간 내에 완료되어야 함
      expect(bulkReadTime).toBeLessThan(2000); // 100회 조회 시 2초 이내
      
      console.log(`대량 캐시 조회 시간 (100회): ${bulkReadTime.toFixed(2)}ms`);
      console.log(`평균 조회 시간: ${(bulkReadTime / 100).toFixed(2)}ms`);
    });
  });

  describe('통합 성능 테스트', () => {
    it('전체 워크플로우의 성능을 측정해야 함', async () => {
      // Given: 스케줄러와 모니터 시작
      await walCheckpointScheduler.start();
      await lockMonitor.start();

      // When: 전체 워크플로우 실행 시간 측정
      const workflowTime = await measureTime(async () => {
        // 1. CoreMemory 생성
        const record = await service.create({
          agent_id: 'agent1',
          key: 'workflow_test',
          value: 'initial_value',
          always_load: true
        });

        // 2. 조회 (캐시)
        await service.findByKey('agent1', 'workflow_test');

        // 3. 업데이트 (캐시 무효화)
        await service.update(record.core_id, {
          value: 'updated_value'
        });

        // 4. 다시 조회 (재로드)
        await service.findByKey('agent1', 'workflow_test');
      });

      // Then: 전체 워크플로우가 합리적인 시간 내에 완료되어야 함
      expect(workflowTime).toBeLessThan(500);
      
      console.log(`전체 워크플로우 실행 시간: ${workflowTime.toFixed(2)}ms`);

      // 정리
      await lockMonitor.stop();
      await walCheckpointScheduler.stop();
    });
  });
});

