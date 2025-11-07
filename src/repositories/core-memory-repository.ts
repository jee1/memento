/**
 * Core Memory Repository
 * Core Memory 테이블에 대한 데이터베이스 접근 로직
 */

import Database from 'better-sqlite3';

export interface CoreMemoryRecord {
  core_id: string;
  agent_id: string;
  key: string;
  value: string;
  always_load: boolean;
  origin_source?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCoreMemoryInput {
  core_id: string;
  agent_id?: string;
  key: string;
  value: string;
  always_load?: boolean;
  origin_source?: string | null;
}

export interface UpdateCoreMemoryInput {
  value?: string;
  always_load?: boolean;
  origin_source?: string | null;
}

export class CoreMemoryRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
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

    this.db.prepare(`
      INSERT INTO core_memory (core_id, agent_id, key, value, always_load, origin_source)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(core_id, agent_id, key, value, always_load ? 1 : 0, origin_source);

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
    const result = this.db.prepare(`
      SELECT 
        core_id,
        agent_id,
        key,
        value,
        always_load,
        origin_source,
        created_at,
        updated_at
      FROM core_memory
      WHERE core_id = ?
    `).get(core_id) as CoreMemoryRecord | undefined;

    if (!result) {
      return null;
    }

    return {
      ...result,
      always_load: Boolean(result.always_load)
    };
  }

  /**
   * agent_id와 key로 Core Memory 조회
   */
  async findByKey(agent_id: string, key: string): Promise<CoreMemoryRecord | null> {
    const result = this.db.prepare(`
      SELECT 
        core_id,
        agent_id,
        key,
        value,
        always_load,
        origin_source,
        created_at,
        updated_at
      FROM core_memory
      WHERE agent_id = ? AND key = ?
    `).get(agent_id, key) as CoreMemoryRecord | undefined;

    if (!result) {
      return null;
    }

    return {
      ...result,
      always_load: Boolean(result.always_load)
    };
  }

  /**
   * agent_id로 모든 Core Memory 조회
   */
  async findByAgentId(agent_id: string): Promise<CoreMemoryRecord[]> {
    const results = this.db.prepare(`
      SELECT 
        core_id,
        agent_id,
        key,
        value,
        always_load,
        origin_source,
        created_at,
        updated_at
      FROM core_memory
      WHERE agent_id = ?
      ORDER BY created_at ASC
    `).all(agent_id) as CoreMemoryRecord[];

    return results.map(result => ({
      ...result,
      always_load: Boolean(result.always_load)
    }));
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
          created_at,
          updated_at
        FROM core_memory
        WHERE always_load = 1
        ORDER BY created_at ASC
      `;

    const results = agent_id
      ? this.db.prepare(query).all(agent_id) as CoreMemoryRecord[]
      : this.db.prepare(query).all() as CoreMemoryRecord[];

    return results.map(result => ({
      ...result,
      always_load: Boolean(result.always_load)
    }));
  }

  /**
   * Core Memory 업데이트
   */
  async update(core_id: string, input: UpdateCoreMemoryInput): Promise<CoreMemoryRecord | null> {
    const updates: string[] = [];
    const values: any[] = [];

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

    values.push(core_id);

    this.db.prepare(`
      UPDATE core_memory
      SET ${updates.join(', ')}
      WHERE core_id = ?
    `).run(...values);

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
    const values: any[] = [];

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

    values.push(agent_id, key);

    this.db.prepare(`
      UPDATE core_memory
      SET ${updates.join(', ')}
      WHERE agent_id = ? AND key = ?
    `).run(...values);

    return this.findByKey(agent_id, key);
  }

  /**
   * Core Memory 삭제
   */
  async delete(core_id: string): Promise<boolean> {
    const result = this.db.prepare(`
      DELETE FROM core_memory
      WHERE core_id = ?
    `).run(core_id);

    return result.changes > 0;
  }

  /**
   * agent_id와 key로 Core Memory 삭제
   */
  async deleteByKey(agent_id: string, key: string): Promise<boolean> {
    const result = this.db.prepare(`
      DELETE FROM core_memory
      WHERE agent_id = ? AND key = ?
    `).run(agent_id, key);

    return result.changes > 0;
  }

  /**
   * agent_id로 모든 Core Memory 삭제
   */
  async deleteByAgentId(agent_id: string): Promise<number> {
    const result = this.db.prepare(`
      DELETE FROM core_memory
      WHERE agent_id = ?
    `).run(agent_id);

    return result.changes;
  }

  /**
   * 모든 Core Memory 조회 (관리용)
   */
  async findAll(): Promise<CoreMemoryRecord[]> {
    const results = this.db.prepare(`
      SELECT 
        core_id,
        agent_id,
        key,
        value,
        always_load,
        origin_source,
        created_at,
        updated_at
      FROM core_memory
      ORDER BY agent_id, created_at ASC
    `).all() as CoreMemoryRecord[];

    return results.map(result => ({
      ...result,
      always_load: Boolean(result.always_load)
    }));
  }

  /**
   * Core Memory 개수 조회
   */
  async count(agent_id?: string): Promise<number> {
    const query = agent_id
      ? 'SELECT COUNT(*) as count FROM core_memory WHERE agent_id = ?'
      : 'SELECT COUNT(*) as count FROM core_memory';

    const result = agent_id
      ? this.db.prepare(query).get(agent_id) as { count: number }
      : this.db.prepare(query).get() as { count: number };

    return result.count;
  }
}

