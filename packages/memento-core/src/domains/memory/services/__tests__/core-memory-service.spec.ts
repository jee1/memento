import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CoreMemoryService } from '../core-memory-service.js';
import { CoreMemoryCacheService } from '../core-memory-cache-service.js';
import type { CoreMemoryCache } from '../core-memory-service.js';
import type { CoreMemoryRepository, CoreMemoryRecord } from '../../repositories/core-memory-repository.interface.js';

/**
 * Mock CoreMemoryRepository 구현
 */
class MockCoreMemoryRepository implements CoreMemoryRepository {
  private records: Map<string, CoreMemoryRecord> = new Map();

  async create(input: any): Promise<CoreMemoryRecord> {
    const record: CoreMemoryRecord = {
      core_id: input.core_id || `core_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      agent_id: input.agent_id || 'default',
      key: input.key,
      value: input.value,
      always_load: input.always_load || false,
      origin_source: input.origin_source || null,
      version: 1, // create 시 version = 1
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    this.records.set(record.core_id, record);
    return record;
  }

  async findById(core_id: string): Promise<CoreMemoryRecord | null> {
    return this.records.get(core_id) || null;
  }

  async findByKey(agent_id: string, key: string): Promise<CoreMemoryRecord | null> {
    for (const record of this.records.values()) {
      if (record.agent_id === agent_id && record.key === key) {
        return record;
      }
    }
    return null;
  }

  async findByAgentId(agent_id: string): Promise<CoreMemoryRecord[]> {
    return Array.from(this.records.values()).filter(r => r.agent_id === agent_id);
  }

  async findAlwaysLoad(agent_id?: string): Promise<CoreMemoryRecord[]> {
    let records = Array.from(this.records.values()).filter(r => r.always_load);
    if (agent_id) {
      records = records.filter(r => r.agent_id === agent_id);
    }
    return records;
  }

  async update(core_id: string, input: any): Promise<CoreMemoryRecord | null> {
    const record = this.records.get(core_id);
    if (!record) return null;
    // version 증가
    const updated = { 
      ...record, 
      ...input, 
      version: (record.version || 1) + 1,
      updated_at: new Date().toISOString() 
    };
    this.records.set(core_id, updated);
    return updated;
  }

  async updateByKey(agent_id: string, key: string, input: any): Promise<CoreMemoryRecord | null> {
    const record = await this.findByKey(agent_id, key);
    if (!record) return null;
    return this.update(record.core_id, input);
  }

  async delete(core_id: string): Promise<boolean> {
    return this.records.delete(core_id);
  }

  async deleteByKey(agent_id: string, key: string): Promise<boolean> {
    const record = await this.findByKey(agent_id, key);
    if (!record) return false;
    return this.delete(record.core_id);
  }

  async deleteByAgentId(agent_id: string): Promise<number> {
    let count = 0;
    for (const [id, record] of this.records.entries()) {
      if (record.agent_id === agent_id) {
        this.records.delete(id);
        count++;
      }
    }
    return count;
  }

  async findAll(): Promise<CoreMemoryRecord[]> {
    return Array.from(this.records.values());
  }

  async count(agent_id?: string): Promise<number> {
    if (agent_id) {
      return Array.from(this.records.values()).filter(r => r.agent_id === agent_id).length;
    }
    return this.records.size;
  }
}

describe('CoreMemoryService', () => {
  let repository: CoreMemoryRepository;
  let cache: CoreMemoryCacheService;
  let service: CoreMemoryService;

  beforeEach(() => {
    repository = new MockCoreMemoryRepository();
    cache = new CoreMemoryCacheService();
    service = new CoreMemoryService(repository, cache);
  });

  afterEach(() => {
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
    it('should return from cache when available and version matches', async () => {
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

    it('should invalidate cache and reload when DB version is higher than cache version', async () => {
      // Given: 레코드 생성 및 캐시에 저장 (version = 1)
      const created = await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'Initial value',
        always_load: true
      });
      cache.set('agent1:persona', created);
      expect(created.version).toBe(1);

      // When: DB에서 업데이트 (version = 2)
      await repository.update(created.core_id, { value: 'Updated value' });

      // When: findByKey 호출 (버전 비교 발생)
      const found = await service.findByKey('agent1', 'persona');

      // Then: DB의 최신 값이 반환되어야 함
      expect(found).toBeDefined();
      expect(found?.value).toBe('Updated value');
      expect(found?.version).toBe(2);

      // Then: 캐시가 무효화되고 재로드되어야 함
      const cached = cache.get('agent1:persona');
      expect(cached).toBeDefined();
      expect(cached?.value).toBe('Updated value');
      expect(cached?.version).toBe(2);
    });

    it('should remove from cache when DB record is deleted', async () => {
      // Given: 레코드 생성 및 캐시에 저장
      const created = await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'Value',
        always_load: true
      });
      cache.set('agent1:persona', created);

      // When: DB에서 삭제
      await repository.delete(created.core_id);

      // When: findByKey 호출
      const found = await service.findByKey('agent1', 'persona');

      // Then: null 반환 및 캐시에서 제거
      expect(found).toBeNull();
      expect(cache.get('agent1:persona')).toBeUndefined();
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
    it('should update core memory and invalidate cache', async () => {
      const created = await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'Old value',
        always_load: true
      });
      cache.set('agent1:persona', created);

      const updated = await service.update(created.core_id, {
        value: 'New value',
        always_load: true
      });

      expect(updated).toBeDefined();
      expect(updated?.value).toBe('New value');
      expect(updated?.always_load).toBe(true);
      // version이 증가해야 함
      expect(updated?.version).toBe(2);

      // 캐시가 무효화되고 재로드되어야 함
      const cached = cache.get('agent1:persona');
      expect(cached).toBeDefined();
      expect(cached?.value).toBe('New value');
      expect(cached?.version).toBe(2);
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
    it('should update core memory by key and invalidate cache', async () => {
      const created = await service.create({
        agent_id: 'agent1',
        key: 'persona',
        value: 'Old value',
        always_load: true
      });
      cache.set('agent1:persona', created);

      const updated = await service.updateByKey('agent1', 'persona', {
        value: 'New value'
      });

      expect(updated).toBeDefined();
      expect(updated?.value).toBe('New value');
      // version이 증가해야 함
      expect(updated?.version).toBe(2);

      // 캐시가 무효화되고 재로드되어야 함
      const cached = cache.get('agent1:persona');
      expect(cached).toBeDefined();
      expect(cached?.value).toBe('New value');
      expect(cached?.version).toBe(2);
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

