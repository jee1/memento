/**
 * Knowledge Vault Repository
 * Knowledge Vault 테이블에 대한 데이터베이스 접근 로직
 */

import Database from 'better-sqlite3';

export interface KnowledgeVaultRecord {
  vault_id: string;
  agent_id: string;
  key: string;
  value: string;
  immutable: boolean;
  version: number;
  previous_version_id?: string | null;
  admin_override: boolean;
  deleted_at?: string | null;
  origin_source?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateKnowledgeVaultInput {
  vault_id: string;
  agent_id?: string;
  key: string;
  value: string;
  immutable?: boolean;
  version?: number;
  previous_version_id?: string | null;
  admin_override?: boolean;
  deleted_at?: string | null;
  origin_source?: string | null;
}

export interface UpdateKnowledgeVaultInput {
  value?: string;
  immutable?: boolean;
  admin_override?: boolean;
  origin_source?: string | null;
}

export class KnowledgeVaultRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Knowledge Vault 생성
   */
  async create(input: CreateKnowledgeVaultInput): Promise<KnowledgeVaultRecord> {
    const {
      vault_id,
      agent_id = 'default',
      key,
      value,
      immutable = true,
      version = 1,
      previous_version_id = null,
      admin_override = false,
      deleted_at = null,
      origin_source = null
    } = input;

    this.db.prepare(`
      INSERT INTO knowledge_vault (
        vault_id, agent_id, key, value, immutable, version,
        previous_version_id, admin_override, deleted_at, origin_source
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      vault_id,
      agent_id,
      key,
      value,
      immutable ? 1 : 0,
      version,
      previous_version_id,
      admin_override ? 1 : 0,
      deleted_at,
      origin_source
    );

    const result = await this.findById(vault_id);
    if (!result) {
      throw new Error(`Failed to create knowledge vault with id: ${vault_id}`);
    }
    return result;
  }

  /**
   * ID로 Knowledge Vault 조회
   */
  async findById(vault_id: string): Promise<KnowledgeVaultRecord | null> {
    const result = this.db.prepare(`
      SELECT 
        vault_id,
        agent_id,
        key,
        value,
        immutable,
        version,
        previous_version_id,
        admin_override,
        deleted_at,
        origin_source,
        created_at,
        updated_at
      FROM knowledge_vault
      WHERE vault_id = ?
    `).get(vault_id) as KnowledgeVaultRecord | undefined;

    if (!result) {
      return null;
    }

    return {
      ...result,
      immutable: Boolean(result.immutable),
      admin_override: Boolean(result.admin_override)
    };
  }

  /**
   * agent_id와 key로 활성 버전 조회 (deleted_at IS NULL인 최신 버전)
   */
  async findActiveByKey(agent_id: string, key: string): Promise<KnowledgeVaultRecord | null> {
    const result = this.db.prepare(`
      SELECT 
        vault_id,
        agent_id,
        key,
        value,
        immutable,
        version,
        previous_version_id,
        admin_override,
        deleted_at,
        origin_source,
        created_at,
        updated_at
      FROM knowledge_vault
      WHERE agent_id = ? AND key = ? AND deleted_at IS NULL
      ORDER BY version DESC
      LIMIT 1
    `).get(agent_id, key) as KnowledgeVaultRecord | undefined;

    if (!result) {
      return null;
    }

    return {
      ...result,
      immutable: Boolean(result.immutable),
      admin_override: Boolean(result.admin_override)
    };
  }

  /**
   * agent_id와 key로 특정 버전 조회
   */
  async findByKeyAndVersion(
    agent_id: string,
    key: string,
    version: number
  ): Promise<KnowledgeVaultRecord | null> {
    const result = this.db.prepare(`
      SELECT 
        vault_id,
        agent_id,
        key,
        value,
        immutable,
        version,
        previous_version_id,
        admin_override,
        deleted_at,
        origin_source,
        created_at,
        updated_at
      FROM knowledge_vault
      WHERE agent_id = ? AND key = ? AND version = ?
    `).get(agent_id, key, version) as KnowledgeVaultRecord | undefined;

    if (!result) {
      return null;
    }

    return {
      ...result,
      immutable: Boolean(result.immutable),
      admin_override: Boolean(result.admin_override)
    };
  }

  /**
   * agent_id와 key로 모든 버전 조회 (삭제된 것 포함)
   */
  async findAllVersionsByKey(
    agent_id: string,
    key: string
  ): Promise<KnowledgeVaultRecord[]> {
    const results = this.db.prepare(`
      SELECT 
        vault_id,
        agent_id,
        key,
        value,
        immutable,
        version,
        previous_version_id,
        admin_override,
        deleted_at,
        origin_source,
        created_at,
        updated_at
      FROM knowledge_vault
      WHERE agent_id = ? AND key = ?
      ORDER BY version ASC
    `).all(agent_id, key) as KnowledgeVaultRecord[];

    return results.map(result => ({
      ...result,
      immutable: Boolean(result.immutable),
      admin_override: Boolean(result.admin_override)
    }));
  }

  /**
   * agent_id로 모든 활성 Knowledge Vault 조회 (deleted_at IS NULL)
   */
  async findActiveByAgentId(agent_id: string): Promise<KnowledgeVaultRecord[]> {
    const results = this.db.prepare(`
      SELECT 
        vault_id,
        agent_id,
        key,
        value,
        immutable,
        version,
        previous_version_id,
        admin_override,
        deleted_at,
        origin_source,
        created_at,
        updated_at
      FROM knowledge_vault
      WHERE agent_id = ? AND deleted_at IS NULL
      ORDER BY key, version DESC
    `).all(agent_id) as KnowledgeVaultRecord[];

    // 각 key별 최신 버전만 반환
    const latestByKey = new Map<string, KnowledgeVaultRecord>();
    for (const result of results) {
      const existing = latestByKey.get(result.key);
      if (!existing || result.version > existing.version) {
        latestByKey.set(result.key, result);
      }
    }

    return Array.from(latestByKey.values()).map(result => ({
      ...result,
      immutable: Boolean(result.immutable),
      admin_override: Boolean(result.admin_override)
    }));
  }

  /**
   * agent_id로 모든 Knowledge Vault 조회 (삭제된 것 포함)
   */
  async findByAgentId(agent_id: string): Promise<KnowledgeVaultRecord[]> {
    const results = this.db.prepare(`
      SELECT 
        vault_id,
        agent_id,
        key,
        value,
        immutable,
        version,
        previous_version_id,
        admin_override,
        deleted_at,
        origin_source,
        created_at,
        updated_at
      FROM knowledge_vault
      WHERE agent_id = ?
      ORDER BY key, version ASC
    `).all(agent_id) as KnowledgeVaultRecord[];

    return results.map(result => ({
      ...result,
      immutable: Boolean(result.immutable),
      admin_override: Boolean(result.admin_override)
    }));
  }

  /**
   * Knowledge Vault 업데이트 (immutable=true인 경우 제한)
   */
  async update(vault_id: string, input: UpdateKnowledgeVaultInput): Promise<KnowledgeVaultRecord | null> {
    const existing = await this.findById(vault_id);
    if (!existing) {
      return null;
    }

    // immutable=true이고 admin_override=false인 경우 업데이트 불가
    if (existing.immutable && !existing.admin_override && !input.admin_override) {
      throw new Error(`Cannot update immutable knowledge vault: ${vault_id}`);
    }

    const updates: string[] = [];
    const values: any[] = [];

    if (input.value !== undefined) {
      updates.push('value = ?');
      values.push(input.value);
    }

    if (input.immutable !== undefined) {
      updates.push('immutable = ?');
      values.push(input.immutable ? 1 : 0);
    }

    if (input.admin_override !== undefined) {
      updates.push('admin_override = ?');
      values.push(input.admin_override ? 1 : 0);
    }

    if (input.origin_source !== undefined) {
      updates.push('origin_source = ?');
      values.push(input.origin_source);
    }

    if (updates.length === 0) {
      return existing;
    }

    values.push(vault_id);

    this.db.prepare(`
      UPDATE knowledge_vault
      SET ${updates.join(', ')}
      WHERE vault_id = ?
    `).run(...values);

    return this.findById(vault_id);
  }

  /**
   * Knowledge Vault 삭제 (soft delete: deleted_at 설정)
   */
  async delete(vault_id: string): Promise<boolean> {
    const existing = await this.findById(vault_id);
    if (!existing) {
      return false;
    }

    // immutable=true이고 admin_override=false인 경우 삭제 불가
    if (existing.immutable && !existing.admin_override) {
      throw new Error(`Cannot delete immutable knowledge vault: ${vault_id}`);
    }

    const result = this.db.prepare(`
      UPDATE knowledge_vault
      SET deleted_at = CURRENT_TIMESTAMP
      WHERE vault_id = ?
    `).run(vault_id);

    return result.changes > 0;
  }

  /**
   * agent_id와 key로 활성 버전 삭제 (soft delete)
   */
  async deleteActiveByKey(agent_id: string, key: string): Promise<boolean> {
    const active = await this.findActiveByKey(agent_id, key);
    if (!active) {
      return false;
    }

    // immutable=true이고 admin_override=false인 경우 삭제 불가
    if (active.immutable && !active.admin_override) {
      throw new Error(`Cannot delete immutable knowledge vault: agent_id=${agent_id}, key=${key}`);
    }

    const result = this.db.prepare(`
      UPDATE knowledge_vault
      SET deleted_at = CURRENT_TIMESTAMP
      WHERE agent_id = ? AND key = ? AND deleted_at IS NULL
    `).run(agent_id, key);

    return result.changes > 0;
  }

  /**
   * 하드 삭제 (물리적 삭제, 주의 필요)
   */
  async hardDelete(vault_id: string): Promise<boolean> {
    const result = this.db.prepare(`
      DELETE FROM knowledge_vault
      WHERE vault_id = ?
    `).run(vault_id);

    return result.changes > 0;
  }

  /**
   * 모든 Knowledge Vault 조회 (관리용, 삭제된 것 포함)
   */
  async findAll(): Promise<KnowledgeVaultRecord[]> {
    const results = this.db.prepare(`
      SELECT 
        vault_id,
        agent_id,
        key,
        value,
        immutable,
        version,
        previous_version_id,
        admin_override,
        deleted_at,
        origin_source,
        created_at,
        updated_at
      FROM knowledge_vault
      ORDER BY agent_id, key, version ASC
    `).all() as KnowledgeVaultRecord[];

    return results.map(result => ({
      ...result,
      immutable: Boolean(result.immutable),
      admin_override: Boolean(result.admin_override)
    }));
  }

  /**
   * 활성 Knowledge Vault만 조회 (deleted_at IS NULL)
   */
  async findAllActive(): Promise<KnowledgeVaultRecord[]> {
    const results = this.db.prepare(`
      SELECT 
        vault_id,
        agent_id,
        key,
        value,
        immutable,
        version,
        previous_version_id,
        admin_override,
        deleted_at,
        origin_source,
        created_at,
        updated_at
      FROM knowledge_vault
      WHERE deleted_at IS NULL
      ORDER BY agent_id, key, version DESC
    `).all() as KnowledgeVaultRecord[];

    // 각 (agent_id, key) 조합별 최신 버전만 반환
    const latestByKey = new Map<string, KnowledgeVaultRecord>();
    for (const result of results) {
      const mapKey = `${result.agent_id}:${result.key}`;
      const existing = latestByKey.get(mapKey);
      if (!existing || result.version > existing.version) {
        latestByKey.set(mapKey, result);
      }
    }

    return Array.from(latestByKey.values()).map(result => ({
      ...result,
      immutable: Boolean(result.immutable),
      admin_override: Boolean(result.admin_override)
    }));
  }

  /**
   * Knowledge Vault 개수 조회
   */
  async count(agent_id?: string, activeOnly: boolean = true): Promise<number> {
    const whereClause = agent_id
      ? activeOnly
        ? 'WHERE agent_id = ? AND deleted_at IS NULL'
        : 'WHERE agent_id = ?'
      : activeOnly
        ? 'WHERE deleted_at IS NULL'
        : '';

    const query = `SELECT COUNT(*) as count FROM knowledge_vault ${whereClause}`;

    const result = agent_id
      ? this.db.prepare(query).get(agent_id) as { count: number }
      : this.db.prepare(query).get() as { count: number };

    return result.count;
  }

  /**
   * 다음 버전 번호 조회 (agent_id, key 기준)
   */
  async getNextVersion(agent_id: string, key: string): Promise<number> {
    const result = this.db.prepare(`
      SELECT MAX(version) as max_version
      FROM knowledge_vault
      WHERE agent_id = ? AND key = ?
    `).get(agent_id, key) as { max_version: number | null } | undefined;

    return (result?.max_version ?? 0) + 1;
  }
}

