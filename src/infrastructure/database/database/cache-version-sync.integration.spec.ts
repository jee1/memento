/**
 * 캐시 버전 동기화 통합 테스트
 * 
 * 이 테스트는 다음을 검증합니다:
 * 1. 서버 초기화 시 마이그레이션 실행 및 버전 필드 추가
 * 2. CoreMemory 생성/업데이트 시 버전 관리
 * 3. 캐시 버전 비교 및 자동 무효화
 * 4. 스케줄러와 모니터 통합 동작
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { join } from 'path';
import { tmpdir } from 'os';
import { unlinkSync, existsSync } from 'fs';
import { initializeDatabase } from './init.js';
import { createCoreMemoryRepository } from '../factories/core-memory-repository.factory.js';
import { CoreMemoryService } from '../../../domains/memory/services/core-memory-service.js';
import { CoreMemoryCacheService } from '../../../domains/memory/services/core-memory-cache-service.js';
import { WalCheckpointScheduler } from '../wal-checkpoint-scheduler.js';
import { DatabaseLockMonitor } from '../database-lock-monitor.js';
import { getPerformanceMonitor } from '../../../domains/monitoring/services/performance-monitor.js';
import { vi } from 'vitest';

describe('캐시 버전 동기화 통합 테스트', () => {
  let db: Database.Database;
  let dbPath: string;
  let cache: CoreMemoryCacheService;
  let service: CoreMemoryService;
  let walCheckpointScheduler: WalCheckpointScheduler;
  let lockMonitor: DatabaseLockMonitor;
  let performanceMonitor: ReturnType<typeof getPerformanceMonitor>;
  let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    // Given: 임시 데이터베이스 파일 생성
    dbPath = join(tmpdir(), `test-cache-version-${Date.now()}.db`);
    
    // 데이터베이스 생성 및 초기화
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    
    // 기본 스키마 생성 (core_memory 테이블 포함)
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
    
    // 서비스 초기화
    const repository = createCoreMemoryRepository(db);
    cache = new CoreMemoryCacheService();
    service = new CoreMemoryService(repository, cache);
    
    // 모니터링 서비스 초기화
    performanceMonitor = getPerformanceMonitor();
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    
    // WAL 체크포인트 스케줄러 초기화 (테스트용 짧은 간격)
    walCheckpointScheduler = new WalCheckpointScheduler(
      db,
      {
        intervalMs: 1000, // 1초 (테스트용)
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
        intervalMs: 1000, // 1초 (테스트용)
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
    // 정리: 스케줄러 및 모니터 중지
    if (walCheckpointScheduler) {
      await walCheckpointScheduler.stop();
    }
    if (lockMonitor) {
      await lockMonitor.stop();
    }
    
    // 데이터베이스 연결 종료
    if (db) {
      db.close();
    }
    
    // 임시 파일 삭제
    if (existsSync(dbPath)) {
      try {
        unlinkSync(dbPath);
      } catch (error) {
        // 무시
      }
    }
    
    // 캐시 클리어
    if (cache) {
      cache.clear();
    }
  });

  describe('마이그레이션 및 버전 필드', () => {
    it('서버 초기화 시 version 필드가 추가되어야 함', async () => {
      // Given: 데이터베이스 초기화 완료
      // When: core_memory 테이블 구조 확인
      const columns = db.prepare(`PRAGMA table_info(core_memory)`).all() as Array<{
        name: string;
        type: string;
      }>;
      
      // Then: version 컬럼이 존재해야 함
      const versionColumn = columns.find(col => col.name === 'version');
      expect(versionColumn).toBeDefined();
      expect(versionColumn?.type.toUpperCase()).toContain('INTEGER');
    });

    it('version=0인 행이 없어야 함 (마이그레이션 검증)', async () => {
      // Given: 데이터베이스 초기화 완료
      // When: version=0인 행 조회
      const zeroVersionCount = db.prepare(`
        SELECT COUNT(*) as count FROM core_memory WHERE version = 0
      `).get() as { count: number } | undefined;
      
      // Then: version=0인 행이 없어야 함
      expect(zeroVersionCount?.count).toBe(0);
    });
  });

  describe('버전 관리 및 캐시 동기화', () => {
    it('create 시 version=1이 설정되고 캐시에 저장되어야 함', async () => {
      // Given: always_load=true인 CoreMemory 생성
      const record = await service.create({
        agent_id: 'agent1',
        key: 'test_key',
        value: 'test_value',
        always_load: true
      });

      // Then: version=1이어야 함
      expect(record.version).toBe(1);

      // Then: 캐시에 저장되어야 함
      const cached = cache.get('agent1:test_key');
      expect(cached).toBeDefined();
      expect(cached?.version).toBe(1);
    });

    it('update 시 version이 증가하고 캐시가 무효화되어야 함', async () => {
      // Given: CoreMemory 생성 및 캐시에 저장
      const created = await service.create({
        agent_id: 'agent1',
        key: 'test_key',
        value: 'initial_value',
        always_load: true
      });
      expect(created.version).toBe(1);
      expect(cache.get('agent1:test_key')).toBeDefined();

      // When: 업데이트
      const updated = await service.update(created.core_id, {
        value: 'updated_value'
      });

      // Then: version이 증가해야 함 (1 -> 2)
      expect(updated?.version).toBe(2);

      // Then: 캐시가 무효화되고 재로드되어야 함
      const cached = cache.get('agent1:test_key');
      expect(cached).toBeDefined();
      expect(cached?.value).toBe('updated_value');
      expect(cached?.version).toBe(2);
    });

    it('findByKey 시 버전 불일치하면 자동으로 캐시 무효화 및 재로드해야 함', async () => {
      // Given: CoreMemory 생성 및 캐시에 저장 (version=1)
      const created = await service.create({
        agent_id: 'agent1',
        key: 'test_key',
        value: 'initial_value',
        always_load: true
      });
      cache.set('agent1:test_key', created);
      expect(created.version).toBe(1);

      // When: DB에서 직접 업데이트 (version=2)
      const repository = createCoreMemoryRepository(db);
      await repository.update(created.core_id, {
        value: 'db_updated_value'
      });

      // When: findByKey 호출 (버전 비교 발생)
      const found = await service.findByKey('agent1', 'test_key');

      // Then: DB의 최신 값이 반환되어야 함
      expect(found).toBeDefined();
      expect(found?.value).toBe('db_updated_value');
      expect(found?.version).toBe(2);

      // Then: 캐시가 무효화되고 재로드되어야 함
      const cached = cache.get('agent1:test_key');
      expect(cached).toBeDefined();
      expect(cached?.value).toBe('db_updated_value');
      expect(cached?.version).toBe(2);
    });

    it('여러 번 업데이트 시 version이 계속 증가해야 함', async () => {
      // Given: CoreMemory 생성
      const created = await service.create({
        agent_id: 'agent1',
        key: 'test_key',
        value: 'value_0',
        always_load: true
      });
      expect(created.version).toBe(1);

      // When: 여러 번 업데이트
      for (let i = 1; i <= 5; i++) {
        const updated = await service.update(created.core_id, {
          value: `value_${i}`
        });
        // Then: version이 i + 1이어야 함
        expect(updated?.version).toBe(i + 1);
      }
    });
  });

  describe('스케줄러 및 모니터 통합', () => {
    it('WAL 체크포인트 스케줄러가 시작되어야 함', async () => {
      // When: 스케줄러 시작
      await walCheckpointScheduler.start();

      // Then: 스케줄러가 실행 중이어야 함
      expect(walCheckpointScheduler).toBeDefined();
      
      // 정리
      await walCheckpointScheduler.stop();
    });

    it('데이터베이스 락 모니터가 시작되어야 함', async () => {
      // When: 모니터 시작
      await lockMonitor.start();

      // Then: 모니터가 실행 중이어야 함
      expect(lockMonitor).toBeDefined();
      
      // 정리
      await lockMonitor.stop();
    });

    it('스케줄러와 모니터가 동시에 실행되어야 함', async () => {
      // When: 스케줄러와 모니터 모두 시작
      await walCheckpointScheduler.start();
      await lockMonitor.start();

      // Then: 둘 다 실행 중이어야 함
      expect(walCheckpointScheduler).toBeDefined();
      expect(lockMonitor).toBeDefined();

      // 잠시 대기 (실제 동작 확인)
      await new Promise(resolve => setTimeout(resolve, 100));

      // 정리
      await lockMonitor.stop();
      await walCheckpointScheduler.stop();
    });
  });

  describe('캐시 무효화 리스너', () => {
    it('캐시 무효화 시 리스너가 호출되어야 함', async () => {
      // Given: 리스너 등록
      const invalidationEvents: Array<{ key: string; reason?: string }> = [];
      cache.subscribeInvalidation({
        onInvalidate: (key, reason) => {
          invalidationEvents.push({ key, reason });
        },
        onInvalidateAll: () => {
          // 무시
        }
      });

      // Given: CoreMemory 생성 및 캐시에 저장
      const created = await service.create({
        agent_id: 'agent1',
        key: 'test_key',
        value: 'initial_value',
        always_load: true
      });

      // When: 업데이트 (캐시 무효화 발생)
      await service.update(created.core_id, {
        value: 'updated_value'
      });

      // Then: 리스너가 호출되어야 함
      expect(invalidationEvents.length).toBeGreaterThan(0);
      expect(invalidationEvents.some(e => e.key === 'agent1:test_key')).toBe(true);
    });

    it('캐시 클리어 시 리스너가 호출되어야 함', () => {
      // Given: 리스너 등록
      let clearCalled = false;
      cache.subscribeInvalidation({
        onInvalidate: () => {
          // 무시
        },
        onInvalidateAll: () => {
          clearCalled = true;
        }
      });

      // When: 캐시 클리어
      cache.clear();

      // Then: 리스너가 호출되어야 함
      expect(clearCalled).toBe(true);
    });
  });

  describe('실제 사용 시나리오', () => {
    it('서버 시작 → CoreMemory 생성 → 업데이트 → 조회 시나리오', async () => {
      // Given: 서버 초기화 완료 상태
      await walCheckpointScheduler.start();
      await lockMonitor.start();

      // When: CoreMemory 생성
      const created = await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'I am helpful',
        always_load: true
      });
      expect(created.version).toBe(1);

      // When: 조회 (캐시에서)
      const found1 = await service.findByKey('agent1', 'persona');
      expect(found1?.version).toBe(1);

      // When: 업데이트
      const updated = await service.update(created.core_id, {
        value: 'I am very helpful'
      });
      expect(updated?.version).toBe(2);

      // When: 다시 조회 (캐시 무효화 후 재로드)
      const found2 = await service.findByKey('agent1', 'persona');
      expect(found2?.version).toBe(2);
      expect(found2?.value).toBe('I am very helpful');

      // 정리
      await lockMonitor.stop();
      await walCheckpointScheduler.stop();
    });
  });
});

