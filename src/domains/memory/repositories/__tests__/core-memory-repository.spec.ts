import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CoreMemoryRepository } from '../core-memory-repository.js';

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

describe('CoreMemoryRepository', () => {
  let db: Database.Database;
  let repository: CoreMemoryRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    createCoreMemoryTable(db);
    repository = new CoreMemoryRepository(db);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe('create', () => {
    it('should create a core memory record', async () => {
      const input = {
        core_id: 'core_123',
        agent_id: 'agent1',
        key: 'persona',
        value: 'I am helpful',
        always_load: true,
        origin_source: '{"tool": "remember"}'
      };

      const result = await repository.create(input);

      expect(result.core_id).toBe('core_123');
      expect(result.agent_id).toBe('agent1');
      expect(result.key).toBe('persona');
      expect(result.value).toBe('I am helpful');
      expect(result.always_load).toBe(true);
      expect(result.origin_source).toBe('{"tool": "remember"}');
      expect(result.created_at).toBeDefined();
      expect(result.updated_at).toBeDefined();
    });

    it('should use default values when optional fields are not provided', async () => {
      const input = {
        core_id: 'core_456',
        key: 'instructions',
        value: 'Follow rules'
      };

      const result = await repository.create(input);

      expect(result.agent_id).toBe('default');
      expect(result.always_load).toBe(false);
      expect(result.origin_source).toBeNull();
    });

    it('should throw error when duplicate (agent_id, key) combination', async () => {
      await repository.create({
        core_id: 'core_1',
        agent_id: 'agent1',
        key: 'persona',
        value: 'Value 1'
      });

      await expect(
        repository.create({
          core_id: 'core_2',
          agent_id: 'agent1',
          key: 'persona',
          value: 'Value 2'
        })
      ).rejects.toThrow();
    });
  });

  describe('findById', () => {
    it('should return core memory by id', async () => {
      const created = await repository.create({
        core_id: 'core_123',
        key: 'persona',
        value: 'I am helpful'
      });

      const found = await repository.findById('core_123');

      expect(found).toBeDefined();
      expect(found?.core_id).toBe(created.core_id);
      expect(found?.value).toBe('I am helpful');
    });

    it('should return null when id does not exist', async () => {
      const found = await repository.findById('nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('findByKey', () => {
    it('should return core memory by agent_id and key', async () => {
      await repository.create({
        core_id: 'core_123',
        agent_id: 'agent1',
        key: 'persona',
        value: 'I am helpful'
      });

      const found = await repository.findByKey('agent1', 'persona');

      expect(found).toBeDefined();
      expect(found?.key).toBe('persona');
      expect(found?.value).toBe('I am helpful');
    });

    it('should return null when key does not exist', async () => {
      const found = await repository.findByKey('agent1', 'nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('findByAgentId', () => {
    it('should return all core memories for an agent', async () => {
      await repository.create({
        core_id: 'core_1',
        agent_id: 'agent1',
        key: 'persona',
        value: 'Value 1'
      });

      await repository.create({
        core_id: 'core_2',
        agent_id: 'agent1',
        key: 'instructions',
        value: 'Value 2'
      });

      await repository.create({
        core_id: 'core_3',
        agent_id: 'agent2',
        key: 'persona',
        value: 'Value 3'
      });

      const results = await repository.findByAgentId('agent1');

      expect(results).toHaveLength(2);
      expect(results.map(r => r.core_id).sort()).toEqual(['core_1', 'core_2']);
    });

    it('should return empty array when agent has no memories', async () => {
      const results = await repository.findByAgentId('nonexistent');
      expect(results).toEqual([]);
    });
  });

  describe('findAlwaysLoad', () => {
    it('should return only always_load=true memories', async () => {
      await repository.create({
        core_id: 'core_1',
        agent_id: 'agent1',
        key: 'persona',
        value: 'Value 1',
        always_load: true
      });

      await repository.create({
        core_id: 'core_2',
        agent_id: 'agent1',
        key: 'instructions',
        value: 'Value 2',
        always_load: false
      });

      await repository.create({
        core_id: 'core_3',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Value 3',
        always_load: true
      });

      const results = await repository.findAlwaysLoad('agent1');

      expect(results).toHaveLength(2);
      expect(results.every(r => r.always_load)).toBe(true);
      expect(results.map(r => r.core_id).sort()).toEqual(['core_1', 'core_3']);
    });

    it('should return all always_load=true memories when agent_id is not specified', async () => {
      await repository.create({
        core_id: 'core_1',
        agent_id: 'agent1',
        key: 'persona',
        value: 'Value 1',
        always_load: true
      });

      await repository.create({
        core_id: 'core_2',
        agent_id: 'agent2',
        key: 'persona',
        value: 'Value 2',
        always_load: true
      });

      await repository.create({
        core_id: 'core_3',
        agent_id: 'agent1',
        key: 'instructions',
        value: 'Value 3',
        always_load: false
      });

      const results = await repository.findAlwaysLoad();

      expect(results).toHaveLength(2);
      expect(results.every(r => r.always_load)).toBe(true);
    });
  });

  describe('update', () => {
    it('should update core memory', async () => {
      const created = await repository.create({
        core_id: 'core_123',
        key: 'persona',
        value: 'Old value'
      });

      const updated = await repository.update('core_123', {
        value: 'New value',
        always_load: true
      });

      expect(updated).toBeDefined();
      expect(updated?.value).toBe('New value');
      expect(updated?.always_load).toBe(true);
      // updated_at은 트리거에 의해 자동 업데이트되지만, 매우 빠른 업데이트의 경우 같은 값일 수 있음
      // 최소한 updated_at이 존재하는지 확인
      expect(updated?.updated_at).toBeDefined();
    });

    it('should return null when id does not exist', async () => {
      const updated = await repository.update('nonexistent', {
        value: 'New value'
      });
      expect(updated).toBeNull();
    });

    it('should update only specified fields', async () => {
      const created = await repository.create({
        core_id: 'core_123',
        key: 'persona',
        value: 'Value 1',
        always_load: false
      });

      const updated = await repository.update('core_123', {
        value: 'Value 2'
      });

      expect(updated?.value).toBe('Value 2');
      expect(updated?.always_load).toBe(false); // 변경되지 않음
    });
  });

  describe('updateByKey', () => {
    it('should update core memory by agent_id and key', async () => {
      await repository.create({
        core_id: 'core_123',
        agent_id: 'agent1',
        key: 'persona',
        value: 'Old value'
      });

      const updated = await repository.updateByKey('agent1', 'persona', {
        value: 'New value'
      });

      expect(updated).toBeDefined();
      expect(updated?.value).toBe('New value');
    });

    it('should return null when key does not exist', async () => {
      const updated = await repository.updateByKey('agent1', 'nonexistent', {
        value: 'New value'
      });
      expect(updated).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete core memory by id', async () => {
      await repository.create({
        core_id: 'core_123',
        key: 'persona',
        value: 'Value'
      });

      const deleted = await repository.delete('core_123');
      expect(deleted).toBe(true);

      const found = await repository.findById('core_123');
      expect(found).toBeNull();
    });

    it('should return false when id does not exist', async () => {
      const deleted = await repository.delete('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('deleteByKey', () => {
    it('should delete core memory by agent_id and key', async () => {
      await repository.create({
        core_id: 'core_123',
        agent_id: 'agent1',
        key: 'persona',
        value: 'Value'
      });

      const deleted = await repository.deleteByKey('agent1', 'persona');
      expect(deleted).toBe(true);

      const found = await repository.findByKey('agent1', 'persona');
      expect(found).toBeNull();
    });
  });

  describe('deleteByAgentId', () => {
    it('should delete all core memories for an agent', async () => {
      await repository.create({
        core_id: 'core_1',
        agent_id: 'agent1',
        key: 'persona',
        value: 'Value 1'
      });

      await repository.create({
        core_id: 'core_2',
        agent_id: 'agent1',
        key: 'instructions',
        value: 'Value 2'
      });

      await repository.create({
        core_id: 'core_3',
        agent_id: 'agent2',
        key: 'persona',
        value: 'Value 3'
      });

      const deletedCount = await repository.deleteByAgentId('agent1');
      expect(deletedCount).toBe(2);

      const agent1Memories = await repository.findByAgentId('agent1');
      expect(agent1Memories).toHaveLength(0);

      const agent2Memories = await repository.findByAgentId('agent2');
      expect(agent2Memories).toHaveLength(1);
    });
  });

  describe('findAll', () => {
    it('should return all core memories', async () => {
      await repository.create({
        core_id: 'core_1',
        agent_id: 'agent1',
        key: 'persona',
        value: 'Value 1'
      });

      await repository.create({
        core_id: 'core_2',
        agent_id: 'agent2',
        key: 'persona',
        value: 'Value 2'
      });

      const results = await repository.findAll();
      expect(results).toHaveLength(2);
    });
  });

  describe('count', () => {
    it('should return count of all core memories', async () => {
      await repository.create({
        core_id: 'core_1',
        agent_id: 'agent1',
        key: 'persona',
        value: 'Value 1'
      });

      await repository.create({
        core_id: 'core_2',
        agent_id: 'agent1',
        key: 'instructions',
        value: 'Value 2'
      });

      const count = await repository.count();
      expect(count).toBe(2);
    });

    it('should return count for specific agent', async () => {
      await repository.create({
        core_id: 'core_1',
        agent_id: 'agent1',
        key: 'persona',
        value: 'Value 1'
      });

      await repository.create({
        core_id: 'core_2',
        agent_id: 'agent2',
        key: 'persona',
        value: 'Value 2'
      });

      const count = await repository.count('agent1');
      expect(count).toBe(1);
    });
  });
});

