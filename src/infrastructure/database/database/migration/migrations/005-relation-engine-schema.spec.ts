import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { RelationEngineSchemaMigration } from '../005-relation-engine-schema.js';

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

/**
 * memory_link 테이블 생성 (마이그레이션 테스트용)
 */
function createMemoryLinkTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_link (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT CHECK (relation_type IN ('cause_of', 'derived_from', 'duplicates', 'contradicts')) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (source_id) REFERENCES memory_item(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES memory_item(id) ON DELETE CASCADE,
      UNIQUE(source_id, target_id, relation_type)
    );
  `);
}

describe('RelationEngineSchemaMigration', () => {
  let db: Database.Database;
  let migration: RelationEngineSchemaMigration;

  beforeEach(() => {
    db = new Database(':memory:');
    migration = new RelationEngineSchemaMigration();
  });

  afterEach(() => {
    db.close();
  });

  describe('validateBefore', () => {
    it('should pass validation when memory_item table exists', async () => {
      // Given: memory_item 테이블이 존재하는 경우
      createBaseSchema(db);

      // When/Then: 검증이 통과해야 함
      await expect(migration.validateBefore(db)).resolves.not.toThrow();
    });

    it('should throw error when memory_item table does not exist', async () => {
      // Given: memory_item 테이블이 없는 경우
      // (기본 스키마 생성 안 함)

      // When/Then: 에러가 발생해야 함
      await expect(migration.validateBefore(db)).rejects.toThrow(
        'memory_item table does not exist'
      );
    });

    it('should throw error when migration has already been applied', async () => {
      // Given: 마이그레이션이 이미 적용된 경우
      createBaseSchema(db);
      db.prepare(`
        INSERT INTO memento_schema_version (version, migration_name)
        VALUES ('5.0', 'relation-engine-schema')
      `).run();

      // When/Then: 에러가 발생해야 함
      await expect(migration.validateBefore(db)).rejects.toThrow(
        'Migration 005 has already been applied'
      );
    });

    it('should throw error when memory_relation table already exists', async () => {
      // Given: memory_relation 테이블이 이미 존재하는 경우
      createBaseSchema(db);
      db.exec(`
        CREATE TABLE memory_relation (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          relation_type TEXT NOT NULL
        )
      `);

      // When/Then: 에러가 발생해야 함
      await expect(migration.validateBefore(db)).rejects.toThrow(
        'memory_relation table already exists'
      );
    });
  });

  describe('up', () => {
    it('should create memory_relation and relation_type_registry tables', async () => {
      // Given: 기본 스키마가 있는 경우
      createBaseSchema(db);

      // When: 마이그레이션 실행
      await migration.up(db);

      // Then: 테이블이 생성되어야 함
      const relationTable = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='memory_relation'
      `).get() as { name: string } | undefined;
      expect(relationTable).toBeDefined();

      const registryTable = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='relation_type_registry'
      `).get() as { name: string } | undefined;
      expect(registryTable).toBeDefined();
    });

    it('should create all required indexes', async () => {
      // Given: 기본 스키마가 있는 경우
      createBaseSchema(db);

      // When: 마이그레이션 실행
      await migration.up(db);

      // Then: 모든 인덱스가 생성되어야 함
      const indexes = [
        'idx_memory_relation_source',
        'idx_memory_relation_target',
        'idx_memory_relation_type',
        'idx_memory_relation_confidence',
        'idx_memory_relation_source_type',
        'idx_memory_relation_target_type',
        'idx_relation_type_registry_category'
      ];

      for (const indexName of indexes) {
        const index = db.prepare(`
          SELECT name FROM sqlite_master WHERE type='index' AND name=?
        `).get(indexName) as { name: string } | undefined;
        expect(index).toBeDefined();
      }
    });

    it('should insert initial relation types into registry', async () => {
      // Given: 기본 스키마가 있는 경우
      createBaseSchema(db);

      // When: 마이그레이션 실행
      await migration.up(db);

      // Then: 6가지 관계 유형이 삽입되어야 함
      const relationTypes = db.prepare(`
        SELECT type_name FROM relation_type_registry
      `).all() as Array<{ type_name: string }>;

      const expectedTypes = ['CAUSES', 'DEPENDS_ON', 'FOLLOWS', 'CONTRASTS_WITH', 'REFERENCES', 'BELONGS_TO'];
      const actualTypes = relationTypes.map(r => r.type_name);

      for (const expectedType of expectedTypes) {
        expect(actualTypes).toContain(expectedType);
      }
    });

    it('should migrate memory_link data to memory_relation', async () => {
      // Given: memory_link 테이블에 데이터가 있는 경우
      createBaseSchema(db);
      createMemoryLinkTable(db);

      // 테스트 데이터 삽입
      db.prepare(`
        INSERT INTO memory_item (id, type, content) VALUES
        ('mem1', 'episodic', 'Memory 1'),
        ('mem2', 'episodic', 'Memory 2'),
        ('mem3', 'semantic', 'Memory 3')
      `).run();

      db.prepare(`
        INSERT INTO memory_link (source_id, target_id, relation_type, created_at) VALUES
        ('mem1', 'mem2', 'cause_of', '2025-01-01 00:00:00'),
        ('mem2', 'mem3', 'derived_from', '2025-01-01 00:00:00'),
        ('mem1', 'mem3', 'contradicts', '2025-01-01 00:00:00'),
        ('mem2', 'mem1', 'duplicates', '2025-01-01 00:00:00') -- 매핑되지 않음, 건너뜀
      `).run();

      // When: 마이그레이션 실행
      await migration.up(db);

      // Then: memory_relation에 3개의 관계가 마이그레이션되어야 함 (duplicates 제외)
      const relations = db.prepare(`
        SELECT source_id, target_id, relation_type, confidence, metadata
        FROM memory_relation
      `).all() as Array<{
        source_id: string;
        target_id: string;
        relation_type: string;
        confidence: number;
        metadata: string;
      }>;

      expect(relations).toHaveLength(3);

      // 매핑 검증
      const causesRelation = relations.find(r => r.relation_type === 'CAUSES');
      expect(causesRelation).toBeDefined();
      expect(causesRelation?.source_id).toBe('mem1');
      expect(causesRelation?.target_id).toBe('mem2');
      expect(causesRelation?.confidence).toBe(0.7);

      const dependsRelation = relations.find(r => r.relation_type === 'DEPENDS_ON');
      expect(dependsRelation).toBeDefined();
      expect(dependsRelation?.source_id).toBe('mem2');
      expect(dependsRelation?.target_id).toBe('mem3');

      const contrastsRelation = relations.find(r => r.relation_type === 'CONTRASTS_WITH');
      expect(contrastsRelation).toBeDefined();
      expect(contrastsRelation?.source_id).toBe('mem1');
      expect(contrastsRelation?.target_id).toBe('mem3');

      // 메타데이터 검증
      const metadata = JSON.parse(causesRelation!.metadata);
      expect(metadata.extraction_method).toBe('migration');
      expect(metadata.migration_source).toBe('memory_link');
      expect(metadata.original_relation_type).toBe('cause_of');
    });

    it('should handle duplicate relations during migration', async () => {
      // Given: 중복된 관계가 있는 경우
      createBaseSchema(db);
      createMemoryLinkTable(db);

      db.prepare(`
        INSERT INTO memory_item (id, type, content) VALUES
        ('mem1', 'episodic', 'Memory 1'),
        ('mem2', 'episodic', 'Memory 2')
      `).run();

      db.prepare(`
        INSERT INTO memory_link (source_id, target_id, relation_type) VALUES
        ('mem1', 'mem2', 'cause_of')
      `).run();

      // When: 마이그레이션 실행
      await migration.up(db);

      // Then: 첫 번째 관계가 삽입됨
      let relations = db.prepare(`
        SELECT COUNT(*) as count FROM memory_relation
      `).get() as { count: number };
      expect(relations.count).toBe(1);

      // When: 같은 관계를 다시 마이그레이션 시도 (중복)
      // (실제로는 마이그레이션이 한 번만 실행되지만, 테스트를 위해 직접 삽입)
      const insertStmt = db.prepare(`
        INSERT INTO memory_relation (source_id, target_id, relation_type, confidence)
        VALUES (?, ?, ?, ?)
      `);

      // Then: UNIQUE 제약으로 인해 에러가 발생해야 함
      expect(() => {
        insertStmt.run('mem1', 'mem2', 'CAUSES', 0.7);
      }).toThrow();
    });
  });

  describe('down', () => {
    it('should drop tables and indexes', async () => {
      // Given: 마이그레이션이 적용된 상태
      createBaseSchema(db);
      await migration.up(db);

      // When: 롤백 실행
      await migration.down(db);

      // Then: 테이블과 인덱스가 삭제되어야 함
      const relationTable = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='memory_relation'
      `).get();
      expect(relationTable).toBeUndefined();

      const registryTable = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='relation_type_registry'
      `).get();
      expect(registryTable).toBeUndefined();
    });
  });

  describe('validateAfter', () => {
    it('should pass validation when migration is successful', async () => {
      // Given: 마이그레이션이 성공적으로 실행된 경우
      createBaseSchema(db);
      await migration.up(db);

      // When/Then: 검증이 통과해야 함
      await expect(migration.validateAfter(db)).resolves.not.toThrow();
    });

    it('should verify table structure', async () => {
      // Given: 마이그레이션이 실행된 경우
      createBaseSchema(db);
      await migration.up(db);

      // When: 검증 실행
      await migration.validateAfter(db);

      // Then: 테이블 구조가 올바르게 생성되었는지 확인
      const relationColumns = db.prepare(`PRAGMA table_info(memory_relation)`).all() as Array<{
        name: string;
      }>;
      const relationColumnNames = relationColumns.map(col => col.name);

      expect(relationColumnNames).toContain('id');
      expect(relationColumnNames).toContain('source_id');
      expect(relationColumnNames).toContain('target_id');
      expect(relationColumnNames).toContain('relation_type');
      expect(relationColumnNames).toContain('confidence');
      expect(relationColumnNames).toContain('created_at');
      expect(relationColumnNames).toContain('updated_at');
      expect(relationColumnNames).toContain('metadata');
    });

    it('should verify UNIQUE constraint', async () => {
      // Given: 마이그레이션이 실행된 경우
      createBaseSchema(db);
      await migration.up(db);

      // When: 검증 실행
      await migration.validateAfter(db);

      // Then: UNIQUE 제약이 존재하는지 확인 (실제로는 테이블 생성 시 포함됨)
      const tableInfo = db.prepare(`
        SELECT sql FROM sqlite_master WHERE type='table' AND name='memory_relation'
      `).get() as { sql: string } | undefined;

      expect(tableInfo?.sql).toContain('UNIQUE(source_id, target_id, relation_type)');
    });

    it('should verify foreign key constraints', async () => {
      // Given: 마이그레이션이 실행된 경우
      createBaseSchema(db);
      await migration.up(db);

      // When: 검증 실행
      await migration.validateAfter(db);

      // Then: 외래 키 제약이 존재하는지 확인
      const tableInfo = db.prepare(`
        SELECT sql FROM sqlite_master WHERE type='table' AND name='memory_relation'
      `).get() as { sql: string } | undefined;

      expect(tableInfo?.sql).toContain('FOREIGN KEY');
      expect(tableInfo?.sql).toContain('ON DELETE CASCADE');
    });
  });

  describe('Integration Tests', () => {
    it('should rollback migration successfully', async () => {
      // Given: 마이그레이션이 적용된 상태
      createBaseSchema(db);
      await migration.up(db);

      // 데이터 삽입
      db.prepare(`
        INSERT INTO memory_item (id, type, content) VALUES
        ('mem1', 'episodic', 'Memory 1'),
        ('mem2', 'episodic', 'Memory 2')
      `).run();

      db.prepare(`
        INSERT INTO memory_relation (source_id, target_id, relation_type, confidence)
        VALUES ('mem1', 'mem2', 'CAUSES', 0.8)
      `).run();

      // When: 롤백 실행
      await migration.down(db);

      // Then: 테이블이 삭제되어야 함
      const relationTable = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='memory_relation'
      `).get();
      expect(relationTable).toBeUndefined();

      // Then: 스키마 버전이 제거되어야 함
      const version = db.prepare(`
        SELECT version FROM memento_schema_version WHERE version = '5.0'
      `).get();
      expect(version).toBeUndefined();
    });

    it('should maintain data integrity after rollback and re-migration', async () => {
      // Given: 마이그레이션 적용 후 롤백
      createBaseSchema(db);
      await migration.up(db);
      await migration.down(db);

      // When: 다시 마이그레이션 실행
      await migration.up(db);

      // Then: 테이블이 다시 생성되어야 함
      const relationTable = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='memory_relation'
      `).get() as { name: string } | undefined;
      expect(relationTable).toBeDefined();

      // Then: 관계 유형 레지스트리가 다시 생성되어야 함
      const relationTypes = db.prepare(`
        SELECT COUNT(*) as count FROM relation_type_registry
      `).get() as { count: number };
      expect(relationTypes.count).toBe(6);
    });

    it('should validate dependencies after migration', async () => {
      // Given: 기본 스키마와 의존성 테이블이 있는 경우
      createBaseSchema(db);

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

      // When: 마이그레이션 실행
      await migration.up(db);

      // Then: 의존성 검증이 통과해야 함
      await expect(migration.validateAfter(db)).resolves.not.toThrow();
    });

    it('should handle foreign key cascade deletion', async () => {
      // Given: 마이그레이션이 적용되고 관계가 있는 경우
      createBaseSchema(db);
      await migration.up(db);

      db.prepare(`
        INSERT INTO memory_item (id, type, content) VALUES
        ('mem1', 'episodic', 'Memory 1'),
        ('mem2', 'episodic', 'Memory 2')
      `).run();

      db.prepare(`
        INSERT INTO memory_relation (source_id, target_id, relation_type, confidence)
        VALUES ('mem1', 'mem2', 'CAUSES', 0.8)
      `).run();

      // When: 소스 메모리 삭제
      db.prepare('DELETE FROM memory_item WHERE id = ?').run('mem1');

      // Then: 관계도 함께 삭제되어야 함 (CASCADE)
      const relations = db.prepare(`
        SELECT COUNT(*) as count FROM memory_relation WHERE source_id = 'mem1'
      `).get() as { count: number };
      expect(relations.count).toBe(0);
    });

    it('should handle multiple migrations in sequence', async () => {
      // Given: 기본 스키마
      createBaseSchema(db);

      // When: 마이그레이션 실행
      await migration.up(db);

      // Then: 첫 번째 마이그레이션 성공
      let relationTable = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='memory_relation'
      `).get() as { name: string } | undefined;
      expect(relationTable).toBeDefined();

      // When: 롤백 후 다시 실행
      await migration.down(db);
      await migration.up(db);

      // Then: 두 번째 마이그레이션도 성공
      relationTable = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='memory_relation'
      `).get() as { name: string } | undefined;
      expect(relationTable).toBeDefined();
    });
  });
});
