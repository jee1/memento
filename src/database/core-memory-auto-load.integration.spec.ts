/**
 * Core Memory 자동 로드 통합 테스트
 * 
 * 서버 시작 시 always_load=true인 Core Memory 항목들이
 * 자동으로 캐시에 로드되는지 테스트합니다.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { join } from 'path';
import { unlinkSync, existsSync, mkdirSync } from 'fs';
import { CoreMemoryRepository } from '../repositories/core-memory-repository.js';
import { CoreMemoryService } from '../services/core-memory-service.js';
import { CoreMemoryCacheService } from '../services/core-memory-cache-service.js';

/**
 * Core Memory 테이블 생성
 */
function createCoreMemoryTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS core_memory (
      core_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL DEFAULT 'default',
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      always_load BOOLEAN NOT NULL DEFAULT 0,
      origin_source TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agent_id, key)
    );

    CREATE INDEX IF NOT EXISTS idx_core_memory_agent_id ON core_memory(agent_id);
    CREATE INDEX IF NOT EXISTS idx_core_memory_key ON core_memory(key);
    CREATE INDEX IF NOT EXISTS idx_core_memory_always_load ON core_memory(always_load);
  `);
}

describe('Core Memory Auto-Load Integration', () => {
  let db: Database.Database;
  let testDbPath: string;
  let repository: CoreMemoryRepository;
  let cache: CoreMemoryCacheService;
  let service: CoreMemoryService;

  beforeEach(() => {
    // 테스트용 데이터베이스 파일 생성
    const testDir = join(process.cwd(), 'data', 'test');
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    testDbPath = join(testDir, `test-core-memory-${Date.now()}.db`);
    db = new Database(testDbPath);

    // 테이블 생성
    createCoreMemoryTable(db);

    // 서비스 초기화
    repository = new CoreMemoryRepository(db);
    cache = new CoreMemoryCacheService();
    service = new CoreMemoryService(repository, cache);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }

    // 테스트 데이터베이스 파일 삭제
    if (existsSync(testDbPath)) {
      try {
        unlinkSync(testDbPath);
      } catch (error) {
        // 파일이 이미 삭제되었거나 사용 중일 수 있음
      }
    }
  });

  describe('Auto-Load on Startup', () => {
    it('should load always_load=true items into cache on startup', async () => {
      // always_load=true인 항목 생성
      await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'I am helpful',
        always_load: true
      });

      await service.create({
        agent_id: 'agent1',
        key: 'instructions',
        value: 'Follow user instructions',
        always_load: true
      });

      // always_load=false인 항목 생성
      await service.create({
        agent_id: 'agent1',
        key: 'temp_data',
        value: 'Temporary data',
        always_load: false
      });

      // 캐시 초기화 (서버 시작 시뮬레이션)
      cache.clear();

      // 자동 로드 (서버 시작 시 실행되는 로직)
      const alwaysLoadItems = await service.findAlwaysLoad();
      for (const item of alwaysLoadItems) {
        const cacheKey = `${item.agent_id}:${item.key}`;
        cache.set(cacheKey, item);
      }

      // 캐시에 always_load=true인 항목만 로드되었는지 확인
      expect(cache.size()).toBe(2);
      expect(cache.get('agent1:persona')).toBeDefined();
      expect(cache.get('agent1:instructions')).toBeDefined();
      expect(cache.get('agent1:temp_data')).toBeUndefined();
    });

    it('should load items for specific agent_id', async () => {
      // agent1의 항목
      await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'Agent 1 persona',
        always_load: true
      });

      // agent2의 항목
      await service.create({
        agent_id: 'agent2',
        key: 'persona',
        value: 'Agent 2 persona',
        always_load: true
      });

      // 캐시 초기화
      cache.clear();

      // agent1만 로드
      const agent1Items = await service.findAlwaysLoad('agent1');
      for (const item of agent1Items) {
        const cacheKey = `${item.agent_id}:${item.key}`;
        cache.set(cacheKey, item);
      }

      // agent1 항목만 캐시에 있는지 확인
      expect(cache.size()).toBe(1);
      expect(cache.get('agent1:persona')).toBeDefined();
      expect(cache.get('agent2:persona')).toBeUndefined();
    });

    it('should handle empty cache when no always_load items exist', async () => {
      // always_load=false인 항목만 생성
      await service.create({
        agent_id: 'agent1',
        key: 'temp_data',
        value: 'Temporary data',
        always_load: false
      });

      // 캐시 초기화
      cache.clear();

      // 자동 로드
      const alwaysLoadItems = await service.findAlwaysLoad();
      for (const item of alwaysLoadItems) {
        const cacheKey = `${item.agent_id}:${item.key}`;
        cache.set(cacheKey, item);
      }

      // 캐시가 비어있어야 함
      expect(cache.size()).toBe(0);
    });
  });

  describe('Cache Updates', () => {
    it('should update cache when always_load changes to true', async () => {
      // always_load=false로 생성
      const created = await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'I am helpful',
        always_load: false
      });

      // 캐시 초기화 및 자동 로드
      cache.clear();
      const alwaysLoadItems = await service.findAlwaysLoad();
      for (const item of alwaysLoadItems) {
        const cacheKey = `${item.agent_id}:${item.key}`;
        cache.set(cacheKey, item);
      }

      expect(cache.get('agent1:persona')).toBeUndefined();

      // always_load를 true로 변경
      await service.update(created.core_id, {
        always_load: true
      });

      // 캐시에 추가되었는지 확인
      expect(cache.get('agent1:persona')).toBeDefined();
    });

    it('should remove from cache when always_load changes to false', async () => {
      // always_load=true로 생성
      const created = await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'I am helpful',
        always_load: true
      });

      // 캐시 초기화 및 자동 로드
      cache.clear();
      const alwaysLoadItems = await service.findAlwaysLoad();
      for (const item of alwaysLoadItems) {
        const cacheKey = `${item.agent_id}:${item.key}`;
        cache.set(cacheKey, item);
      }

      expect(cache.get('agent1:persona')).toBeDefined();

      // always_load를 false로 변경
      await service.update(created.core_id, {
        always_load: false
      });

      // 캐시에서 제거되었는지 확인
      expect(cache.get('agent1:persona')).toBeUndefined();
    });

    it('should update cache when value changes', async () => {
      // 항목 생성
      const created = await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'I am helpful',
        always_load: true
      });

      // 캐시 초기화 및 자동 로드
      cache.clear();
      const alwaysLoadItems = await service.findAlwaysLoad();
      for (const item of alwaysLoadItems) {
        const cacheKey = `${item.agent_id}:${item.key}`;
        cache.set(cacheKey, item);
      }

      const cachedBefore = cache.get('agent1:persona');
      expect(cachedBefore?.value).toBe('I am helpful');

      // 값 업데이트
      await service.update(created.core_id, {
        value: 'I am very helpful'
      });

      // 캐시가 업데이트되었는지 확인
      const cachedAfter = cache.get('agent1:persona');
      expect(cachedAfter?.value).toBe('I am very helpful');
    });
  });

  describe('Cache Reload', () => {
    it('should reload cache from database', async () => {
      // 항목 생성
      await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'I am helpful',
        always_load: true
      });

      // 캐시 초기화 및 자동 로드
      cache.clear();
      const alwaysLoadItems = await service.findAlwaysLoad();
      for (const item of alwaysLoadItems) {
        const cacheKey = `${item.agent_id}:${item.key}`;
        cache.set(cacheKey, item);
      }

      expect(cache.size()).toBe(1);

      // 캐시 수동 수정 (외부 변경 시뮬레이션)
      const cached = cache.get('agent1:persona');
      if (cached) {
        cache.set('agent1:persona', {
          ...cached,
          value: 'Modified in cache'
        });
      }

      // 캐시 재로드
      await service.reloadCache();

      // 캐시가 DB 값으로 복원되었는지 확인
      const reloaded = cache.get('agent1:persona');
      expect(reloaded?.value).toBe('I am helpful');
    });

    it('should reload cache for specific agent_id', async () => {
      // 여러 agent의 항목 생성
      await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'Agent 1 persona',
        always_load: true
      });

      await service.create({
        agent_id: 'agent2',
        key: 'persona',
        value: 'Agent 2 persona',
        always_load: true
      });

      // 캐시 초기화 및 자동 로드
      cache.clear();
      const allItems = await service.findAlwaysLoad();
      for (const item of allItems) {
        const cacheKey = `${item.agent_id}:${item.key}`;
        cache.set(cacheKey, item);
      }

      expect(cache.size()).toBe(2);

      // agent1만 재로드
      await service.reloadCache('agent1');

      // agent1 항목만 유지되어야 함
      expect(cache.get('agent1:persona')).toBeDefined();
      expect(cache.get('agent2:persona')).toBeUndefined();
    });
  });

  describe('Cache Statistics', () => {
    it('should provide cache statistics', async () => {
      // 여러 항목 생성
      await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'Agent 1 persona',
        always_load: true
      });

      await service.create({
        agent_id: 'agent1',
        key: 'instructions',
        value: 'Agent 1 instructions',
        always_load: true
      });

      await service.create({
        agent_id: 'agent2',
        key: 'persona',
        value: 'Agent 2 persona',
        always_load: true
      });

      // 캐시 초기화 및 자동 로드
      cache.clear();
      const alwaysLoadItems = await service.findAlwaysLoad();
      for (const item of alwaysLoadItems) {
        const cacheKey = `${item.agent_id}:${item.key}`;
        cache.set(cacheKey, item);
      }

      // 통계 확인
      const stats = cache.getStats();
      expect(stats.size).toBe(3);
      expect(stats.agentIds).toContain('agent1');
      expect(stats.agentIds).toContain('agent2');
      expect(stats.keys).toContain('agent1:persona');
      expect(stats.keys).toContain('agent1:instructions');
      expect(stats.keys).toContain('agent2:persona');
    });
  });
});

