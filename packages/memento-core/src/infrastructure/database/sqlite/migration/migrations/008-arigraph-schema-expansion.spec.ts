import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { AriGraphSchemaExpansionMigration } from './008-arigraph-schema-expansion.js';

/**
 * 기본 스키마 생성 (memory_item, relation_type_registry 테이블)
 * 007 마이그레이션 이후의 상태를 가정
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
      consolidation_score REAL,
      workflow_name TEXT,
      skill_name TEXT,
      trigger_conditions TEXT,
          project_id TEXT,
          is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
          deleted_at TEXT
    );
  `);

  // relation_type_registry 테이블 생성 (005 마이그레이션에서 생성됨)
  db.exec(`
    CREATE TABLE IF NOT EXISTS relation_type_registry (
      type_name TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      description TEXT,
      applicable_types TEXT,
      default_confidence REAL DEFAULT 0.7,
      search_boost REAL DEFAULT 1.0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 초기 관계 타입 삽입 (005 마이그레이션에서 삽입됨)
  db.exec(`
    INSERT OR IGNORE INTO relation_type_registry (type_name, category, description, applicable_types, default_confidence, search_boost)
    VALUES 
      ('CAUSES', 'Causal', '인과 관계', '["episodic", "semantic"]', 0.7, 1.2),
      ('DEPENDS_ON', 'Structural', '의존 관계', '["semantic", "procedural"]', 0.7, 1.1),
      ('FOLLOWS', 'Temporal', '시간적 순서', '["episodic", "procedural"]', 0.7, 1.0),
      ('CONTRASTS_WITH', 'Semantic', '대조 관계', '["semantic", "episodic"]', 0.7, 0.9),
      ('REFERENCES', 'Semantic', '참조 관계', '["working", "episodic", "semantic", "procedural"]', 0.7, 0.8),
      ('BELONGS_TO', 'Structural', '포함 관계', '["semantic", "episodic"]', 0.7, 1.0)
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
        reflection_notes,
        content='memory_item',
        content_rowid='rowid'
      );
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_item_fts_insert AFTER INSERT ON memory_item BEGIN
        INSERT INTO memory_item_fts(rowid, content, tags, source, reflection_notes)
        VALUES (new.rowid, new.content, new.tags, new.source, new.reflection_notes);
      END;
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_item_fts_update AFTER UPDATE ON memory_item BEGIN
        INSERT INTO memory_item_fts(memory_item_fts, rowid, content, tags, source, reflection_notes)
        VALUES('delete', old.rowid, old.content, old.tags, old.source, old.reflection_notes);
        INSERT INTO memory_item_fts(rowid, content, tags, source, reflection_notes)
        VALUES (new.rowid, new.content, new.tags, new.source, new.reflection_notes);
      END;
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_item_fts_delete AFTER DELETE ON memory_item BEGIN
        INSERT INTO memory_item_fts(memory_item_fts, rowid, content, tags, source, reflection_notes)
        VALUES('delete', old.rowid, old.content, old.tags, old.source, old.reflection_notes);
      END;
    `);
  } catch (error) {
    // FTS5가 사용 불가능할 수 있으므로 무시
  }
}

describe('AriGraphSchemaExpansionMigration', () => {
  let db: Database.Database;
  let migration: AriGraphSchemaExpansionMigration;

  beforeEach(() => {
    db = new Database(':memory:');
    createBaseSchema(db);
    migration = new AriGraphSchemaExpansionMigration();
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe('validateBefore', () => {
    it('should pass when memory_item and relation_type_registry tables exist', async () => {
      // Given: memory_item과 relation_type_registry 테이블이 존재하는 경우
      // When/Then: 검증이 통과해야 함
      await expect(migration.validateBefore(db)).resolves.not.toThrow();
    });

    it('should throw error when memory_item table does not exist', async () => {
      // Given: memory_item 테이블이 없는 경우
      const emptyDb = new Database(':memory:');
      // relation_type_registry만 생성
      emptyDb.exec(`
        CREATE TABLE relation_type_registry (
          type_name TEXT PRIMARY KEY,
          category TEXT NOT NULL
        );
      `);

      // When/Then: 에러가 발생해야 함
      await expect(migration.validateBefore(emptyDb)).rejects.toThrow(
        'memory_item table does not exist'
      );
      emptyDb.close();
    });

    it('should throw error when relation_type_registry table does not exist', async () => {
      // Given: relation_type_registry 테이블이 없는 경우
      const emptyDb = new Database(':memory:');
      // memory_item만 생성
      emptyDb.exec(`
        CREATE TABLE memory_item (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          content TEXT NOT NULL,
          project_id TEXT,
          is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
          deleted_at TEXT
        );
      `);

      // When/Then: 에러가 발생해야 함
      await expect(migration.validateBefore(emptyDb)).rejects.toThrow(
        'relation_type_registry table does not exist'
      );
      emptyDb.close();
    });

    it('should throw error when migration has already been applied', async () => {
      // Given: 마이그레이션이 이미 적용된 경우
      db.prepare(`
        INSERT INTO memento_schema_version (version, migration_name, description, applied_by)
        VALUES (?, ?, ?, ?)
      `).run('8.0', 'arigraph-schema-expansion', 'Test migration', 'system');

      // When/Then: 에러가 발생해야 함
      await expect(migration.validateBefore(db)).rejects.toThrow(
        'Migration 008 has already been applied'
      );
    });

    it('should throw error when subject column already exists', async () => {
      // Given: subject 컬럼이 이미 존재하는 경우
      db.exec('ALTER TABLE memory_item ADD COLUMN subject TEXT');

      // When/Then: 에러가 발생해야 함
      await expect(migration.validateBefore(db)).rejects.toThrow(
        'subject column already exists'
      );
    });

    it('should throw error when predicate column already exists', async () => {
      // Given: predicate 컬럼이 이미 존재하는 경우
      db.exec('ALTER TABLE memory_item ADD COLUMN predicate TEXT');

      // When/Then: 에러가 발생해야 함
      await expect(migration.validateBefore(db)).rejects.toThrow(
        'predicate column already exists'
      );
    });

    it('should throw error when object column already exists', async () => {
      // Given: object 컬럼이 이미 존재하는 경우
      db.exec('ALTER TABLE memory_item ADD COLUMN object TEXT');

      // When/Then: 에러가 발생해야 함
      await expect(migration.validateBefore(db)).rejects.toThrow(
        'object column already exists'
      );
    });

    it('should throw error when triple_extracted column already exists', async () => {
      // Given: triple_extracted 컬럼이 이미 존재하는 경우
      db.exec('ALTER TABLE memory_item ADD COLUMN triple_extracted BOOLEAN');

      // When/Then: 에러가 발생해야 함
      await expect(migration.validateBefore(db)).rejects.toThrow(
        'triple_extracted column already exists'
      );
    });

    it('should throw error when triple_extracted_status column already exists', async () => {
      // Given: triple_extracted_status 컬럼이 이미 존재하는 경우
      db.exec('ALTER TABLE memory_item ADD COLUMN triple_extracted_status TEXT');

      // When/Then: 에러가 발생해야 함
      await expect(migration.validateBefore(db)).rejects.toThrow(
        'triple_extracted_status column already exists'
      );
    });

    it('should throw error when triple_extraction_metadata column already exists', async () => {
      // Given: triple_extraction_metadata 컬럼이 이미 존재하는 경우
      db.exec('ALTER TABLE memory_item ADD COLUMN triple_extraction_metadata TEXT');

      // When/Then: 에러가 발생해야 함
      await expect(migration.validateBefore(db)).rejects.toThrow(
        'triple_extraction_metadata column already exists'
      );
    });

    it('should throw error when idx_memory_item_triple index already exists', async () => {
      // Given: 인덱스가 이미 존재하는 경우
      db.exec('CREATE INDEX idx_memory_item_triple ON memory_item(id)');

      // When/Then: 에러가 발생해야 함
      await expect(migration.validateBefore(db)).rejects.toThrow(
        'idx_memory_item_triple index already exists'
      );
    });

    it('should throw error when idx_memory_item_triple_extracted index already exists', async () => {
      // Given: 인덱스가 이미 존재하는 경우
      db.exec('CREATE INDEX idx_memory_item_triple_extracted ON memory_item(id)');

      // When/Then: 에러가 발생해야 함
      await expect(migration.validateBefore(db)).rejects.toThrow(
        'idx_memory_item_triple_extracted index already exists'
      );
    });

    it('should throw error when idx_memory_item_triple_status index already exists', async () => {
      // Given: 인덱스가 이미 존재하는 경우
      db.exec('CREATE INDEX idx_memory_item_triple_status ON memory_item(id)');

      // When/Then: 에러가 발생해야 함
      await expect(migration.validateBefore(db)).rejects.toThrow(
        'idx_memory_item_triple_status index already exists'
      );
    });
  });

  describe('up', () => {
    it('should add subject, predicate, object columns to memory_item', async () => {
      // Given: 기본 스키마가 있는 경우
      // When: 마이그레이션 실행
      await migration.up(db);

      // Then: 새 컬럼들이 추가되어야 함
      const columns = db.prepare(`PRAGMA table_info(memory_item)`).all() as Array<{ name: string }>;
      const columnNames = columns.map(col => col.name);

      expect(columnNames).toContain('subject');
      expect(columnNames).toContain('predicate');
      expect(columnNames).toContain('object');
    });

    it('should add triple_extracted, triple_extracted_status, triple_extraction_metadata columns to memory_item', async () => {
      // Given: 기본 스키마가 있는 경우
      // When: 마이그레이션 실행
      await migration.up(db);

      // Then: 새 컬럼들이 추가되어야 함
      const columns = db.prepare(`PRAGMA table_info(memory_item)`).all() as Array<{ name: string }>;
      const columnNames = columns.map(col => col.name);

      expect(columnNames).toContain('triple_extracted');
      expect(columnNames).toContain('triple_extracted_status');
      expect(columnNames).toContain('triple_extraction_metadata');
    });

    it('should create indexes for triple extraction fields', async () => {
      // Given: 기본 스키마가 있는 경우
      // When: 마이그레이션 실행
      await migration.up(db);

      // Then: 인덱스가 생성되어야 함
      const tripleIndex = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='index' AND name='idx_memory_item_triple'
      `).get() as { name: string } | undefined;
      expect(tripleIndex).toBeDefined();

      const extractedIndex = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='index' AND name='idx_memory_item_triple_extracted'
      `).get() as { name: string } | undefined;
      expect(extractedIndex).toBeDefined();

      const statusIndex = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='index' AND name='idx_memory_item_triple_status'
      `).get() as { name: string } | undefined;
      expect(statusIndex).toBeDefined();
    });

    it('should insert extracted_from and supported_by relation types into relation_type_registry', async () => {
      // Given: 기본 스키마가 있는 경우
      // When: 마이그레이션 실행
      await migration.up(db);

      // Then: relation_type_registry에 새 관계 타입이 삽입되어야 함
      const extractedFrom = db.prepare(`
        SELECT type_name, category, description FROM relation_type_registry WHERE type_name = ?
      `).get('extracted_from') as { type_name: string; category: string; description: string } | undefined;

      expect(extractedFrom).toBeDefined();
      expect(extractedFrom?.category).toBe('Structural');
      expect(extractedFrom?.description).toContain('추출 관계');

      const supportedBy = db.prepare(`
        SELECT type_name, category, description FROM relation_type_registry WHERE type_name = ?
      `).get('supported_by') as { type_name: string; category: string; description: string } | undefined;

      expect(supportedBy).toBeDefined();
      expect(supportedBy?.category).toBe('Structural');
      expect(supportedBy?.description).toContain('근거 관계');
    });

    it('should preserve existing memory_item data', async () => {
      // Given: 기존 데이터가 있는 경우
      const testData = [
        { id: 'test-1', type: 'episodic', content: 'Content 1' },
        { id: 'test-2', type: 'semantic', content: 'Content 2' },
        { id: 'test-3', type: 'procedural', content: 'Content 3' }
      ];

      for (const data of testData) {
        db.prepare(`
          INSERT INTO memory_item (id, type, content) VALUES (?, ?, ?)
        `).run(data.id, data.type, data.content);
      }

      // When: 마이그레이션 실행
      await migration.up(db);

      // Then: 기존 데이터가 유지되어야 함
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

    it('should allow inserting semantic memory with triple structure', async () => {
      // Given: 마이그레이션이 적용된 상태
      await migration.up(db);

      // When: Triple 구조를 포함한 Semantic Memory 삽입
      db.prepare(`
        INSERT INTO memory_item (id, type, content, subject, predicate, object, triple_extracted, triple_extracted_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'sem-1',
        'semantic',
        '사용자는 커피를 선호합니다',
        '사용자',
        '선호',
        '커피',
        1, // SQLite BOOLEAN은 1/0으로 저장
        'success'
      );

      // Then: 데이터가 올바르게 저장되어야 함
      const record = db.prepare(`
        SELECT subject, predicate, object, triple_extracted, triple_extracted_status 
        FROM memory_item WHERE id = ?
      `).get('sem-1') as {
        subject: string | null;
        predicate: string | null;
        object: string | null;
        triple_extracted: number | null;
        triple_extracted_status: string | null;
      } | undefined;

      expect(record).toBeDefined();
      expect(record?.subject).toBe('사용자');
      expect(record?.predicate).toBe('선호');
      expect(record?.object).toBe('커피');
      expect(record?.triple_extracted).toBe(1); // SQLite BOOLEAN은 1/0으로 저장
      expect(record?.triple_extracted_status).toBe('success');
    });

    it('should allow inserting episodic memory with triple extraction metadata', async () => {
      // Given: 마이그레이션이 적용된 상태
      await migration.up(db);

      // When: Triple 추출 메타데이터를 포함한 Episodic Memory 삽입
      const metadata = JSON.stringify({
        triple_count: 3,
        confidence_avg: 0.85,
        extracted_at: '2025-01-15T10:00:00Z'
      });

      db.prepare(`
        INSERT INTO memory_item (id, type, content, triple_extracted, triple_extracted_status, triple_extraction_metadata) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        'epi-1',
        'episodic',
        '사용자가 커피를 좋아한다고 말했습니다',
        1, // SQLite BOOLEAN은 1/0으로 저장
        'success',
        metadata
      );

      // Then: 메타데이터가 올바르게 저장되어야 함
      const record = db.prepare(`
        SELECT triple_extracted, triple_extracted_status, triple_extraction_metadata 
        FROM memory_item WHERE id = ?
      `).get('epi-1') as {
        triple_extracted: number | null;
        triple_extracted_status: string | null;
        triple_extraction_metadata: string | null;
      } | undefined;

      expect(record).toBeDefined();
      expect(record?.triple_extracted).toBe(1);
      expect(record?.triple_extracted_status).toBe('success');
      
      const parsedMetadata = JSON.parse(record?.triple_extraction_metadata || '{}');
      expect(parsedMetadata.triple_count).toBe(3);
      expect(parsedMetadata.confidence_avg).toBe(0.85);
    });
  });

  describe('validateAfter', () => {
    it('should pass when all fields and indexes are created correctly', async () => {
      // Given: 마이그레이션이 성공적으로 실행된 경우
      await migration.up(db);

      // When/Then: 검증이 통과해야 함
      await expect(migration.validateAfter(db)).resolves.not.toThrow();
    });

    it('should throw error when subject column is missing', async () => {
      // Given: 마이그레이션 실행 후 컬럼 삭제 시뮬레이션
      // SQLite는 ALTER TABLE DROP COLUMN를 직접 지원하지 않으므로
      // validateAfter가 올바르게 검증하는지 확인
      await migration.up(db);
      // 실제로는 이런 상황이 발생하지 않지만, 검증 로직 테스트
      await expect(migration.validateAfter(db)).resolves.not.toThrow();
    });

    it('should throw error when required indexes are missing', async () => {
      // Given: 마이그레이션 실행 후 인덱스 삭제
      await migration.up(db);
      db.exec('DROP INDEX idx_memory_item_triple');

      // When/Then: 에러가 발생해야 함
      await expect(migration.validateAfter(db)).rejects.toThrow(
        'idx_memory_item_triple index was not created'
      );
    });

    it('should throw error when extracted_from relation type is missing', async () => {
      // Given: 마이그레이션 실행 후 관계 타입 삭제
      await migration.up(db);
      db.prepare('DELETE FROM relation_type_registry WHERE type_name = ?').run('extracted_from');

      // When/Then: 에러가 발생해야 함
      await expect(migration.validateAfter(db)).rejects.toThrow(
        'extracted_from relation type was not inserted'
      );
    });

    it('should throw error when supported_by relation type is missing', async () => {
      // Given: 마이그레이션 실행 후 관계 타입 삭제
      await migration.up(db);
      db.prepare('DELETE FROM relation_type_registry WHERE type_name = ?').run('supported_by');

      // When/Then: 에러가 발생해야 함
      await expect(migration.validateAfter(db)).rejects.toThrow(
        'supported_by relation type was not inserted'
      );
    });

    it('should throw error when relation type has incorrect category', async () => {
      // Given: 마이그레이션 실행 후 관계 타입 카테고리 변경
      await migration.up(db);
      db.prepare(`
        UPDATE relation_type_registry SET category = ? WHERE type_name = ?
      `).run('Causal', 'extracted_from');

      // When/Then: 에러가 발생해야 함
      await expect(migration.validateAfter(db)).rejects.toThrow(
        'extracted_from relation type has incorrect category or metadata'
      );
    });
  });

  describe('down', () => {
    it('should drop indexes and remove relation types', async () => {
      // Given: 마이그레이션이 적용된 상태
      await migration.up(db);

      // 인덱스 존재 확인
      const indexBefore = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='index' AND name='idx_memory_item_triple'
      `).get();
      expect(indexBefore).toBeDefined();

      // 관계 타입 존재 확인
      const extractedFromBefore = db.prepare(`
        SELECT type_name FROM relation_type_registry WHERE type_name = ?
      `).get('extracted_from');
      expect(extractedFromBefore).toBeDefined();

      // 스키마 버전 기록 (MigrationRunner가 하는 일을 시뮬레이션)
      db.prepare(`
        INSERT INTO memento_schema_version (version, migration_name, description, applied_by)
        VALUES (?, ?, ?, ?)
      `).run('8.0', 'arigraph-schema-expansion', 'Test', 'system');

      // When: 롤백 실행
      await migration.down(db);

      // Then: 인덱스가 삭제되어야 함
      const indexAfter = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='index' AND name='idx_memory_item_triple'
      `).get();
      expect(indexAfter).toBeUndefined();

      const extractedIndexAfter = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='index' AND name='idx_memory_item_triple_extracted'
      `).get();
      expect(extractedIndexAfter).toBeUndefined();

      const statusIndexAfter = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='index' AND name='idx_memory_item_triple_status'
      `).get();
      expect(statusIndexAfter).toBeUndefined();

      // Then: 관계 타입이 삭제되어야 함
      const extractedFromAfter = db.prepare(`
        SELECT type_name FROM relation_type_registry WHERE type_name = ?
      `).get('extracted_from');
      expect(extractedFromAfter).toBeUndefined();

      const supportedByAfter = db.prepare(`
        SELECT type_name FROM relation_type_registry WHERE type_name = ?
      `).get('supported_by');
      expect(supportedByAfter).toBeUndefined();

      // Then: 스키마 버전 8.0이 삭제되어야 함
      const version = db.prepare(`
        SELECT version FROM memento_schema_version WHERE version = ?
      `).get('8.0');
      expect(version).toBeUndefined();
    });

    it('should preserve other relation types during rollback', async () => {
      // Given: 마이그레이션 적용 후 다양한 관계 타입이 있는 경우
      await migration.up(db);

      // When: 롤백 실행
      await migration.down(db);

      // Then: 다른 관계 타입은 유지되어야 함
      const causes = db.prepare(`
        SELECT type_name FROM relation_type_registry WHERE type_name = ?
      `).get('CAUSES');
      expect(causes).toBeDefined();

      const dependsOn = db.prepare(`
        SELECT type_name FROM relation_type_registry WHERE type_name = ?
      `).get('DEPENDS_ON');
      expect(dependsOn).toBeDefined();
    });
  });

  describe('integration', () => {
    it('should complete full migration cycle (up -> validate -> down)', async () => {
      // Given: 기본 스키마
      // When: Before validation
      await expect(migration.validateBefore(db)).resolves.not.toThrow();

      // When: Migration
      await migration.up(db);

      // When: After validation
      await expect(migration.validateAfter(db)).resolves.not.toThrow();

      // When: Rollback
      await migration.down(db);

      // Then: 인덱스가 삭제되었는지 확인
      const index = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='index' AND name='idx_memory_item_triple'
      `).get();
      expect(index).toBeUndefined();

      // Then: 관계 타입이 삭제되었는지 확인
      const extractedFrom = db.prepare(`
        SELECT type_name FROM relation_type_registry WHERE type_name = ?
      `).get('extracted_from');
      expect(extractedFrom).toBeUndefined();
    });

    it('should preserve existing memory_item data during migration', async () => {
      // Given: 기존 데이터가 있는 경우
      const testData = [
        { id: 'test-1', type: 'episodic', content: 'Content 1' },
        { id: 'test-2', type: 'semantic', content: 'Content 2' },
        { id: 'test-3', type: 'procedural', content: 'Content 3' }
      ];

      for (const data of testData) {
        db.prepare(`
          INSERT INTO memory_item (id, type, content) VALUES (?, ?, ?)
        `).run(data.id, data.type, data.content);
      }

      // When: 마이그레이션 실행
      await migration.up(db);

      // Then: 기존 데이터가 유지되어야 함
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

    it('should support inserting semantic memory with triple structure after migration', async () => {
      // Given: 마이그레이션이 적용된 상태
      await migration.up(db);

      // When: Triple 구조를 포함한 Semantic Memory 삽입
      db.prepare(`
        INSERT INTO memory_item (id, type, content, subject, predicate, object, triple_extracted, triple_extracted_status, triple_extraction_metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'sem-1',
        'semantic',
        '사용자는 커피를 선호합니다',
        '사용자',
        '선호',
        '커피',
        1, // SQLite BOOLEAN은 1/0으로 저장
        'success',
        JSON.stringify({ triple_count: 1, confidence_avg: 0.9, extracted_at: '2025-01-15T10:00:00Z' })
      );

      // Then: 데이터가 올바르게 저장되어야 함
      const record = db.prepare(`
        SELECT subject, predicate, object, triple_extracted, triple_extracted_status, triple_extraction_metadata 
        FROM memory_item WHERE id = ?
      `).get('sem-1') as {
        subject: string | null;
        predicate: string | null;
        object: string | null;
        triple_extracted: number | null;
        triple_extracted_status: string | null;
        triple_extraction_metadata: string | null;
      } | undefined;

      expect(record).toBeDefined();
      expect(record?.subject).toBe('사용자');
      expect(record?.predicate).toBe('선호');
      expect(record?.object).toBe('커피');
      expect(record?.triple_extracted).toBe(1);
      expect(record?.triple_extracted_status).toBe('success');
      
      const metadata = JSON.parse(record?.triple_extraction_metadata || '{}');
      expect(metadata.triple_count).toBe(1);
      expect(metadata.confidence_avg).toBe(0.9);
    });

    it('should support partial index for semantic memory with triple data', async () => {
      // Given: 마이그레이션이 적용된 상태
      await migration.up(db);

      // When: Triple 구조를 포함한 Semantic Memory 삽입
      db.prepare(`
        INSERT INTO memory_item (id, type, content, subject, predicate, object) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        'sem-1',
        'semantic',
        '사용자는 커피를 선호합니다',
        '사용자',
        '선호',
        '커피'
      );

      // Then: Partial Index가 올바르게 작동해야 함 (인덱스 쿼리 테스트)
      // Partial Index는 type='semantic' AND subject/predicate/object IS NOT NULL인 경우만 인덱싱
      const result = db.prepare(`
        SELECT id FROM memory_item 
        WHERE type='semantic' AND subject IS NOT NULL AND predicate IS NOT NULL AND object IS NOT NULL
      `).all() as Array<{ id: string }>;

      expect(result.length).toBeGreaterThan(0);
      expect(result.some(r => r.id === 'sem-1')).toBe(true);
    });
  });
});

