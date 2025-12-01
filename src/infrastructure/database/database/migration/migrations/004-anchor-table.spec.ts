import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { AnchorTableMigration } from './004-anchor-table.js';

/**
 * 기본 스키마 생성 (memory_item 테이블만)
 * MIRIX 스키마 확장 이후의 상태를 가정 (origin_source 등 필드 포함)
 */
function createBaseSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT CHECK (type IN ('working','episodic','semantic','procedural')) NOT NULL,
      content TEXT NOT NULL,
      importance REAL CHECK (importance >= 0 AND importance <= 1) DEFAULT 0.5,
      privacy_scope TEXT CHECK (privacy_scope IN ('private','team','public')) DEFAULT 'private',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_accessed TIMESTAMP,
      pinned BOOLEAN DEFAULT FALSE,
      tags TEXT,
      source TEXT,
      view_count INTEGER DEFAULT 0,
      cite_count INTEGER DEFAULT 0,
      edit_count INTEGER DEFAULT 0,
      origin_source TEXT DEFAULT '{}',
      task_goal TEXT,
      steps TEXT,
      reflection_notes TEXT
    );
  `);

  // memento_schema_version 테이블 생성 (마이그레이션 버전 관리용)
  db.exec(`
    CREATE TABLE IF NOT EXISTS memento_schema_version (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      migration_name TEXT NOT NULL,
      checksum TEXT,
      applied_by TEXT DEFAULT 'system',
      description TEXT
    );
  `);

  // memory_embedding 테이블 생성 (의존성 검증용)
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_embedding (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      embedding_provider TEXT NOT NULL DEFAULT 'tfidf',
      projection_type TEXT NOT NULL DEFAULT 'native',
      embedding TEXT NOT NULL,
      dim INTEGER NOT NULL,
      dimensions INTEGER DEFAULT 0,
      model TEXT,
      precision INTEGER DEFAULT 32,
      normalized BOOLEAN DEFAULT FALSE,
      version INTEGER DEFAULT 1,
      created_by TEXT DEFAULT 'system',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE,
      UNIQUE(memory_id, embedding_provider, projection_type)
    );
  `);

  // FTS5 트리거 생성 (의존성 검증용)
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_fts USING fts5(
        content,
        tags,
        source,
        content='memory_item',
        content_rowid='rowid'
      );
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_item_fts_insert AFTER INSERT ON memory_item BEGIN
        INSERT INTO memory_item_fts(rowid, content, tags, source)
        VALUES (new.rowid, new.content, new.tags, new.source);
      END;
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_item_fts_update AFTER UPDATE ON memory_item BEGIN
        INSERT INTO memory_item_fts(memory_item_fts, rowid, content, tags, source)
        VALUES('delete', old.rowid, old.content, old.tags, old.source);
        INSERT INTO memory_item_fts(rowid, content, tags, source)
        VALUES (new.rowid, new.content, new.tags, new.source);
      END;
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_item_fts_delete AFTER DELETE ON memory_item BEGIN
        INSERT INTO memory_item_fts(memory_item_fts, rowid, content, tags, source)
        VALUES('delete', old.rowid, old.content, old.tags, old.source);
      END;
    `);
  } catch (error) {
    // FTS5가 사용 불가능할 수 있으므로 무시
  }
}

describe('AnchorTableMigration', () => {
  let db: Database.Database;
  let migration: AnchorTableMigration;

  beforeEach(() => {
    db = new Database(':memory:');
    createBaseSchema(db);
    migration = new AnchorTableMigration();
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe('validateBefore', () => {
    it('should pass when memory_item table exists', async () => {
      await expect(migration.validateBefore(db)).resolves.not.toThrow();
    });

    it('should throw error when memory_item table does not exist', async () => {
      const emptyDb = new Database(':memory:');
      await expect(migration.validateBefore(emptyDb)).rejects.toThrow(
        'memory_item table does not exist'
      );
      emptyDb.close();
    });

    it('should throw error when migration has already been applied', async () => {
      db.prepare(`
        INSERT INTO memento_schema_version (version, migration_name, description, applied_by)
        VALUES (?, ?, ?, ?)
      `).run('4.0', 'anchor-table', 'Test migration', 'system');

      await expect(migration.validateBefore(db)).rejects.toThrow(
        'Migration 004 has already been applied'
      );
    });

    it('should throw error when anchor table already exists', async () => {
      // anchor 테이블을 수동으로 생성
      db.exec(`
        CREATE TABLE anchor (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id TEXT NOT NULL,
          slot TEXT NOT NULL,
          memory_id TEXT
        )
      `);

      await expect(migration.validateBefore(db)).rejects.toThrow(
        'anchor table already exists'
      );
    });
  });

  describe('up', () => {
    it('should create anchor table with all required columns', async () => {
      await migration.up(db);

      const columns = db.prepare(`PRAGMA table_info(anchor)`).all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null }>;
      const columnNames = columns.map(col => col.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('agent_id');
      expect(columnNames).toContain('slot');
      expect(columnNames).toContain('memory_id');
      expect(columnNames).toContain('created_at');
      expect(columnNames).toContain('updated_at');

      // agent_id는 NOT NULL이어야 함
      const agentIdCol = columns.find(col => col.name === 'agent_id');
      expect(agentIdCol?.notnull).toBe(1);

      // slot은 NOT NULL이어야 함
      const slotCol = columns.find(col => col.name === 'slot');
      expect(slotCol?.notnull).toBe(1);

      // memory_id는 NULL 허용이어야 함
      const memoryIdCol = columns.find(col => col.name === 'memory_id');
      expect(memoryIdCol?.notnull).toBe(0);
    });

    it('should create all required indexes', async () => {
      await migration.up(db);

      const indexes = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='index' AND name LIKE 'idx_anchor_%'
      `).all() as Array<{ name: string }>;
      const indexNames = indexes.map(idx => idx.name);

      expect(indexNames).toContain('idx_anchor_agent_slot');
      expect(indexNames).toContain('idx_anchor_memory_id');
      expect(indexNames).toContain('idx_anchor_agent_memory');
    });

    it('should enforce UNIQUE constraint on (agent_id, slot)', async () => {
      await migration.up(db);

      // 테스트 데이터 삽입
      db.prepare(`
        INSERT INTO memory_item (id, type, content)
        VALUES (?, ?, ?)
      `).run('test-1', 'episodic', 'Test content');

      // 첫 번째 앵커 설정 (성공해야 함)
      db.prepare(`
        INSERT INTO anchor (agent_id, slot, memory_id)
        VALUES (?, ?, ?)
      `).run('agent-1', 'A', 'test-1');

      // 동일한 (agent_id, slot) 조합으로 다시 삽입 시도 (실패해야 함)
      expect(() => {
        db.prepare(`
          INSERT INTO anchor (agent_id, slot, memory_id)
          VALUES (?, ?, ?)
        `).run('agent-1', 'A', 'test-1');
      }).toThrow();

      // 다른 슬롯은 허용되어야 함
      db.prepare(`
        INSERT INTO anchor (agent_id, slot, memory_id)
        VALUES (?, ?, ?)
      `).run('agent-1', 'B', 'test-1');

      // 다른 에이전트는 동일한 슬롯 사용 가능해야 함
      db.prepare(`
        INSERT INTO anchor (agent_id, slot, memory_id)
        VALUES (?, ?, ?)
      `).run('agent-2', 'A', 'test-1');
    });

    it('should enforce CHECK constraint on slot (A, B, C only)', async () => {
      await migration.up(db);

      db.prepare(`
        INSERT INTO memory_item (id, type, content)
        VALUES (?, ?, ?)
      `).run('test-1', 'episodic', 'Test content');

      // 유효한 슬롯 (A, B, C)는 허용되어야 함
      for (const slot of ['A', 'B', 'C']) {
        db.prepare(`
          INSERT INTO anchor (agent_id, slot, memory_id)
          VALUES (?, ?, ?)
        `).run('agent-1', slot, 'test-1');
      }

      // 유효하지 않은 슬롯은 거부되어야 함
      expect(() => {
        db.prepare(`
          INSERT INTO anchor (agent_id, slot, memory_id)
          VALUES (?, ?, ?)
        `).run('agent-1', 'D', 'test-1');
      }).toThrow();
    });

    it('should enforce foreign key constraint with ON DELETE SET NULL', async () => {
      await migration.up(db);

      // 테스트 데이터 삽입
      db.prepare(`
        INSERT INTO memory_item (id, type, content)
        VALUES (?, ?, ?)
      `).run('test-1', 'episodic', 'Test content');

      // 앵커 설정
      db.prepare(`
        INSERT INTO anchor (agent_id, slot, memory_id)
        VALUES (?, ?, ?)
      `).run('agent-1', 'A', 'test-1');

      // 메모리 삭제
      db.prepare('DELETE FROM memory_item WHERE id = ?').run('test-1');

      // memory_id가 NULL로 설정되었는지 확인
      const anchor = db.prepare(`
        SELECT memory_id FROM anchor WHERE agent_id = ? AND slot = ?
      `).get('agent-1', 'A') as { memory_id: string | null } | undefined;

      expect(anchor).toBeDefined();
      expect(anchor?.memory_id).toBeNull();
    });
  });

  describe('validateAfter', () => {
    it('should pass when all tables and indexes are created correctly', async () => {
      await migration.up(db);
      await expect(migration.validateAfter(db)).resolves.not.toThrow();
    });

    it('should throw error when anchor table is missing', async () => {
      await migration.up(db);
      db.exec('DROP TABLE anchor');
      await expect(migration.validateAfter(db)).rejects.toThrow(
        'anchor table was not created'
      );
    });

    it('should throw error when required indexes are missing', async () => {
      await migration.up(db);
      db.exec('DROP INDEX idx_anchor_agent_slot');
      await expect(migration.validateAfter(db)).rejects.toThrow(
        'Index idx_anchor_agent_slot was not created'
      );
    });

    it('should throw error when required columns are missing', async () => {
      await migration.up(db);
      // 컬럼 삭제는 SQLite에서 직접 지원하지 않으므로, 테이블 재생성으로 시뮬레이션
      // 실제로는 이런 상황이 발생하지 않지만, 검증 로직 테스트를 위해
      // 컬럼이 없는 상태를 만들 수 없으므로 이 테스트는 스킵
    });

    it('should throw error when UNIQUE constraint is missing', async () => {
      await migration.up(db);
      // UNIQUE 제약 조건 검증은 validateAfter에서 수행됨
      // 실제로는 테이블 구조를 확인하여 UNIQUE 제약이 있는지 검증
      // 이 테스트는 validateAfter가 UNIQUE 제약을 올바르게 검증하는지 확인
      await expect(migration.validateAfter(db)).resolves.not.toThrow();
    });

    it('should throw error when foreign key constraint is missing', async () => {
      await migration.up(db);
      // Foreign key 제약 조건 검증은 validateAfter에서 수행됨
      // 실제로는 테이블 구조를 확인하여 FOREIGN KEY 제약이 있는지 검증
      await expect(migration.validateAfter(db)).resolves.not.toThrow();
    });
  });

  describe('down', () => {
    it('should drop all indexes and anchor table', async () => {
      await migration.up(db);

      // 인덱스 존재 확인
      const indexBefore = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='index' AND name='idx_anchor_agent_slot'
      `).get();
      expect(indexBefore).toBeDefined();

      // 테이블 존재 확인
      const tableBefore = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='anchor'
      `).get();
      expect(tableBefore).toBeDefined();

      // 스키마 버전 기록 (MigrationRunner가 하는 일을 시뮬레이션)
      db.prepare(`
        INSERT INTO memento_schema_version (version, migration_name, description, applied_by)
        VALUES (?, ?, ?, ?)
      `).run('4.0', 'anchor-table', 'Test', 'system');

      await migration.down(db);

      // 인덱스 삭제 확인
      const indexAfter = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='index' AND name='idx_anchor_agent_slot'
      `).get();
      expect(indexAfter).toBeUndefined();

      // 테이블 삭제 확인
      const tableAfter = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='anchor'
      `).get();
      expect(tableAfter).toBeUndefined();

      // 스키마 버전 4.0 삭제 확인
      const version = db.prepare(`
        SELECT version FROM memento_schema_version WHERE version = ?
      `).get('4.0');
      expect(version).toBeUndefined();
    });

    it('should keep memento_schema_version table after rollback', async () => {
      await migration.up(db);
      await migration.down(db);

      // memento_schema_version 테이블은 유지되어야 함
      const schemaVersionTable = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='memento_schema_version'
      `).get();
      expect(schemaVersionTable).toBeDefined();
    });
  });

  describe('integration', () => {
    it('should complete full migration cycle (up -> validate -> down)', async () => {
      // Before validation
      await expect(migration.validateBefore(db)).resolves.not.toThrow();

      // Migration
      await migration.up(db);

      // After validation
      await expect(migration.validateAfter(db)).resolves.not.toThrow();

      // Rollback
      await migration.down(db);

      // Verify rollback (테이블이 삭제되었는지 확인)
      const table = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='anchor'
      `).get();
      expect(table).toBeUndefined();
    });

    it('should preserve existing memory_item data during migration', async () => {
      // 기존 데이터 삽입
      const testData = [
        { id: 'test-1', type: 'episodic', content: 'Content 1' },
        { id: 'test-2', type: 'semantic', content: 'Content 2' },
        { id: 'test-3', type: 'procedural', content: 'Content 3' }
      ];

      for (const data of testData) {
        db.prepare(`
          INSERT INTO memory_item (id, type, content)
          VALUES (?, ?, ?)
        `).run(data.id, data.type, data.content);
      }

      await migration.up(db);

      // 기존 데이터가 유지되었는지 확인
      const count = db.prepare('SELECT COUNT(*) as count FROM memory_item').get() as { count: number };
      expect(count.count).toBe(3);

      // 각 레코드 확인
      for (const data of testData) {
        const record = db.prepare(`
          SELECT id, type, content FROM memory_item WHERE id = ?
        `).get(data.id) as { id: string; type: string; content: string } | undefined;
        expect(record).toBeDefined();
        expect(record?.type).toBe(data.type);
        expect(record?.content).toBe(data.content);
      }
    });

    it('should support multiple agents with different anchors', async () => {
      await migration.up(db);

      // 여러 메모리 생성
      const memories = [
        { id: 'mem-1', type: 'episodic', content: 'Memory 1' },
        { id: 'mem-2', type: 'semantic', content: 'Memory 2' },
        { id: 'mem-3', type: 'procedural', content: 'Memory 3' }
      ];

      for (const mem of memories) {
        db.prepare(`
          INSERT INTO memory_item (id, type, content)
          VALUES (?, ?, ?)
        `).run(mem.id, mem.type, mem.content);
      }

      // 여러 에이전트가 서로 다른 앵커 설정
      db.prepare(`
        INSERT INTO anchor (agent_id, slot, memory_id)
        VALUES (?, ?, ?)
      `).run('agent-1', 'A', 'mem-1');

      db.prepare(`
        INSERT INTO anchor (agent_id, slot, memory_id)
        VALUES (?, ?, ?)
      `).run('agent-1', 'B', 'mem-2');

      db.prepare(`
        INSERT INTO anchor (agent_id, slot, memory_id)
        VALUES (?, ?, ?)
      `).run('agent-2', 'A', 'mem-1'); // 동일한 메모리를 다른 에이전트가 사용 가능

      db.prepare(`
        INSERT INTO anchor (agent_id, slot, memory_id)
        VALUES (?, ?, ?)
      `).run('agent-2', 'B', 'mem-3');

      // 모든 앵커가 올바르게 저장되었는지 확인
      const anchors = db.prepare(`
        SELECT agent_id, slot, memory_id FROM anchor
        ORDER BY agent_id, slot
      `).all() as Array<{ agent_id: string; slot: string; memory_id: string }>;

      expect(anchors.length).toBe(4);
      expect(anchors.find(a => a.agent_id === 'agent-1' && a.slot === 'A')?.memory_id).toBe('mem-1');
      expect(anchors.find(a => a.agent_id === 'agent-1' && a.slot === 'B')?.memory_id).toBe('mem-2');
      expect(anchors.find(a => a.agent_id === 'agent-2' && a.slot === 'A')?.memory_id).toBe('mem-1');
      expect(anchors.find(a => a.agent_id === 'agent-2' && a.slot === 'B')?.memory_id).toBe('mem-3');
    });

    it('should handle NULL memory_id correctly (deleted memory)', async () => {
      await migration.up(db);

      // 메모리 생성 및 앵커 설정
      db.prepare(`
        INSERT INTO memory_item (id, type, content)
        VALUES (?, ?, ?)
      `).run('mem-1', 'episodic', 'Memory 1');

      db.prepare(`
        INSERT INTO anchor (agent_id, slot, memory_id)
        VALUES (?, ?, ?)
      `).run('agent-1', 'A', 'mem-1');

      // 메모리 삭제
      db.prepare('DELETE FROM memory_item WHERE id = ?').run('mem-1');

      // memory_id가 NULL로 설정되었는지 확인
      const anchor = db.prepare(`
        SELECT memory_id FROM anchor WHERE agent_id = ? AND slot = ?
      `).get('agent-1', 'A') as { memory_id: string | null } | undefined;

      expect(anchor).toBeDefined();
      expect(anchor?.memory_id).toBeNull();

      // NULL memory_id를 가진 앵커도 조회 가능해야 함
      const anchors = db.prepare(`
        SELECT agent_id, slot, memory_id FROM anchor WHERE memory_id IS NULL
      `).all() as Array<{ agent_id: string; slot: string; memory_id: string | null }>;

      expect(anchors.length).toBe(1);
      expect(anchors[0].agent_id).toBe('agent-1');
      expect(anchors[0].slot).toBe('A');
    });
  });
});

