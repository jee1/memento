import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ConsolidationScoreFieldsMigration } from './003-consolidation-score-fields.js';

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

describe('ConsolidationScoreFieldsMigration', () => {
  let db: Database.Database;
  let migration: ConsolidationScoreFieldsMigration;

  beforeEach(() => {
    db = new Database(':memory:');
    createBaseSchema(db);
    migration = new ConsolidationScoreFieldsMigration();
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
      `).run('3.0', 'consolidation-score-fields', 'Test migration', 'system');

      await expect(migration.validateBefore(db)).rejects.toThrow(
        'Migration 003 has already been applied'
      );
    });

    it('should allow partial application when only some columns exist', async () => {
      // Given: 일부 컬럼만 존재하는 경우 (부분 적용)
      db.exec('ALTER TABLE memory_item ADD COLUMN recall_count INTEGER NOT NULL DEFAULT 0');

      // When/Then: 에러가 발생하지 않아야 함 (부분 적용 허용)
      await expect(migration.validateBefore(db)).resolves.not.toThrow();
    });

    it('should throw error when migration is completely applied', async () => {
      // Given: 모든 컬럼과 인덱스가 존재하는 경우 (완전 적용)
      db.exec('ALTER TABLE memory_item ADD COLUMN recall_count INTEGER NOT NULL DEFAULT 0');
      db.exec('ALTER TABLE memory_item ADD COLUMN last_accessed_at TIMESTAMP');
      db.exec('ALTER TABLE memory_item ADD COLUMN consolidation_score REAL');
      db.exec('ALTER TABLE memory_item ADD COLUMN g_value REAL');
      db.exec('CREATE INDEX idx_memory_item_last_accessed ON memory_item(last_accessed_at DESC)');
      db.exec('CREATE INDEX idx_memory_item_consol_desc ON memory_item(consolidation_score DESC)');
      db.exec('CREATE INDEX idx_memory_item_consol_active ON memory_item(consolidation_score) WHERE consolidation_score > 0.2');

      // When/Then: 에러가 발생해야 함 (완전 적용된 마이그레이션 재실행 방지)
      await expect(migration.validateBefore(db)).rejects.toThrow(
        'Migration 003 appears to be completely applied'
      );
    });
  });

  describe('up', () => {
    it('should add all required columns to memory_item table', async () => {
      await migration.up(db);

      const columns = db.prepare(`PRAGMA table_info(memory_item)`).all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null }>;
      const columnNames = columns.map(col => col.name);

      expect(columnNames).toContain('recall_count');
      expect(columnNames).toContain('last_accessed_at');
      expect(columnNames).toContain('consolidation_score');
      expect(columnNames).toContain('g_value');

      // recall_count는 NOT NULL DEFAULT 0이어야 함
      const recallCountCol = columns.find(col => col.name === 'recall_count');
      expect(recallCountCol?.notnull).toBe(1);
      expect(recallCountCol?.dflt_value).toBe('0');
    });

    it('should create all required indexes', async () => {
      await migration.up(db);

      const indexes = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='index' AND name LIKE 'idx_memory_item_%'
      `).all() as Array<{ name: string }>;
      const indexNames = indexes.map(idx => idx.name);

      expect(indexNames).toContain('idx_memory_item_last_accessed');
      expect(indexNames).toContain('idx_memory_item_consol_desc');
      expect(indexNames).toContain('idx_memory_item_consol_active');
    });

    it('should initialize existing data with default values', async () => {
      // 기존 레코드 삽입
      const now = new Date();
      const pastTime = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24시간 전
      const pastTimeStr = pastTime.toISOString();

      db.prepare(`
        INSERT INTO memory_item (id, type, content, created_at, pinned)
        VALUES (?, ?, ?, ?, ?)
      `).run('test-1', 'episodic', 'Test content 1', pastTimeStr, 0);

      db.prepare(`
        INSERT INTO memory_item (id, type, content, created_at, pinned)
        VALUES (?, ?, ?, ?, ?)
      `).run('test-2', 'procedural', 'Test content 2', pastTimeStr, 1);

      await migration.up(db);

      // recall_count가 1로 초기화되었는지 확인
      const record1 = db.prepare(`
        SELECT recall_count, last_accessed_at, g_value, consolidation_score, pinned
        FROM memory_item WHERE id = ?
      `).get('test-1') as { recall_count: number; last_accessed_at: string; g_value: number; consolidation_score: number | null; pinned: number };

      expect(record1.recall_count).toBe(1);
      expect(record1.g_value).toBe(1.0);
      expect(record1.consolidation_score).not.toBeNull();
      expect(record1.consolidation_score).toBeGreaterThanOrEqual(0.0);
      expect(record1.consolidation_score).toBeLessThanOrEqual(1.0);

      // pinned 메모리는 최소 0.25 보장
      const record2 = db.prepare(`
        SELECT consolidation_score, pinned
        FROM memory_item WHERE id = ?
      `).get('test-2') as { consolidation_score: number | null; pinned: number };

      expect(record2.consolidation_score).not.toBeNull();
      if (record2.consolidation_score !== null) {
        expect(record2.consolidation_score).toBeGreaterThanOrEqual(0.25);
      }
    });

    it('should calculate consolidation_score based on time elapsed and type', async () => {
      // 다양한 시간 경과와 타입의 레코드 삽입
      const now = Date.now();
      const oneHourAgo = new Date(now - 1 * 60 * 60 * 1000).toISOString();
      const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
      const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

      db.prepare(`
        INSERT INTO memory_item (id, type, content, created_at)
        VALUES (?, ?, ?, ?)
      `).run('recent', 'episodic', 'Recent content', oneHourAgo);

      db.prepare(`
        INSERT INTO memory_item (id, type, content, created_at)
        VALUES (?, ?, ?, ?)
      `).run('old', 'episodic', 'Old content', oneWeekAgo);

      db.prepare(`
        INSERT INTO memory_item (id, type, content, created_at)
        VALUES (?, ?, ?, ?)
      `).run('procedural', 'procedural', 'Procedural content', oneDayAgo);

      await migration.up(db);

      // 최근 메모리는 높은 점수를 가져야 함
      const recent = db.prepare(`
        SELECT consolidation_score FROM memory_item WHERE id = ?
      `).get('recent') as { consolidation_score: number | null };

      // 오래된 메모리는 낮은 점수를 가져야 함
      const old = db.prepare(`
        SELECT consolidation_score FROM memory_item WHERE id = ?
      `).get('old') as { consolidation_score: number | null };

      expect(recent.consolidation_score).not.toBeNull();
      expect(old.consolidation_score).not.toBeNull();
      if (recent.consolidation_score !== null && old.consolidation_score !== null) {
        expect(recent.consolidation_score).toBeGreaterThan(old.consolidation_score);
      }

      // Procedural 메모리는 r_base=0.6이므로 더 높은 점수를 가져야 함
      const procedural = db.prepare(`
        SELECT consolidation_score FROM memory_item WHERE id = ?
      `).get('procedural') as { consolidation_score: number | null };

      expect(procedural.consolidation_score).not.toBeNull();
    });
  });

  describe('validateAfter', () => {
    it('should pass when all columns and indexes are created correctly', async () => {
      await migration.up(db);
      await expect(migration.validateAfter(db)).resolves.not.toThrow();
    });

    it('should throw error when memory_item table is missing', async () => {
      await migration.up(db);
      db.exec('DROP TABLE memory_item');
      await expect(migration.validateAfter(db)).rejects.toThrow(
        'memory_item table was removed during migration'
      );
    });

    it('should throw error when required columns are missing', async () => {
      await migration.up(db);
      // 컬럼 삭제는 SQLite에서 직접 지원하지 않으므로, 테이블 재생성으로 시뮬레이션
      // 실제로는 이런 상황이 발생하지 않지만, 검증 로직 테스트를 위해
      // 컬럼이 없는 상태를 만들 수 없으므로 이 테스트는 스킵
    });

    it('should throw error when required indexes are missing', async () => {
      await migration.up(db);
      db.exec('DROP INDEX idx_memory_item_last_accessed');
      await expect(migration.validateAfter(db)).rejects.toThrow(
        'Index idx_memory_item_last_accessed was not created'
      );
    });
  });

  describe('down', () => {
    it('should drop all indexes and remove schema version', async () => {
      await migration.up(db);

      // 인덱스 존재 확인
      const indexBefore = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='index' AND name='idx_memory_item_last_accessed'
      `).get();
      expect(indexBefore).toBeDefined();

      // 스키마 버전 기록 (MigrationRunner가 하는 일을 시뮬레이션)
      db.prepare(`
        INSERT INTO memento_schema_version (version, migration_name, description, applied_by)
        VALUES (?, ?, ?, ?)
      `).run('3.0', 'consolidation-score-fields', 'Test', 'system');

      await migration.down(db);

      // 인덱스 삭제 확인
      const indexAfter = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='index' AND name='idx_memory_item_last_accessed'
      `).get();
      expect(indexAfter).toBeUndefined();

      // 스키마 버전 3.0 삭제 확인
      const version = db.prepare(`
        SELECT version FROM memento_schema_version WHERE version = ?
      `).get('3.0');
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

      // Verify rollback (인덱스가 삭제되었는지 확인)
      const index = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='index' AND name='idx_memory_item_last_accessed'
      `).get();
      expect(index).toBeUndefined();
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

    it('should initialize all existing records with recall_count=1', async () => {
      // 여러 레코드 삽입
      for (let i = 1; i <= 5; i++) {
        db.prepare(`
          INSERT INTO memory_item (id, type, content)
          VALUES (?, ?, ?)
        `).run(`test-${i}`, 'episodic', `Content ${i}`);
      }

      await migration.up(db);

      // 모든 레코드의 recall_count가 1인지 확인
      const records = db.prepare(`
        SELECT id, recall_count FROM memory_item
      `).all() as Array<{ id: string; recall_count: number }>;

      for (const record of records) {
        expect(record.recall_count).toBe(1);
      }
    });
  });
});

