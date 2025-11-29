import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { KnowledgeVaultService, ImmutableDataError } from '../knowledge-vault-service.js';
import { KnowledgeVaultRepository } from '../repositories/knowledge-vault-repository.js';

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

describe('KnowledgeVaultService', () => {
  let db: Database.Database;
  let repository: KnowledgeVaultRepository;
  let service: KnowledgeVaultService;

  beforeEach(() => {
    db = new Database(':memory:');
    createKnowledgeVaultTable(db);
    repository = new KnowledgeVaultRepository(db);
    service = new KnowledgeVaultService(repository);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create a knowledge vault record', async () => {
      const input = {
        agent_id: 'agent1',
        key: 'user_rules',
        value: 'Never share personal info',
        immutable: true
      };

      const result = await service.create(input);

      expect(result.key).toBe('user_rules');
      expect(result.value).toBe('Never share personal info');
      expect(result.immutable).toBe(true);
      expect(result.version).toBe(1);
      expect(result.vault_id).toMatch(/^vault_\d+_[a-z0-9]+$/);
    });

    it('should create new version when active version exists', async () => {
      const v1 = await service.create({
        agent_id: 'agent1',
        key: 'rules',
        value: 'Version 1',
        immutable: true
      });

      const v2 = await service.create({
        agent_id: 'agent1',
        key: 'rules',
        value: 'Version 2',
        immutable: true
      });

      expect(v2.version).toBe(2);
      expect(v2.previous_version_id).toBe(v1.vault_id);

      // 기존 버전은 유지되어야 함
      const foundV1 = await service.findById(v1.vault_id);
      expect(foundV1).toBeDefined();
      expect(foundV1?.version).toBe(1);
    });

    it('should use default values when optional fields are not provided', async () => {
      const result = await service.create({
        key: 'rules',
        value: 'Follow rules'
      });

      expect(result.agent_id).toBe('default');
      expect(result.immutable).toBe(true);
      expect(result.version).toBe(1);
      expect(result.admin_override).toBe(false);
    });
  });

  describe('findActiveByKey', () => {
    it('should return active version (latest)', async () => {
      await service.create({
        agent_id: 'agent1',
        key: 'rules',
        value: 'Version 1',
        version: 1
      });

      await service.create({
        agent_id: 'agent1',
        key: 'rules',
        value: 'Version 2',
        version: 2
      });

      const found = await service.findActiveByKey('agent1', 'rules');

      expect(found).toBeDefined();
      expect(found?.version).toBe(2);
      expect(found?.value).toBe('Version 2');
    });

    it('should return null when no active version exists', async () => {
      const created = await service.create({
        agent_id: 'agent1',
        key: 'rules',
        value: 'Version 1'
      });

      // immutable이므로 admin_override 필요
      await service.update(created.vault_id, { admin_override: true });
      await service.delete(created.vault_id);

      const found = await service.findActiveByKey('agent1', 'rules');
      expect(found).toBeNull();
    });
  });

  describe('update', () => {
    it('should update non-immutable vault', async () => {
      const created = await service.create({
        agent_id: 'agent1',
        key: 'rules',
        value: 'Old value',
        immutable: false
      });

      const updated = await service.update(created.vault_id, {
        value: 'New value'
      });

      expect(updated).toBeDefined();
      expect(updated?.value).toBe('New value');
      expect(updated?.vault_id).toBe(created.vault_id); // 같은 레코드
    });

    it('should create new version when updating immutable vault', async () => {
      const v1 = await service.create({
        agent_id: 'agent1',
        key: 'rules',
        value: 'Version 1',
        immutable: true,
        admin_override: false
      });

      const updated = await service.update(v1.vault_id, {
        value: 'Version 2'
      });

      expect(updated).toBeDefined();
      expect(updated?.version).toBe(2);
      expect(updated?.vault_id).not.toBe(v1.vault_id); // 새 레코드
      expect(updated?.previous_version_id).toBe(v1.vault_id);

      // 기존 버전은 유지
      const foundV1 = await service.findById(v1.vault_id);
      expect(foundV1).toBeDefined();
    });

    it('should update immutable vault when admin_override=true', async () => {
      const created = await service.create({
        agent_id: 'agent1',
        key: 'rules',
        value: 'Old value',
        immutable: true,
        admin_override: true
      });

      const updated = await service.update(created.vault_id, {
        value: 'New value'
      });

      expect(updated).toBeDefined();
      expect(updated?.value).toBe('New value');
      expect(updated?.vault_id).toBe(created.vault_id); // 같은 레코드
    });

    it('should throw error when vault not found', async () => {
      await expect(
        service.update('nonexistent', {
          value: 'New value'
        })
      ).rejects.toThrow("Knowledge vault with id 'nonexistent' not found");
    });
  });

  describe('updateActiveByKey', () => {
    it('should update active version', async () => {
      await service.create({
        agent_id: 'agent1',
        key: 'rules',
        value: 'Version 1',
        immutable: false
      });

      const updated = await service.updateActiveByKey('agent1', 'rules', {
        value: 'Version 2'
      });

      expect(updated).toBeDefined();
      expect(updated?.value).toBe('Version 2');
    });

    it('should throw error when active version not found', async () => {
      await expect(
        service.updateActiveByKey('agent1', 'nonexistent', {
          value: 'New value'
        })
      ).rejects.toThrow("Active knowledge vault with key 'nonexistent' not found");
    });
  });

  describe('delete', () => {
    it('should soft delete non-immutable vault', async () => {
      const created = await service.create({
        agent_id: 'agent1',
        key: 'rules',
        value: 'Value',
        immutable: false
      });

      const deleted = await service.delete(created.vault_id);
      expect(deleted).toBe(true);

      // findById는 삭제된 것도 반환
      const found = await service.findById(created.vault_id);
      expect(found).toBeDefined();
      expect(found?.deleted_at).toBeDefined();

      // findActiveByKey는 삭제된 것을 반환하지 않음
      const active = await service.findActiveByKey('agent1', 'rules');
      expect(active).toBeNull();
    });

    it('should throw error when deleting immutable vault without admin_override', async () => {
      const created = await service.create({
        agent_id: 'agent1',
        key: 'rules',
        value: 'Immutable value',
        immutable: true,
        admin_override: false
      });

      await expect(
        service.delete(created.vault_id)
      ).rejects.toThrow(ImmutableDataError);
    });

    it('should allow deletion when admin_override=true', async () => {
      const created = await service.create({
        agent_id: 'agent1',
        key: 'rules',
        value: 'Immutable value',
        immutable: true,
        admin_override: true
      });

      const deleted = await service.delete(created.vault_id);
      expect(deleted).toBe(true);
    });

    it('should return false when vault not found', async () => {
      const deleted = await service.delete('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('deleteActiveByKey', () => {
    it('should soft delete active version', async () => {
      await service.create({
        agent_id: 'agent1',
        key: 'rules',
        value: 'Version 1',
        immutable: false
      });

      const deleted = await service.deleteActiveByKey('agent1', 'rules');
      expect(deleted).toBe(true);

      const active = await service.findActiveByKey('agent1', 'rules');
      expect(active).toBeNull();
    });

    it('should throw error when deleting immutable vault', async () => {
      await service.create({
        agent_id: 'agent1',
        key: 'rules',
        value: 'Immutable value',
        immutable: true,
        admin_override: false
      });

      await expect(
        service.deleteActiveByKey('agent1', 'rules')
      ).rejects.toThrow(ImmutableDataError);
    });
  });

  describe('hardDelete', () => {
    it('should physically delete non-immutable vault', async () => {
      const created = await service.create({
        agent_id: 'agent1',
        key: 'rules',
        value: 'Value',
        immutable: false
      });

      const deleted = await service.hardDelete(created.vault_id);
      expect(deleted).toBe(true);

      const found = await service.findById(created.vault_id);
      expect(found).toBeNull();
    });

    it('should throw error when hard deleting immutable vault without force', async () => {
      const created = await service.create({
        agent_id: 'agent1',
        key: 'rules',
        value: 'Immutable value',
        immutable: true
      });

      await expect(
        service.hardDelete(created.vault_id)
      ).rejects.toThrow(ImmutableDataError);
    });

    it('should allow hard delete when force=true', async () => {
      const created = await service.create({
        agent_id: 'agent1',
        key: 'rules',
        value: 'Immutable value',
        immutable: true
      });

      const deleted = await service.hardDelete(created.vault_id, true);
      expect(deleted).toBe(true);

      const found = await service.findById(created.vault_id);
      expect(found).toBeNull();
    });
  });

  describe('canUpdate', () => {
    it('should return true for non-immutable vault', () => {
      const record = {
        vault_id: 'vault_1',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Value',
        immutable: false,
        version: 1,
        admin_override: false,
        deleted_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      expect(service.canUpdate(record)).toBe(true);
    });

    it('should return false for immutable vault without admin_override', () => {
      const record = {
        vault_id: 'vault_1',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Value',
        immutable: true,
        version: 1,
        admin_override: false,
        deleted_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      expect(service.canUpdate(record)).toBe(false);
    });

    it('should return true for immutable vault with admin_override', () => {
      const record = {
        vault_id: 'vault_1',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Value',
        immutable: true,
        version: 1,
        admin_override: true,
        deleted_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      expect(service.canUpdate(record)).toBe(true);
    });

    it('should return true when admin_override parameter is true', () => {
      const record = {
        vault_id: 'vault_1',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Value',
        immutable: true,
        version: 1,
        admin_override: false,
        deleted_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      expect(service.canUpdate(record, true)).toBe(true);
    });
  });

  describe('canDelete', () => {
    it('should return true for non-immutable vault', () => {
      const record = {
        vault_id: 'vault_1',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Value',
        immutable: false,
        version: 1,
        admin_override: false,
        deleted_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      expect(service.canDelete(record)).toBe(true);
    });

    it('should return false for immutable vault without admin_override', () => {
      const record = {
        vault_id: 'vault_1',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Value',
        immutable: true,
        version: 1,
        admin_override: false,
        deleted_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      expect(service.canDelete(record)).toBe(false);
    });

    it('should return true when admin_override parameter is true', () => {
      const record = {
        vault_id: 'vault_1',
        agent_id: 'agent1',
        key: 'rules',
        value: 'Value',
        immutable: true,
        version: 1,
        admin_override: false,
        deleted_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      expect(service.canDelete(record, true)).toBe(true);
    });
  });

  describe('findAllVersionsByKey', () => {
    it('should return all versions including deleted', async () => {
      const v1 = await service.create({
        agent_id: 'agent1',
        key: 'rules',
        value: 'Version 1',
        version: 1
      });

      const v2 = await service.create({
        agent_id: 'agent1',
        key: 'rules',
        value: 'Version 2',
        version: 2
      });

      // immutable이므로 admin_override 필요
      await service.update(v1.vault_id, { admin_override: true });
      await service.delete(v1.vault_id);

      const versions = await service.findAllVersionsByKey('agent1', 'rules');

      expect(versions).toHaveLength(2);
      expect(versions.map(v => v.version).sort()).toEqual([1, 2]);
    });
  });
});

