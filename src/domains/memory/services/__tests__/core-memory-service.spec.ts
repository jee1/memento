import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { CoreMemoryService } from '../core-memory-service.js';
import { CoreMemoryRepository } from '../repositories/core-memory-repository.js';
import { CoreMemoryCacheService } from '../core-memory-cache-service.js';
import type { CoreMemoryCache } from '../core-memory-service.js';

/**
 * core_memory 테이블 생성
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
    CREATE INDEX IF NOT EXISTS idx_core_memory_created_at ON core_memory(created_at);
    CREATE INDEX IF NOT EXISTS idx_core_memory_always_load ON core_memory(always_load);

    CREATE TRIGGER IF NOT EXISTS core_memory_update_timestamp 
    AFTER UPDATE ON core_memory
    BEGIN
      UPDATE core_memory 
      SET updated_at = CURRENT_TIMESTAMP 
      WHERE core_id = NEW.core_id;
    END;
  `);
}

describe('CoreMemoryService', () => {
  let db: Database.Database;
  let repository: CoreMemoryRepository;
  let cache: CoreMemoryCacheService;
  let service: CoreMemoryService;

  beforeEach(() => {
    db = new Database(':memory:');
    createCoreMemoryTable(db);
    repository = new CoreMemoryRepository(db);
    cache = new CoreMemoryCacheService();
    service = new CoreMemoryService(repository, cache);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create a core memory record', async () => {
      const input = {
        agent_id: 'agent1',
        key: 'persona',
        value: 'I am helpful',
        always_load: true
      };

      const result = await service.create(input);

      expect(result.key).toBe('persona');
      expect(result.value).toBe('I am helpful');
      expect(result.always_load).toBe(true);
      expect(result.core_id).toMatch(/^core_\d+_[a-z0-9]+$/);
    });

    it('should add to cache when always_load=true', async () => {
      const input = {
        agent_id: 'agent1',
        key: 'persona',
        value: 'I am helpful',
        always_load: true
      };

      const result = await service.create(input);

      const cached = cache.get('agent1:persona');
      expect(cached).toBeDefined();
      expect(cached?.core_id).toBe(result.core_id);
    });

    it('should not add to cache when always_load=false', async () => {
      const input = {
        agent_id: 'agent1',
        key: 'persona',
        value: 'I am helpful',
        always_load: false
      };

      await service.create(input);

      const cached = cache.get('agent1:persona');
      expect(cached).toBeUndefined();
    });

    it('should throw error when duplicate key exists', async () => {
      await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'Value 1'
      });

      await expect(
        service.create({
          agent_id: 'agent1',
          key: 'persona',
          value: 'Value 2'
        })
      ).rejects.toThrow("Core memory with key 'persona' already exists");
    });

    it('should use default values when optional fields are not provided', async () => {
      const result = await service.create({
        key: 'persona',
        value: 'I am helpful'
      });

      expect(result.agent_id).toBe('default');
      expect(result.always_load).toBe(false);
    });
  });

  describe('findByKey', () => {
    it('should return from cache when available', async () => {
      const created = await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'I am helpful',
        always_load: true
      });

      // 캐시에 직접 추가하여 테스트
      cache.set('agent1:persona', created);

      const found = await service.findByKey('agent1', 'persona');

      expect(found).toBeDefined();
      expect(found?.core_id).toBe(created.core_id);
    });

    it('should fetch from DB and add to cache when always_load=true', async () => {
      const created = await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'I am helpful',
        always_load: true
      });

      // 캐시 클리어
      cache.clear();

      const found = await service.findByKey('agent1', 'persona');

      expect(found).toBeDefined();
      expect(found?.core_id).toBe(created.core_id);

      // 캐시에 추가되었는지 확인
      const cached = cache.get('agent1:persona');
      expect(cached).toBeDefined();
    });

    it('should not add to cache when always_load=false', async () => {
      const created = await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'I am helpful',
        always_load: false
      });

      cache.clear();

      const found = await service.findByKey('agent1', 'persona');

      expect(found).toBeDefined();
      expect(found?.core_id).toBe(created.core_id);

      // 캐시에 추가되지 않았는지 확인
      const cached = cache.get('agent1:persona');
      expect(cached).toBeUndefined();
    });

    it('should return null when key does not exist', async () => {
      const found = await service.findByKey('agent1', 'nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('findAlwaysLoad', () => {
    it('should return from cache when available', async () => {
      await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'Value 1',
        always_load: true
      });

      await service.create({
        agent_id: 'agent1',
        key: 'instructions',
        value: 'Value 2',
        always_load: true
      });

      await service.create({
        agent_id: 'agent1',
        key: 'rules',
        value: 'Value 3',
        always_load: false
      });

      const results = await service.findAlwaysLoad('agent1');

      expect(results).toHaveLength(2);
      expect(results.every(r => r.always_load)).toBe(true);
    });

    it('should fetch from DB when cache is empty', async () => {
      await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'Value 1',
        always_load: true
      });

      cache.clear();

      const results = await service.findAlwaysLoad('agent1');

      expect(results).toHaveLength(1);
      expect(results[0].key).toBe('persona');
    });
  });

  describe('update', () => {
    it('should update core memory', async () => {
      const created = await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'Old value',
        always_load: false
      });

      const updated = await service.update(created.core_id, {
        value: 'New value',
        always_load: true
      });

      expect(updated).toBeDefined();
      expect(updated?.value).toBe('New value');
      expect(updated?.always_load).toBe(true);
    });

    it('should add to cache when always_load changes to true', async () => {
      const created = await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'Value',
        always_load: false
      });

      await service.update(created.core_id, {
        always_load: true
      });

      const cached = cache.get('agent1:persona');
      expect(cached).toBeDefined();
      expect(cached?.always_load).toBe(true);
    });

    it('should remove from cache when always_load changes to false', async () => {
      const created = await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'Value',
        always_load: true
      });

      await service.update(created.core_id, {
        always_load: false
      });

      const cached = cache.get('agent1:persona');
      expect(cached).toBeUndefined();
    });

    it('should return null when id does not exist', async () => {
      const updated = await service.update('nonexistent', {
        value: 'New value'
      });
      expect(updated).toBeNull();
    });
  });

  describe('updateByKey', () => {
    it('should update core memory by key', async () => {
      await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'Old value'
      });

      const updated = await service.updateByKey('agent1', 'persona', {
        value: 'New value'
      });

      expect(updated).toBeDefined();
      expect(updated?.value).toBe('New value');
    });
  });

  describe('delete', () => {
    it('should delete core memory and remove from cache', async () => {
      const created = await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'Value',
        always_load: true
      });

      const deleted = await service.delete(created.core_id);
      expect(deleted).toBe(true);

      const found = await service.findById(created.core_id);
      expect(found).toBeNull();

      const cached = cache.get('agent1:persona');
      expect(cached).toBeUndefined();
    });

    it('should return false when id does not exist', async () => {
      const deleted = await service.delete('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('deleteByKey', () => {
    it('should delete core memory by key and remove from cache', async () => {
      await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'Value',
        always_load: true
      });

      const deleted = await service.deleteByKey('agent1', 'persona');
      expect(deleted).toBe(true);

      const found = await service.findByKey('agent1', 'persona');
      expect(found).toBeNull();

      const cached = cache.get('agent1:persona');
      expect(cached).toBeUndefined();
    });
  });

  describe('deleteByAgentId', () => {
    it('should delete all core memories for agent and remove from cache', async () => {
      await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'Value 1',
        always_load: true
      });

      await service.create({
        agent_id: 'agent1',
        key: 'instructions',
        value: 'Value 2',
        always_load: true
      });

      await service.create({
        agent_id: 'agent2',
        key: 'persona',
        value: 'Value 3',
        always_load: true
      });

      const deletedCount = await service.deleteByAgentId('agent1');
      expect(deletedCount).toBe(2);

      const agent1Memories = await service.findByAgentId('agent1');
      expect(agent1Memories).toHaveLength(0);

      const agent2Memories = await service.findByAgentId('agent2');
      expect(agent2Memories).toHaveLength(1);

      // 캐시에서도 제거되었는지 확인
      expect(cache.get('agent1:persona')).toBeUndefined();
      expect(cache.get('agent1:instructions')).toBeUndefined();
      expect(cache.get('agent2:persona')).toBeDefined();
    });
  });

  describe('reloadCache', () => {
    it('should reload always_load=true items into cache', async () => {
      await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'Value 1',
        always_load: true
      });

      await service.create({
        agent_id: 'agent1',
        key: 'instructions',
        value: 'Value 2',
        always_load: false
      });

      cache.clear();

      await service.reloadCache('agent1');

      const cached = cache.getAll();
      expect(cached).toHaveLength(1);
      expect(cached[0].key).toBe('persona');
    });

    it('should reload all always_load=true items when agent_id is not specified', async () => {
      await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'Value 1',
        always_load: true
      });

      await service.create({
        agent_id: 'agent2',
        key: 'persona',
        value: 'Value 2',
        always_load: true
      });

      cache.clear();

      await service.reloadCache();

      const cached = cache.getAll();
      expect(cached).toHaveLength(2);
    });
  });

  describe('service without cache', () => {
    it('should work without cache', async () => {
      const serviceWithoutCache = new CoreMemoryService(repository);

      const created = await serviceWithoutCache.create({
        key: 'persona',
        value: 'I am helpful'
      });

      expect(created).toBeDefined();

      const found = await serviceWithoutCache.findByKey('default', 'persona');
      expect(found).toBeDefined();
    });
  });
});

