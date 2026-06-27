/**
 * Core Memory Repository SQLite 구현체
 * CoreMemoryDatabaseConnection 인터페이스를 사용하여 구현
 */

import type { CoreMemoryRepository } from '../../../domains/memory/repositories/core-memory-repository.interface.js';
import type {
  CoreMemoryRecord,
  CreateCoreMemoryInput,
  UpdateCoreMemoryInput
} from '../../../domains/memory/repositories/core-memory-repository.interface.js';
import type { CoreMemoryDatabaseConnection } from '../../../domains/memory/repositories/core-memory-database.interface.js';

/**
 * always_load 불리언 변환 헬퍼 함수
 */
function convertAlwaysLoad(record: unknown): CoreMemoryRecord {
  const r = record as CoreMemoryRecord;
  return {
    ...r,
    always_load: Boolean(r.always_load)
  };
}

/**
 * Core Memory Repository SQLite 구현체
 */
export class CoreMemoryRepositorySqliteImpl implements CoreMemoryRepository {
  private db: CoreMemoryDatabaseConnection;

  constructor(db: CoreMemoryDatabaseConnection) {
    this.db = db;
  }

  /**
   * Core Memory 생성
   */
  async create(input: CreateCoreMemoryInput): Promise<CoreMemoryRecord> {
    const {
      core_id,
      agent_id = 'default',
      key,
      value,
      always_load = false,
      origin_source = null
    } = input;

    const stmt = await this.db.prepare(`
      INSERT INTO core_memory (core_id, agent_id, key, value, always_load, origin_source, version)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `);
    await stmt.run(core_id, agent_id, key, value, always_load ? 1 : 0, origin_source);

    const result = await this.findById(core_id);
    if (!result) {
      throw new Error(`Failed to create core memory with id: ${core_id}`);
    }
    return result;
  }

  /**
   * ID로 Core Memory 조회
   */
  async findById(core_id: string): Promise<CoreMemoryRecord | null> {
    const stmt = await this.db.prepare(`
      SELECT 
        core_id,
        agent_id,
        key,
        value,
        always_load,
        origin_source,
        version,
        created_at,
        updated_at
      FROM core_memory
      WHERE core_id = ?
    `);
    const result = await stmt.get(core_id) as CoreMemoryRecord | undefined;

    if (!result) {
      return null;
    }

    return convertAlwaysLoad(result);
  }

  /**
   * agent_id와 key로 Core Memory 조회
   */
  async findByKey(agent_id: string, key: string): Promise<CoreMemoryRecord | null> {
    const stmt = await this.db.prepare(`
      SELECT 
        core_id,
        agent_id,
        key,
        value,
        always_load,
        origin_source,
        version,
        created_at,
        updated_at
      FROM core_memory
      WHERE agent_id = ? AND key = ?
    `);
    const result = await stmt.get(agent_id, key) as CoreMemoryRecord | undefined;

    if (!result) {
      return null;
    }

    return convertAlwaysLoad(result);
  }

  /**
   * agent_id로 모든 Core Memory 조회
   */
  async findByAgentId(agent_id: string): Promise<CoreMemoryRecord[]> {
    const stmt = await this.db.prepare(`
      SELECT 
        core_id,
        agent_id,
        key,
        value,
        always_load,
        origin_source,
        version,
        created_at,
        updated_at
      FROM core_memory
      WHERE agent_id = ?
      ORDER BY created_at ASC
    `);
    const results = await stmt.all(agent_id) as CoreMemoryRecord[];

    return results.map(convertAlwaysLoad);
  }

  /**
   * always_load=true인 Core Memory 조회
   */
  async findAlwaysLoad(agent_id?: string): Promise<CoreMemoryRecord[]> {
    const query = agent_id
      ? `
        SELECT 
          core_id,
          agent_id,
          key,
          value,
          always_load,
          origin_source,
          version,
          created_at,
          updated_at
        FROM core_memory
        WHERE always_load = 1 AND agent_id = ?
        ORDER BY created_at ASC
      `
      : `
        SELECT 
          core_id,
          agent_id,
          key,
          value,
          always_load,
          origin_source,
          version,
          created_at,
          updated_at
        FROM core_memory
        WHERE always_load = 1
        ORDER BY created_at ASC
      `;

    const stmt = await this.db.prepare(query);
    const results = agent_id
      ? await stmt.all(agent_id) as CoreMemoryRecord[]
      : await stmt.all() as CoreMemoryRecord[];

    return results.map(convertAlwaysLoad);
  }

