import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { KnowledgeVaultRepository } from './knowledge-vault-repository.js';

/**
 * knowledge_vault 테이블 생성
 */
function createKnowledgeVaultTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_vault (
      vault_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL DEFAULT 'default',
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      immutable BOOLEAN NOT NULL DEFAULT 1,
      version INTEGER NOT NULL DEFAULT 1,
      previous_version_id TEXT,
      admin_override BOOLEAN NOT NULL DEFAULT 0,
      deleted_at TIMESTAMP,
      origin_source TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agent_id, key, version)
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_vault_agent_id ON knowledge_vault(agent_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_vault_key ON knowledge_vault(key);
    CREATE INDEX IF NOT EXISTS idx_knowledge_vault_version ON knowledge_vault(version);
    CREATE INDEX IF NOT EXISTS idx_knowledge_vault_deleted_at ON knowledge_vault(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_knowledge_vault_agent_key ON knowledge_vault(agent_id, key);

    CREATE TRIGGER IF NOT EXISTS knowledge_vault_update_timestamp 
    AFTER UPDATE ON knowledge_vault
    BEGIN
      UPDATE knowledge_vault 
      SET updated_at = CURRENT_TIMESTAMP 
      WHERE vault_id = NEW.vault_id;
    END;
  `);
}

describe('KnowledgeVaultRepository', () => {
  let db: Database.Database;
  let repository: KnowledgeVaultRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    createKnowledgeVaultTable(db);
    repository = new KnowledgeVaultRepository(db);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe('create', () => {
    it('should create a knowledge vault record', async () => {
      const input = {
        vault_id: 'vault_123',
        agent_id: 'agent1',
        key: 'user_rules',
        value: 'Never share personal info',
        immutable: true,
        version: 1,
        origin_source: '{"tool": "remember"}'
      };

      const result = await repository.create(input);

      expect(result.vault_id).toBe('vault_123');
      expect(result.agent_id).toBe('agent1');
      expect(result.key).toBe('user_rules');
      expect(result.value).toBe('Never share personal info');
      expect(result.immutable).toBe(true);
      expect(result.version).toBe(1);
      expect(result.origin_source).toBe('{"tool": "remember"}');
      expect(result.created_at).toBeDefined();
      expect(result.updated_at).toBeDefined();
    });

    it('should use default values when optional fields are not provided', async () => {
      const input = {
        vault_id: 'vault_456',
        key: 'rules',
        value: 'Follow rules'
      };

      const result = await repository.create(input);

      expect(result.agent_id).toBe('default');
      expect(result.immutable).toBe(true);
      expect(result.version).toBe(1);
      expect(result.admin_override).toBe(false);
      expect(result.deleted_at).toBeNull();
      expect(result.previous_version_id).toBeNull();
    });

    it('should allow multiple versions with same (agent_id, key)', async () => {
      await repository.create({
        vault_id: 'vault_1',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Version 1',
        version: 1
      });

      await repository.create({
        vault_id: 'vault_2',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Version 2',
        version: 2,
        previous_version_id: 'vault_1'
      });

      const versions = await repository.findAllVersionsByKey('agent1', 'rules');
      expect(versions).toHaveLength(2);
      expect(versions.map(v => v.version).sort()).toEqual([1, 2]);
    });
  });

  describe('findById', () => {
    it('should return knowledge vault by id', async () => {
      const created = await repository.create({
        vault_id: 'vault_123',
        key: 'rules',
        value: 'Follow rules'
      });

      const found = await repository.findById('vault_123');

      expect(found).toBeDefined();
      expect(found?.vault_id).toBe(created.vault_id);
      expect(found?.value).toBe('Follow rules');
    });

    it('should return null when id does not exist', async () => {
      const found = await repository.findById('nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('findActiveByKey', () => {
    it('should return active version (deleted_at IS NULL) by agent_id and key', async () => {
      await repository.create({
        vault_id: 'vault_1',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Version 1',
        version: 1
      });

      await repository.create({
        vault_id: 'vault_2',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Version 2',
        version: 2
      });

      // Version 1을 soft delete (immutable이므로 admin_override 필요)
      // 테스트를 위해 먼저 admin_override를 true로 설정
      await repository.update('vault_1', { admin_override: true });
      // immutable이므로 admin_override 필요
      await repository.update('vault_1', { admin_override: true });
      await repository.delete('vault_1');

      const found = await repository.findActiveByKey('agent1', 'rules');

      expect(found).toBeDefined();
      expect(found?.version).toBe(2); // 활성 버전만 반환
      expect(found?.value).toBe('Version 2');
    });

    it('should return null when no active version exists', async () => {
      await repository.create({
        vault_id: 'vault_1',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Version 1',
        version: 1
      });

      // immutable이므로 admin_override 필요
      await repository.update('vault_1', { admin_override: true });
      await repository.delete('vault_1');

      const found = await repository.findActiveByKey('agent1', 'rules');
      expect(found).toBeNull();
    });
  });

  describe('findByKeyAndVersion', () => {
    it('should return specific version', async () => {
      await repository.create({
        vault_id: 'vault_1',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Version 1',
        version: 1
      });

      await repository.create({
        vault_id: 'vault_2',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Version 2',
        version: 2
      });

      const found = await repository.findByKeyAndVersion('agent1', 'rules', 1);

      expect(found).toBeDefined();
      expect(found?.version).toBe(1);
      expect(found?.value).toBe('Version 1');
    });
  });

  describe('findAllVersionsByKey', () => {
    it('should return all versions including deleted', async () => {
      await repository.create({
        vault_id: 'vault_1',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Version 1',
        version: 1
      });

      await repository.create({
        vault_id: 'vault_2',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Version 2',
        version: 2
      });

      // immutable이므로 admin_override 필요
      await repository.update('vault_1', { admin_override: true });
      await repository.delete('vault_1');

      const versions = await repository.findAllVersionsByKey('agent1', 'rules');

      expect(versions).toHaveLength(2); // 삭제된 것 포함
      expect(versions.map(v => v.version).sort()).toEqual([1, 2]);
    });
  });

  describe('findActiveByAgentId', () => {
    it('should return only active versions (latest per key)', async () => {
      await repository.create({
        vault_id: 'vault_1',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Version 1',
        version: 1
      });

      await repository.create({
        vault_id: 'vault_2',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Version 2',
        version: 2
      });

      await repository.create({
        vault_id: 'vault_3',
        agent_id: 'agent1',
        key: 'guidelines',
        value: 'Guidelines',
        version: 1
      });

      const results = await repository.findActiveByAgentId('agent1');

      expect(results).toHaveLength(2); // 각 key별 최신 버전만
      expect(results.find(r => r.key === 'rules')?.version).toBe(2);
      expect(results.find(r => r.key === 'guidelines')?.version).toBe(1);
    });
  });

  describe('update', () => {
    it('should update knowledge vault', async () => {
      const created = await repository.create({
        vault_id: 'vault_123',
        key: 'rules',
        value: 'Old value',
        immutable: false
      });

      const updated = await repository.update('vault_123', {
        value: 'New value'
      });

      expect(updated).toBeDefined();
      expect(updated?.value).toBe('New value');
      // updated_at은 트리거에 의해 자동 업데이트되지만, 매우 빠른 업데이트의 경우 같은 값일 수 있음
      // 최소한 updated_at이 존재하는지 확인
      expect(updated?.updated_at).toBeDefined();
    });

    it('should throw error when updating immutable vault without admin_override', async () => {
      await repository.create({
        vault_id: 'vault_123',
        key: 'rules',
        value: 'Immutable value',
        immutable: true,
        admin_override: false
      });

      await expect(
        repository.update('vault_123', {
          value: 'New value'
        })
      ).rejects.toThrow('Cannot update immutable knowledge vault');
    });
  });

  describe('delete', () => {
    it('should soft delete knowledge vault (set deleted_at)', async () => {
      const created = await repository.create({
        vault_id: 'vault_123',
        key: 'rules',
        value: 'Value',
        immutable: false
      });

      const deleted = await repository.delete('vault_123');
      expect(deleted).toBe(true);

      // findById는 삭제된 것도 반환
      const found = await repository.findById('vault_123');
      expect(found).toBeDefined();
      expect(found?.deleted_at).toBeDefined();

      // findActiveByKey는 삭제된 것을 반환하지 않음
      const active = await repository.findActiveByKey('default', 'rules');
      expect(active).toBeNull();
    });

    it('should throw error when deleting immutable vault without admin_override', async () => {
      await repository.create({
        vault_id: 'vault_123',
        key: 'rules',
        value: 'Immutable value',
        immutable: true,
        admin_override: false
      });

      await expect(
        repository.delete('vault_123')
      ).rejects.toThrow('Cannot delete immutable knowledge vault');
    });
  });

  describe('deleteActiveByKey', () => {
    it('should soft delete active version by agent_id and key', async () => {
      await repository.create({
        vault_id: 'vault_1',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Version 1',
        version: 1
      });

      await repository.create({
        vault_id: 'vault_2',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Version 2',
        version: 2
      });

      // immutable이므로 active 버전에 admin_override 설정 필요
      const active = await repository.findActiveByKey('agent1', 'rules');
      if (active) {
        await repository.update(active.vault_id, { admin_override: true });
      }

      const deleted = await repository.deleteActiveByKey('agent1', 'rules');
      expect(deleted).toBe(true);

      // 활성 버전이 없어야 함
      const afterDelete = await repository.findActiveByKey('agent1', 'rules');
      expect(afterDelete).toBeNull();
    });
  });

  describe('hardDelete', () => {
    it('should physically delete knowledge vault', async () => {
      await repository.create({
        vault_id: 'vault_123',
        key: 'rules',
        value: 'Value'
      });

      const deleted = await repository.hardDelete('vault_123');
      expect(deleted).toBe(true);

      const found = await repository.findById('vault_123');
      expect(found).toBeNull();
    });
  });

  describe('findAllActive', () => {
    it('should return only active versions (latest per key)', async () => {
      await repository.create({
        vault_id: 'vault_1',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Version 1',
        version: 1
      });

      await repository.create({
        vault_id: 'vault_2',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Version 2',
        version: 2
      });

      await repository.create({
        vault_id: 'vault_3',
        agent_id: 'agent2',
        key: 'rules',
        value: 'Version 1',
        version: 1
      });

      // immutable이므로 admin_override 필요
      await repository.update('vault_1', { admin_override: true });
      await repository.delete('vault_1'); // Version 1 삭제

      const results = await repository.findAllActive();

      expect(results).toHaveLength(2); // 각 (agent_id, key) 조합별 최신 버전만
      expect(results.find(r => r.agent_id === 'agent1' && r.key === 'rules')?.version).toBe(2);
      expect(results.find(r => r.agent_id === 'agent2' && r.key === 'rules')?.version).toBe(1);
    });
  });

  describe('count', () => {
    it('should return count of all knowledge vaults', async () => {
      await repository.create({
        vault_id: 'vault_1',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Value 1',
        version: 1
      });

      await repository.create({
        vault_id: 'vault_2',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Value 2',
        version: 2
      });

      const count = await repository.count();
      expect(count).toBe(2);
    });

    it('should return count of active only when activeOnly=true', async () => {
      await repository.create({
        vault_id: 'vault_1',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Value 1',
        version: 1
      });

      await repository.create({
        vault_id: 'vault_2',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Value 2',
        version: 2
      });

      // immutable이므로 admin_override 필요
      await repository.update('vault_1', { admin_override: true });
      await repository.delete('vault_1');

      const totalCount = await repository.count('agent1', false);
      expect(totalCount).toBe(2);

      const activeCount = await repository.count('agent1', true);
      expect(activeCount).toBe(1);
    });
  });

  describe('getNextVersion', () => {
    it('should return next version number', async () => {
      await repository.create({
        vault_id: 'vault_1',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Version 1',
        version: 1
      });

      await repository.create({
        vault_id: 'vault_2',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Version 2',
        version: 2
      });

      const nextVersion = await repository.getNextVersion('agent1', 'rules');
      expect(nextVersion).toBe(3);
    });

    it('should return 1 when no versions exist', async () => {
      const nextVersion = await repository.getNextVersion('agent1', 'rules');
      expect(nextVersion).toBe(1);
    });
  });
});

