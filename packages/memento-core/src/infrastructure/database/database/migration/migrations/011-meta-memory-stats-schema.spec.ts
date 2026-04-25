import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MetaMemoryStatsSchemaMigration } from './011-meta-memory-stats-schema.js';

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
      reflection_notes TEXT,
          project_id TEXT,
          is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
          deleted_at TEXT
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

describe('MetaMemoryStatsSchemaMigration', () => {
  let db: Database.Database;
  let migration: MetaMemoryStatsSchemaMigration;

  beforeEach(() => {
    db = new Database(':memory:');
    createBaseSchema(db);
    migration = new MetaMemoryStatsSchemaMigration();
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe('validateBefore', () => {
    it('given: memory_item 테이블이 존재할 때, when: validateBefore를 호출하면, then: 에러가 발생하지 않아야 함', async () => {
      await expect(migration.validateBefore(db)).resolves.not.toThrow();
    });

    it('given: memory_item 테이블이 존재하지 않을 때, when: validateBefore를 호출하면, then: 에러가 발생해야 함', async () => {
      const emptyDb = new Database(':memory:');
      await expect(migration.validateBefore(emptyDb)).rejects.toThrow(
        'memory_item table does not exist'
      );
      emptyDb.close();
    });

    it('given: 마이그레이션이 이미 적용된 경우, when: validateBefore를 호출하면, then: 에러가 발생해야 함', async () => {
      db.prepare(`
        INSERT INTO memento_schema_version (version, migration_name, description, applied_by)
        VALUES (?, ?, ?, ?)
      `).run('11.0', 'meta-memory-stats-schema', 'Test migration', 'system');

      await expect(migration.validateBefore(db)).rejects.toThrow(
        'Migration 011 has already been applied'
      );
    });

    it('given: meta_memory_stats 테이블이 이미 존재하는 경우, when: validateBefore를 호출하면, then: 에러가 발생해야 함', async () => {
      // meta_memory_stats 테이블을 수동으로 생성
      db.exec(`
        CREATE TABLE meta_memory_stats (
          memory_id TEXT PRIMARY KEY,
          recall_count INTEGER DEFAULT 0
        )
      `);

      await expect(migration.validateBefore(db)).rejects.toThrow(
        'meta_memory_stats table already exists'
      );
    });
  });

  describe('up', () => {
    it('given: 마이그레이션 SQL 파일이 존재할 때, when: up을 실행하면, then: meta_memory_stats 테이블이 생성되어야 함', async () => {
      await migration.up(db);

      const table = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='meta_memory_stats'
      `).get() as { name: string } | undefined;

      expect(table).toBeDefined();
      expect(table?.name).toBe('meta_memory_stats');
    });

    it('given: 마이그레이션 SQL 파일이 존재할 때, when: up을 실행하면, then: 모든 필수 컬럼이 생성되어야 함', async () => {
      await migration.up(db);

      const columns = db.prepare(`PRAGMA table_info(meta_memory_stats)`).all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
      }>;
      const columnNames = columns.map((col) => col.name);

      expect(columnNames).toContain('memory_id');
      expect(columnNames).toContain('recall_count');
      expect(columnNames).toContain('success_count');
      expect(columnNames).toContain('failure_count');
      expect(columnNames).toContain('avg_confidence');
      expect(columnNames).toContain('last_recalled_at');
      expect(columnNames).toContain('created_at');
      expect(columnNames).toContain('updated_at');
    });

    it('given: 마이그레이션 SQL 파일이 존재할 때, when: up을 실행하면, then: memory_id가 PRIMARY KEY로 설정되어야 함', async () => {
      await migration.up(db);

      const columns = db.prepare(`PRAGMA table_info(meta_memory_stats)`).all() as Array<{
        name: string;
        pk: number;
      }>;
      const memoryIdCol = columns.find((col) => col.name === 'memory_id');

      expect(memoryIdCol).toBeDefined();
      expect(memoryIdCol?.pk).toBe(1);
    });

    it('given: 마이그레이션 SQL 파일이 존재할 때, when: up을 실행하면, then: 모든 필수 인덱스가 생성되어야 함', async () => {
      await migration.up(db);

      const indexes = db
        .prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='index' AND name LIKE 'idx_meta_memory_stats_%'
      `)
        .all() as Array<{ name: string }>;
      const indexNames = indexes.map((idx) => idx.name);

      expect(indexNames).toContain('idx_meta_memory_stats_recall_count');
      expect(indexNames).toContain('idx_meta_memory_stats_avg_confidence');
      expect(indexNames).toContain('idx_meta_memory_stats_last_recalled_at');
      expect(indexNames).toContain('idx_meta_memory_stats_failure_count');
    });

    it('given: 마이그레이션 SQL 파일이 존재할 때, when: up을 실행하면, then: updated_at 자동 업데이트 트리거가 생성되어야 함', async () => {
      await migration.up(db);

      const triggers = db
        .prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='trigger' AND name LIKE '%meta_memory_stats%'
      `)
        .all() as Array<{ name: string }>;
      const triggerNames = triggers.map((t) => t.name);

      expect(triggerNames.length).toBeGreaterThan(0);
      expect(
        triggerNames.some((name) => name.includes('updated_at'))
      ).toBe(true);
    });

    it('given: 마이그레이션 SQL 파일이 존재할 때, when: up을 실행하면, then: FOREIGN KEY 제약조건이 설정되어야 함', async () => {
      await migration.up(db);

      // SQLite에서 FOREIGN KEY 제약조건 확인
      const foreignKeys = db
        .prepare(`PRAGMA foreign_key_list(meta_memory_stats)`)
        .all() as Array<{ table: string; from: string; to: string }>;

      expect(foreignKeys.length).toBeGreaterThan(0);
      const memoryIdFk = foreignKeys.find((fk) => fk.from === 'memory_id');
      expect(memoryIdFk).toBeDefined();
      expect(memoryIdFk?.table).toBe('memory_item');
      expect(memoryIdFk?.to).toBe('id');
    });
  });

  describe('validateAfter', () => {
    it('given: 마이그레이션이 실행된 후, when: validateAfter를 호출하면, then: 에러가 발생하지 않아야 함', async () => {
      await migration.up(db);
      await expect(migration.validateAfter(db)).resolves.not.toThrow();
    });

    it('given: meta_memory_stats 테이블이 삭제된 경우, when: validateAfter를 호출하면, then: 에러가 발생해야 함', async () => {
      await migration.up(db);
      db.exec('DROP TABLE meta_memory_stats');

      await expect(migration.validateAfter(db)).rejects.toThrow(
        'meta_memory_stats table was not created'
      );
    });

    it('given: 필수 인덱스가 누락된 경우, when: validateAfter를 호출하면, then: 에러가 발생해야 함', async () => {
      await migration.up(db);
      db.exec('DROP INDEX idx_meta_memory_stats_recall_count');

      await expect(migration.validateAfter(db)).rejects.toThrow(
        'Index idx_meta_memory_stats_recall_count was not created'
      );
    });
  });

  describe('down', () => {
    it('given: 마이그레이션이 실행된 후, when: down을 실행하면, then: meta_memory_stats 테이블이 삭제되어야 함', async () => {
      await migration.up(db);

      // 스키마 버전 기록 (MigrationRunner가 하는 일을 시뮬레이션)
      db.prepare(`
        INSERT INTO memento_schema_version (version, migration_name, description, applied_by)
        VALUES (?, ?, ?, ?)
      `).run('11.0', 'meta-memory-stats-schema', 'Test', 'system');

      await migration.down(db);

      const table = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='meta_memory_stats'
      `).get();
      expect(table).toBeUndefined();
    });

    it('given: 마이그레이션이 실행된 후, when: down을 실행하면, then: 모든 인덱스가 삭제되어야 함', async () => {
      await migration.up(db);

      db.prepare(`
        INSERT INTO memento_schema_version (version, migration_name, description, applied_by)
        VALUES (?, ?, ?, ?)
      `).run('11.0', 'meta-memory-stats-schema', 'Test', 'system');

      await migration.down(db);

      const indexes = db
        .prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='index' AND name LIKE 'idx_meta_memory_stats_%'
      `)
        .all();
      expect(indexes.length).toBe(0);
    });
  });

  describe('상세 검증 테스트', () => {
    it('given: 마이그레이션 실행 후, when: 각 필드의 타입을 확인하면, then: 모든 필드가 올바른 타입이어야 함', async () => {
      await migration.up(db);

      const columns = db.prepare(`PRAGMA table_info(meta_memory_stats)`).all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
      }>;

      const memoryIdCol = columns.find((col) => col.name === 'memory_id');
      expect(memoryIdCol?.type.toUpperCase()).toContain('TEXT');

      const recallCountCol = columns.find((col) => col.name === 'recall_count');
      expect(recallCountCol?.type.toUpperCase()).toContain('INTEGER');

      const successCountCol = columns.find((col) => col.name === 'success_count');
      expect(successCountCol?.type.toUpperCase()).toContain('INTEGER');

      const failureCountCol = columns.find((col) => col.name === 'failure_count');
      expect(failureCountCol?.type.toUpperCase()).toContain('INTEGER');

      const avgConfidenceCol = columns.find((col) => col.name === 'avg_confidence');
      expect(avgConfidenceCol?.type.toUpperCase()).toContain('REAL');

      const lastRecalledAtCol = columns.find((col) => col.name === 'last_recalled_at');
      expect(lastRecalledAtCol?.type.toUpperCase()).toContain('TIMESTAMP');

      const createdAtCol = columns.find((col) => col.name === 'created_at');
      expect(createdAtCol?.type.toUpperCase()).toContain('TIMESTAMP');

      const updatedAtCol = columns.find((col) => col.name === 'updated_at');
      expect(updatedAtCol?.type.toUpperCase()).toContain('TIMESTAMP');
    });

    it('given: 마이그레이션 실행 후, when: 각 필드의 NOT NULL 제약조건을 확인하면, then: 필수 필드가 올바르게 설정되어야 함', async () => {
      await migration.up(db);

      const columns = db.prepare(`PRAGMA table_info(meta_memory_stats)`).all() as Array<{
        name: string;
        notnull: number;
        pk: number;
      }>;

      // PRIMARY KEY는 pk 필드로 확인 (SQLite에서 PRIMARY KEY는 자동으로 NOT NULL)
      const memoryIdCol = columns.find((col) => col.name === 'memory_id');
      expect(memoryIdCol?.pk).toBe(1); // PRIMARY KEY 확인

      const recallCountCol = columns.find((col) => col.name === 'recall_count');
      expect(recallCountCol?.notnull).toBe(1);

      const successCountCol = columns.find((col) => col.name === 'success_count');
      expect(successCountCol?.notnull).toBe(1);

      const failureCountCol = columns.find((col) => col.name === 'failure_count');
      expect(failureCountCol?.notnull).toBe(1);

      const avgConfidenceCol = columns.find((col) => col.name === 'avg_confidence');
      expect(avgConfidenceCol?.notnull).toBe(1);

      const createdAtCol = columns.find((col) => col.name === 'created_at');
      expect(createdAtCol?.notnull).toBe(1);

      const updatedAtCol = columns.find((col) => col.name === 'updated_at');
      expect(updatedAtCol?.notnull).toBe(1);

      // last_recalled_at은 NULL 허용
      const lastRecalledAtCol = columns.find((col) => col.name === 'last_recalled_at');
      expect(lastRecalledAtCol?.notnull).toBe(0);
    });

    it('given: 마이그레이션 실행 후, when: 각 필드의 DEFAULT 값을 확인하면, then: 기본값이 올바르게 설정되어야 함', async () => {
      await migration.up(db);

      const columns = db.prepare(`PRAGMA table_info(meta_memory_stats)`).all() as Array<{
        name: string;
        dflt_value: string | null;
      }>;

      const recallCountCol = columns.find((col) => col.name === 'recall_count');
      expect(recallCountCol?.dflt_value).toBe('0');

      const successCountCol = columns.find((col) => col.name === 'success_count');
      expect(successCountCol?.dflt_value).toBe('0');

      const failureCountCol = columns.find((col) => col.name === 'failure_count');
      expect(failureCountCol?.dflt_value).toBe('0');

      const avgConfidenceCol = columns.find((col) => col.name === 'avg_confidence');
      expect(avgConfidenceCol?.dflt_value).toBe('0.0');

      // created_at과 updated_at은 CURRENT_TIMESTAMP
      const createdAtCol = columns.find((col) => col.name === 'created_at');
      expect(createdAtCol?.dflt_value).not.toBeNull();
      expect(createdAtCol?.dflt_value?.toUpperCase()).toContain('CURRENT_TIMESTAMP');

      const updatedAtCol = columns.find((col) => col.name === 'updated_at');
      expect(updatedAtCol?.dflt_value).not.toBeNull();
      expect(updatedAtCol?.dflt_value?.toUpperCase()).toContain('CURRENT_TIMESTAMP');
    });

    it('given: 마이그레이션 실행 후, when: 인덱스 구조를 확인하면, then: 모든 인덱스가 올바른 컬럼과 정렬 방향을 가져야 함', async () => {
      await migration.up(db);

      // 인덱스 정보 확인
      const indexes = db
        .prepare(`
        SELECT name, sql FROM sqlite_master 
        WHERE type='index' AND name LIKE 'idx_meta_memory_stats_%'
      `)
        .all() as Array<{ name: string; sql: string | null }>;

      const recallCountIndex = indexes.find((idx) => idx.name === 'idx_meta_memory_stats_recall_count');
      expect(recallCountIndex).toBeDefined();
      expect(recallCountIndex?.sql?.toUpperCase()).toContain('RECALL_COUNT');
      expect(recallCountIndex?.sql?.toUpperCase()).toContain('DESC');

      const avgConfidenceIndex = indexes.find((idx) => idx.name === 'idx_meta_memory_stats_avg_confidence');
      expect(avgConfidenceIndex).toBeDefined();
      expect(avgConfidenceIndex?.sql?.toUpperCase()).toContain('AVG_CONFIDENCE');
      expect(avgConfidenceIndex?.sql?.toUpperCase()).toContain('DESC');

      const lastRecalledAtIndex = indexes.find((idx) => idx.name === 'idx_meta_memory_stats_last_recalled_at');
      expect(lastRecalledAtIndex).toBeDefined();
      expect(lastRecalledAtIndex?.sql?.toUpperCase()).toContain('LAST_RECALLED_AT');
      expect(lastRecalledAtIndex?.sql?.toUpperCase()).toContain('DESC');

      const failureCountIndex = indexes.find((idx) => idx.name === 'idx_meta_memory_stats_failure_count');
      expect(failureCountIndex).toBeDefined();
      expect(failureCountIndex?.sql?.toUpperCase()).toContain('FAILURE_COUNT');
      expect(failureCountIndex?.sql?.toUpperCase()).toContain('DESC');
    });

    it('given: 마이그레이션 실행 후 레코드가 업데이트될 때, when: updated_at 트리거를 확인하면, then: updated_at 트리거가 생성되어 있어야 함', async () => {
      await migration.up(db);

      // 트리거가 생성되었는지 확인
      const trigger = db
        .prepare(`
        SELECT name, sql FROM sqlite_master 
        WHERE type='trigger' AND name='trigger_meta_memory_stats_updated_at'
      `)
        .get() as { name: string; sql: string } | undefined;

      expect(trigger).toBeDefined();
      expect(trigger?.name).toBe('trigger_meta_memory_stats_updated_at');
      expect(trigger?.sql).toContain('AFTER UPDATE');
      expect(trigger?.sql).toContain('meta_memory_stats');
      expect(trigger?.sql).toContain('updated_at');
    });

    it('given: memory_item이 삭제될 때, when: meta_memory_stats 레코드를 확인하면, then: CASCADE 삭제가 동작해야 함', async () => {
      await migration.up(db);

      // FOREIGN KEY 제약조건 활성화 (SQLite는 기본적으로 비활성화)
      db.exec('PRAGMA foreign_keys = ON');

      // 테스트용 memory_item 생성
      db.prepare(`
        INSERT INTO memory_item (id, type, content) VALUES (?, ?, ?)
      `).run('test-memory-1', 'episodic', 'Test content');

      // meta_memory_stats 레코드 생성
      db.prepare(`
        INSERT INTO meta_memory_stats (
          memory_id, recall_count, success_count, failure_count, avg_confidence
        )
        VALUES (?, ?, ?, ?, ?)
      `).run('test-memory-1', 5, 4, 1, 0.8);

      // 레코드 존재 확인
      const before = db
        .prepare(`SELECT COUNT(*) as count FROM meta_memory_stats WHERE memory_id = ?`)
        .get('test-memory-1') as { count: number };
      expect(before.count).toBe(1);

      // memory_item 삭제
      db.prepare(`DELETE FROM memory_item WHERE id = ?`).run('test-memory-1');

      // meta_memory_stats 레코드가 CASCADE로 삭제되었는지 확인
      const after = db
        .prepare(`SELECT COUNT(*) as count FROM meta_memory_stats WHERE memory_id = ?`)
        .get('test-memory-1') as { count: number };
      expect(after.count).toBe(0);
    });
  });

  describe('CASCADE 삭제 동작 테스트', () => {
    it('given: memory_item이 삭제될 때, when: 해당 memory_id의 meta_memory_stats 레코드를 확인하면, then: 자동으로 삭제되어야 함', async () => {
      await migration.up(db);

      // FOREIGN KEY 제약조건 활성화 (SQLite는 기본적으로 비활성화)
      db.exec('PRAGMA foreign_keys = ON');

      // 테스트용 memory_item 여러 개 생성
      const memoryIds = ['test-memory-1', 'test-memory-2', 'test-memory-3'];
      for (const memoryId of memoryIds) {
        db.prepare(`
          INSERT INTO memory_item (id, type, content) VALUES (?, ?, ?)
        `).run(memoryId, 'episodic', `Test content for ${memoryId}`);

        // 각 memory_item에 대한 meta_memory_stats 레코드 생성
        db.prepare(`
          INSERT INTO meta_memory_stats (
            memory_id, recall_count, success_count, failure_count, avg_confidence
          )
          VALUES (?, ?, ?, ?, ?)
        `).run(memoryId, 10, 8, 2, 0.75);
      }

      // 모든 레코드 존재 확인
      const before = db
        .prepare(`SELECT COUNT(*) as count FROM meta_memory_stats`)
        .get() as { count: number };
      expect(before.count).toBe(3);

      // 하나의 memory_item 삭제
      db.prepare(`DELETE FROM memory_item WHERE id = ?`).run('test-memory-2');

      // 해당 memory_id의 meta_memory_stats 레코드가 자동으로 삭제되었는지 확인
      const after = db
        .prepare(`SELECT COUNT(*) as count FROM meta_memory_stats`)
        .get() as { count: number };
      expect(after.count).toBe(2);

      // 삭제된 memory_id의 레코드가 없는지 확인
      const deletedRecord = db
        .prepare(`SELECT COUNT(*) as count FROM meta_memory_stats WHERE memory_id = ?`)
        .get('test-memory-2') as { count: number };
      expect(deletedRecord.count).toBe(0);

      // 다른 memory_id의 레코드는 여전히 존재하는지 확인
      const remainingRecord1 = db
        .prepare(`SELECT COUNT(*) as count FROM meta_memory_stats WHERE memory_id = ?`)
        .get('test-memory-1') as { count: number };
      expect(remainingRecord1.count).toBe(1);

      const remainingRecord3 = db
        .prepare(`SELECT COUNT(*) as count FROM meta_memory_stats WHERE memory_id = ?`)
        .get('test-memory-3') as { count: number };
      expect(remainingRecord3.count).toBe(1);
    });
  });
});