  /**
   * Core Memory 업데이트
   */
  async update(core_id: string, input: UpdateCoreMemoryInput): Promise<CoreMemoryRecord | null> {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.value !== undefined) {
      updates.push('value = ?');
      values.push(input.value);
    }

    if (input.always_load !== undefined) {
      updates.push('always_load = ?');
      values.push(input.always_load ? 1 : 0);
    }

    if (input.origin_source !== undefined) {
      updates.push('origin_source = ?');
      values.push(input.origin_source);
    }

    if (updates.length === 0) {
      return this.findById(core_id);
    }

    // version = version + 1 추가 (항상 증가)
    updates.push('version = version + 1');
    values.push(core_id);

    const stmt = await this.db.prepare(`
      UPDATE core_memory
      SET ${updates.join(', ')}
      WHERE core_id = ?
    `);
    await stmt.run(...values);

    return this.findById(core_id);
  }

  /**
   * agent_id와 key로 Core Memory 업데이트
   */
  async updateByKey(
    agent_id: string,
    key: string,
    input: UpdateCoreMemoryInput
  ): Promise<CoreMemoryRecord | null> {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.value !== undefined) {
      updates.push('value = ?');
      values.push(input.value);
    }

    if (input.always_load !== undefined) {
      updates.push('always_load = ?');
      values.push(input.always_load ? 1 : 0);
    }

    if (input.origin_source !== undefined) {
      updates.push('origin_source = ?');
      values.push(input.origin_source);
    }

    if (updates.length === 0) {
      return this.findByKey(agent_id, key);
    }

    // version = version + 1 추가 (항상 증가)
    updates.push('version = version + 1');
    values.push(agent_id, key);

    const stmt = await this.db.prepare(`
      UPDATE core_memory
      SET ${updates.join(', ')}
      WHERE agent_id = ? AND key = ?
    `);
    await stmt.run(...values);

    return this.findByKey(agent_id, key);
  }

  /**
   * Core Memory 삭제
   */
  async delete(core_id: string): Promise<boolean> {
    const stmt = await this.db.prepare(`
      DELETE FROM core_memory
      WHERE core_id = ?
    `);
    const result = await stmt.run(core_id);

    return result.changes > 0;
  }

  /**
   * agent_id와 key로 Core Memory 삭제
   */
  async deleteByKey(agent_id: string, key: string): Promise<boolean> {
    const stmt = await this.db.prepare(`
      DELETE FROM core_memory
      WHERE agent_id = ? AND key = ?
    `);
    const result = await stmt.run(agent_id, key);

    return result.changes > 0;
  }

  /**
   * agent_id로 모든 Core Memory 삭제
   */
  async deleteByAgentId(agent_id: string): Promise<number> {
    const stmt = await this.db.prepare(`
      DELETE FROM core_memory
      WHERE agent_id = ?
    `);
    const result = await stmt.run(agent_id);

    return result.changes;
  }

  /**
   * 모든 Core Memory 조회 (관리용)
   */
  async findAll(): Promise<CoreMemoryRecord[]> {
    const stmt = await this.db.prepare(`
      SELECT 
        core_id,
        agent_id,
        key,
        value,
        always_load,
        origin_source,
        version,
        created_at,
        updated_at
      FROM core_memory
      ORDER BY agent_id, created_at ASC
    `);
    const results = await stmt.all() as CoreMemoryRecord[];

    return results.map(convertAlwaysLoad);
  }

  /**
   * Core Memory 개수 조회
   */
  async count(agent_id?: string): Promise<number> {
    const query = agent_id
      ? 'SELECT COUNT(*) as count FROM core_memory WHERE agent_id = ?'
      : 'SELECT COUNT(*) as count FROM core_memory';

    const stmt = await this.db.prepare(query);
    const result = agent_id
      ? await stmt.get(agent_id) as { count: number }
      : await stmt.get() as { count: number };

    return result.count;
  }
}

