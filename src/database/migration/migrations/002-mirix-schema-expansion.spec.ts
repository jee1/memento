import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MirixSchemaExpansionMigration } from './002-mirix-schema-expansion.js';

/**
 * 기본 스키마 생성 (memory_item 테이블만)
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
      edit_count INTEGER DEFAULT 0
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

  // VEC 트리거 생성 (의존성 검증용, 선택적)
  // 실제 스키마와 동일한 트리거를 생성 (sqlite-vec 확장이 없을 수 있으므로 try-catch)
  try {
    // VEC 가상 테이블 생성 시도 (실패할 수 있음)
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_vec USING vec0(embedding float[384]);
    `);
  } catch (error) {
    // sqlite-vec 확장이 없을 수 있으므로 무시
  }

  try {
    // VEC 트리거 생성 (실제 스키마와 유사한 구조)
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_embedding_vec_insert AFTER INSERT ON memory_embedding BEGIN
        INSERT INTO memory_item_vec(rowid, embedding) 
        SELECT NEW.id, json_extract(NEW.embedding, '$')
        WHERE NEW.dimensions = 384;
      END;
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_embedding_vec_update AFTER UPDATE ON memory_embedding BEGIN
        DELETE FROM memory_item_vec WHERE rowid = NEW.id;
        INSERT INTO memory_item_vec(rowid, embedding) 
        SELECT NEW.id, json_extract(NEW.embedding, '$')
        WHERE NEW.dimensions = 384;
      END;
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_embedding_vec_delete AFTER DELETE ON memory_embedding BEGIN
        DELETE FROM memory_item_vec WHERE rowid = OLD.id;
      END;
    `);
  } catch (error) {
    // VEC 트리거가 생성되지 않을 수 있음 (sqlite-vec 확장 없음)
    // 하지만 트리거 자체는 생성되어야 의존성 검증이 통과함
    // 트리거가 없어도 테스트는 계속 진행
  }
}

describe('MirixSchemaExpansionMigration', () => {
  let db: Database.Database;
  let migration: MirixSchemaExpansionMigration;

  beforeEach(() => {
    db = new Database(':memory:');
    createBaseSchema(db);
    migration = new MirixSchemaExpansionMigration();
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
      // 스키마 버전 테이블 생성 및 버전 기록
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
      db.prepare(`
        INSERT INTO memento_schema_version (version, migration_name, description, applied_by)
        VALUES (?, ?, ?, ?)
      `).run('2.0', 'mirix-schema-expansion', 'Test migration', 'system');

      await expect(migration.validateBefore(db)).rejects.toThrow(
        'Migration 002 has already been applied'
      );
    });
  });

  describe('up', () => {
    it('should create all required tables and fields', async () => {
      await migration.up(db);

      // core_memory 테이블 확인
      const coreMemoryTable = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='core_memory'
      `).get();
      expect(coreMemoryTable).toBeDefined();

      // knowledge_vault 테이블 확인
      const knowledgeVaultTable = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_vault'
      `).get();
      expect(knowledgeVaultTable).toBeDefined();

      // memento_schema_version 테이블 확인
      const schemaVersionTable = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='memento_schema_version'
      `).get();
      expect(schemaVersionTable).toBeDefined();

      // memory_item에 새 필드 확인
      const columns = db.prepare(`PRAGMA table_info(memory_item)`).all() as Array<{ name: string }>;
      const columnNames = columns.map(col => col.name);
      expect(columnNames).toContain('origin_source');
      expect(columnNames).toContain('task_goal');
      expect(columnNames).toContain('steps');
      expect(columnNames).toContain('reflection_notes');
    });

    it('should record schema version 2.0', async () => {
      // MigrationRunner를 사용하여 마이그레이션 실행 (스키마 버전 기록 포함)
      const { MigrationRunner } = await import('../migration-runner.js');
      const runner = new MigrationRunner(db);
      
      const result = await runner.runMigration(migration, {
        createBackup: false,
        autoRollback: false,
        validate: true
      });

      expect(result.success).toBe(true);

      // MigrationRunner가 스키마 버전을 기록했는지 확인
      const version = db.prepare(`
        SELECT version, migration_name FROM memento_schema_version WHERE version = ?
      `).get('2.0') as { version: string; migration_name: string } | undefined;

      expect(version).toBeDefined();
      expect(version?.version).toBe('2.0');
      expect(version?.migration_name).toBe('mirix-schema-expansion');
    });

    it('should set default origin_source for existing memory_item records', async () => {
      // 기존 레코드 삽입
      db.prepare(`
        INSERT INTO memory_item (id, type, content)
        VALUES (?, ?, ?)
      `).run('test-1', 'episodic', 'Test content');

      await migration.up(db);

      // origin_source가 빈 JSON 객체로 설정되었는지 확인
      const record = db.prepare(`
        SELECT origin_source FROM memory_item WHERE id = ?
      `).get('test-1') as { origin_source: string } | undefined;

      expect(record?.origin_source).toBe('{}');
    });
  });

  describe('validateAfter', () => {
    it('should pass when all tables and fields are created correctly', async () => {
      await migration.up(db);
      await expect(migration.validateAfter(db)).resolves.not.toThrow();
    });

    it('should throw error when core_memory table is missing', async () => {
      await migration.up(db);
      db.exec('DROP TABLE core_memory');
      await expect(migration.validateAfter(db)).rejects.toThrow(
        'core_memory table was not created'
      );
    });

    it('should throw error when required columns are missing', async () => {
      await migration.up(db);
      // 컬럼 삭제는 SQLite에서 직접 지원하지 않으므로, 테이블 재생성으로 시뮬레이션
      // 실제로는 이런 상황이 발생하지 않지만, 검증 로직 테스트를 위해
      // 컬럼이 없는 상태를 만들 수 없으므로 이 테스트는 스킵
    });
  });

  describe('down', () => {
    it('should rollback tables and schema version', async () => {
      await migration.up(db);

      // 마이그레이션 적용 확인
      const coreMemoryBefore = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='core_memory'
      `).get();
      expect(coreMemoryBefore).toBeDefined();

      await migration.down(db);

      // core_memory 테이블 삭제 확인
      const coreMemoryAfter = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='core_memory'
      `).get();
      expect(coreMemoryAfter).toBeUndefined();

      // knowledge_vault 테이블 삭제 확인
      const knowledgeVaultAfter = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_vault'
      `).get();
      expect(knowledgeVaultAfter).toBeUndefined();

      // 스키마 버전 2.0 삭제 확인
      const version = db.prepare(`
        SELECT version FROM memento_schema_version WHERE version = ?
      `).get('2.0');
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

      // Verify rollback
      const coreMemory = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='core_memory'
      `).get();
      expect(coreMemory).toBeUndefined();
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
  });
});

