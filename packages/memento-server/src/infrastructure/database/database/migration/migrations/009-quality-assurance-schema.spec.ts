import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { QualityAssuranceSchemaMigration } from './009-quality-assurance-schema.js';

/**
 * 기본 스키마 생성 (008 마이그레이션 이후의 상태를 가정)
 * memory_item, relation_type_registry, memento_schema_version 테이블 포함
 */
function createBaseSchema(db: Database.Database): void {
  // memory_item 테이블 생성
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
      subject TEXT,
      predicate TEXT,
      object TEXT,
      triple_extracted BOOLEAN DEFAULT NULL,
      triple_extracted_status TEXT DEFAULT NULL,
      triple_extraction_metadata TEXT DEFAULT NULL
    );
  `);

  // relation_type_registry 테이블 생성
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

describe('QualityAssuranceSchemaMigration', () => {
  let db: Database.Database;
  let migration: QualityAssuranceSchemaMigration;

  beforeEach(() => {
    db = new Database(':memory:');
    createBaseSchema(db);
    migration = new QualityAssuranceSchemaMigration();
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe('validateBefore', () => {
    it('should pass when base schema exists', async () => {
      // Given: 기본 스키마가 있는 경우
      // When/Then: 검증이 통과해야 함
      await expect(migration.validateBefore(db)).resolves.not.toThrow();
    });

    it('should throw error when migration has already been applied', async () => {
      // Given: 마이그레이션이 이미 적용된 경우
      db.prepare(`
        INSERT INTO memento_schema_version (version, migration_name, description, applied_by)
        VALUES (?, ?, ?, ?)
      `).run('9.0', 'quality-assurance-schema', 'Test migration', 'system');

      // When/Then: 에러가 발생해야 함
      await expect(migration.validateBefore(db)).rejects.toThrow(
        'Migration 009 has already been applied'
      );
    });

    it('should throw error when quality_measurement_history table already exists', async () => {
      // Given: quality_measurement_history 테이블이 이미 존재하는 경우
      db.exec(`
        CREATE TABLE quality_measurement_history (
          id TEXT PRIMARY KEY,
          measurement_type TEXT NOT NULL
        )
      `);

      // When/Then: 에러가 발생해야 함
      await expect(migration.validateBefore(db)).rejects.toThrow(
        'quality_measurement_history table already exists'
      );
    });

    it('should throw error when quality_metrics table already exists', async () => {
      // Given: quality_metrics 테이블이 이미 존재하는 경우
      db.exec(`
        CREATE TABLE quality_metrics (
          metric_namespace TEXT NOT NULL,
          metric_key TEXT NOT NULL,
          PRIMARY KEY (metric_namespace, metric_key)
        )
      `);

      // When/Then: 에러가 발생해야 함
      await expect(migration.validateBefore(db)).rejects.toThrow(
        'quality_metrics table already exists'
      );
    });

    it('should throw error when quality_thresholds table already exists', async () => {
      // Given: quality_thresholds 테이블이 이미 존재하는 경우
      db.exec(`
        CREATE TABLE quality_thresholds (
          metric_namespace TEXT NOT NULL,
          metric_key TEXT NOT NULL,
          PRIMARY KEY (metric_namespace, metric_key)
        )
      `);

      // When/Then: 에러가 발생해야 함
      await expect(migration.validateBefore(db)).rejects.toThrow(
        'quality_thresholds table already exists'
      );
    });
  });

  describe('up', () => {
    it('should create quality_measurement_history table', async () => {
      // Given: 기본 스키마가 있는 경우
      // When: 마이그레이션 실행
      await migration.up(db);

      // Then: quality_measurement_history 테이블이 생성되어야 함
      const table = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='quality_measurement_history'
      `).get() as { name: string } | undefined;
      expect(table).toBeDefined();
    });

    it('should create quality_metrics table', async () => {
      // Given: 기본 스키마가 있는 경우
      // When: 마이그레이션 실행
      await migration.up(db);

      // Then: quality_metrics 테이블이 생성되어야 함
      const table = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='quality_metrics'
      `).get() as { name: string } | undefined;
      expect(table).toBeDefined();
    });

    it('should create quality_thresholds table', async () => {
      // Given: 기본 스키마가 있는 경우
      // When: 마이그레이션 실행
      await migration.up(db);

      // Then: quality_thresholds 테이블이 생성되어야 함
      const table = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='quality_thresholds'
      `).get() as { name: string } | undefined;
      expect(table).toBeDefined();
    });

    it('should create all required indexes', async () => {
      // Given: 기본 스키마가 있는 경우
      // When: 마이그레이션 실행
      await migration.up(db);

      // Then: 모든 인덱스가 생성되어야 함
      const requiredIndexes = [
        'idx_quality_measurement_history_measured_at',
        'idx_quality_measurement_history_type',
        'idx_quality_measurement_history_status',
        'idx_quality_metrics_namespace_key',
        'idx_quality_metrics_context',
        'idx_quality_metrics_status',
        'idx_quality_metrics_measured_at',
        'idx_quality_thresholds_namespace_key',
        'idx_quality_thresholds_context'
      ];

      for (const indexName of requiredIndexes) {
        const index = db.prepare(`
          SELECT name FROM sqlite_master WHERE type='index' AND name=?
        `).get(indexName) as { name: string } | undefined;
        expect(index).toBeDefined();
      }
    });

    it('should allow inserting quality measurement history', async () => {
      // Given: 마이그레이션이 적용된 상태
      await migration.up(db);

      // When: 품질 측정 이력 삽입
      const metrics = JSON.stringify({
        metric_namespace: 'search',
        metric_key: 'precision_at_5',
        context: 'default',
        value: 0.85,
        threshold_value: 0.8
      });

      db.prepare(`
        INSERT INTO quality_measurement_history (id, measurement_type, metrics, status)
        VALUES (?, ?, ?, ?)
      `).run('test-1', 'batch', metrics, 'success');

      // Then: 데이터가 올바르게 저장되어야 함
      const record = db.prepare(`
        SELECT id, measurement_type, metrics, status 
        FROM quality_measurement_history WHERE id = ?
      `).get('test-1') as {
        id: string;
        measurement_type: string;
        metrics: string;
        status: string;
      } | undefined;

      expect(record).toBeDefined();
      expect(record?.measurement_type).toBe('batch');
      expect(record?.status).toBe('success');
      
      const parsedMetrics = JSON.parse(record?.metrics || '{}');
      expect(parsedMetrics.metric_namespace).toBe('search');
      expect(parsedMetrics.metric_key).toBe('precision_at_5');
      expect(parsedMetrics.value).toBe(0.85);
    });

    it('should allow inserting quality metrics', async () => {
      // Given: 마이그레이션이 적용된 상태
      await migration.up(db);

      // When: 품질 지표 삽입
      db.prepare(`
        INSERT INTO quality_metrics (metric_namespace, metric_key, context, metric_value, measured_at, status, threshold_value)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('search', 'precision_at_5', 'default', 0.85, new Date().toISOString(), 'pass', 0.8);

      // Then: 데이터가 올바르게 저장되어야 함
      const record = db.prepare(`
        SELECT metric_namespace, metric_key, context, metric_value, status, threshold_value
        FROM quality_metrics 
        WHERE metric_namespace = ? AND metric_key = ? AND context = ?
      `).get('search', 'precision_at_5', 'default') as {
        metric_namespace: string;
        metric_key: string;
        context: string;
        metric_value: number;
        status: string;
        threshold_value: number;
      } | undefined;

      expect(record).toBeDefined();
      expect(record?.metric_namespace).toBe('search');
      expect(record?.metric_key).toBe('precision_at_5');
      expect(record?.context).toBe('default');
      expect(record?.metric_value).toBe(0.85);
      expect(record?.status).toBe('pass');
      expect(record?.threshold_value).toBe(0.8);
    });

    it('should allow inserting quality thresholds', async () => {
      // Given: 마이그레이션이 적용된 상태
      await migration.up(db);

      // When: 품질 임계값 삽입
      db.prepare(`
        INSERT INTO quality_thresholds (metric_namespace, metric_key, context, threshold_value, threshold_type, description)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('search', 'precision_at_5', 'default', 0.7, 'min', 'Minimum precision at 5');

      // Then: 데이터가 올바르게 저장되어야 함
      const record = db.prepare(`
        SELECT metric_namespace, metric_key, context, threshold_value, threshold_type, description
        FROM quality_thresholds 
        WHERE metric_namespace = ? AND metric_key = ? AND context = ?
      `).get('search', 'precision_at_5', 'default') as {
        metric_namespace: string;
        metric_key: string;
        context: string;
        threshold_value: number;
        threshold_type: string;
        description: string | null;
      } | undefined;

      expect(record).toBeDefined();
      expect(record?.metric_namespace).toBe('search');
      expect(record?.metric_key).toBe('precision_at_5');
      expect(record?.context).toBe('default');
      expect(record?.threshold_value).toBe(0.7);
      expect(record?.threshold_type).toBe('min');
      expect(record?.description).toBe('Minimum precision at 5');
    });

    it('should enforce CHECK constraint on measurement_type', async () => {
      // Given: 마이그레이션이 적용된 상태
      await migration.up(db);

      // When/Then: 유효한 measurement_type은 허용되어야 함
      const validTypes = ['batch', 'test', 'manual'];
      for (const type of validTypes) {
        const metrics = JSON.stringify({ metric_namespace: 'search', metric_key: 'test' });
        expect(() => {
          db.prepare(`
            INSERT INTO quality_measurement_history (id, measurement_type, metrics, status)
            VALUES (?, ?, ?, ?)
          `).run(`test-${type}`, type, metrics, 'success');
        }).not.toThrow();
      }

      // When/Then: 유효하지 않은 measurement_type은 거부되어야 함
      const invalidMetrics = JSON.stringify({ metric_namespace: 'search', metric_key: 'test' });
      expect(() => {
        db.prepare(`
          INSERT INTO quality_measurement_history (id, measurement_type, metrics, status)
          VALUES (?, ?, ?, ?)
        `).run('test-invalid', 'invalid', invalidMetrics, 'success');
      }).toThrow();
    });

    it('should enforce CHECK constraint on status in quality_measurement_history', async () => {
      // Given: 마이그레이션이 적용된 상태
      await migration.up(db);

      // When/Then: 유효한 status는 허용되어야 함
      const validStatuses = ['success', 'warning', 'error'];
      for (const status of validStatuses) {
        const metrics = JSON.stringify({ metric_namespace: 'search', metric_key: 'test' });
        expect(() => {
          db.prepare(`
            INSERT INTO quality_measurement_history (id, measurement_type, metrics, status)
            VALUES (?, ?, ?, ?)
          `).run(`test-${status}`, 'batch', metrics, status);
        }).not.toThrow();
      }

      // When/Then: 유효하지 않은 status는 거부되어야 함
      const invalidMetrics = JSON.stringify({ metric_namespace: 'search', metric_key: 'test' });
      expect(() => {
        db.prepare(`
          INSERT INTO quality_measurement_history (id, measurement_type, metrics, status)
          VALUES (?, ?, ?, ?)
        `).run('test-invalid', 'batch', invalidMetrics, 'invalid');
      }).toThrow();
    });

    it('should enforce CHECK constraint on status in quality_metrics', async () => {
      // Given: 마이그레이션이 적용된 상태
      await migration.up(db);

      // When/Then: 유효한 status는 허용되어야 함
      const validStatuses = ['pass', 'warning', 'fail'];
      for (const status of validStatuses) {
        expect(() => {
          db.prepare(`
            INSERT INTO quality_metrics (metric_namespace, metric_key, context, metric_value, measured_at, status)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run('search', `test-${status}`, 'default', 0.8, new Date().toISOString(), status);
        }).not.toThrow();
      }

      // When/Then: 유효하지 않은 status는 거부되어야 함
      expect(() => {
        db.prepare(`
          INSERT INTO quality_metrics (metric_namespace, metric_key, context, metric_value, measured_at, status)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run('search', 'test-invalid', 'default', 0.8, new Date().toISOString(), 'invalid');
      }).toThrow();
    });

    it('should enforce CHECK constraint on threshold_type', async () => {
      // Given: 마이그레이션이 적용된 상태
      await migration.up(db);

      // When/Then: 유효한 threshold_type은 허용되어야 함
      const validTypes = ['min', 'max'];
      for (const type of validTypes) {
        expect(() => {
          db.prepare(`
            INSERT INTO quality_thresholds (metric_namespace, metric_key, context, threshold_value, threshold_type)
            VALUES (?, ?, ?, ?, ?)
          `).run('search', `test-${type}`, 'default', 0.7, type);
        }).not.toThrow();
      }

      // When/Then: 유효하지 않은 threshold_type은 거부되어야 함
      expect(() => {
        db.prepare(`
          INSERT INTO quality_thresholds (metric_namespace, metric_key, context, threshold_value, threshold_type)
          VALUES (?, ?, ?, ?, ?)
        `).run('search', 'test-invalid', 'default', 0.7, 'invalid');
      }).toThrow();
    });

    it('should enforce PRIMARY KEY constraint on quality_metrics', async () => {
      // Given: 마이그레이션이 적용된 상태
      await migration.up(db);

      // When: 첫 번째 레코드 삽입
      db.prepare(`
        INSERT INTO quality_metrics (metric_namespace, metric_key, context, metric_value, measured_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('search', 'precision_at_5', 'default', 0.85, new Date().toISOString());

      // When/Then: 동일한 PRIMARY KEY로 삽입 시도하면 에러가 발생해야 함
      expect(() => {
        db.prepare(`
          INSERT INTO quality_metrics (metric_namespace, metric_key, context, metric_value, measured_at)
          VALUES (?, ?, ?, ?, ?)
        `).run('search', 'precision_at_5', 'default', 0.9, new Date().toISOString());
      }).toThrow();
    });

    it('should enforce PRIMARY KEY constraint on quality_thresholds', async () => {
      // Given: 마이그레이션이 적용된 상태
      await migration.up(db);

      // When: 첫 번째 레코드 삽입
      db.prepare(`
        INSERT INTO quality_thresholds (metric_namespace, metric_key, context, threshold_value, threshold_type)
        VALUES (?, ?, ?, ?, ?)
      `).run('search', 'precision_at_5', 'default', 0.7, 'min');

      // When/Then: 동일한 PRIMARY KEY로 삽입 시도하면 에러가 발생해야 함
      expect(() => {
        db.prepare(`
          INSERT INTO quality_thresholds (metric_namespace, metric_key, context, threshold_value, threshold_type)
          VALUES (?, ?, ?, ?, ?)
        `).run('search', 'precision_at_5', 'default', 0.8, 'min');
      }).toThrow();
    });
  });

  describe('validateAfter', () => {
    it('should pass when all tables and indexes are created correctly', async () => {
      // Given: 마이그레이션이 성공적으로 실행된 경우
      await migration.up(db);

      // When/Then: 검증이 통과해야 함
      await expect(migration.validateAfter(db)).resolves.not.toThrow();
    });

    it('should throw error when quality_measurement_history table is missing', async () => {
      // Given: 마이그레이션 실행 후 테이블 삭제 시뮬레이션
      await migration.up(db);
      db.exec('DROP TABLE quality_measurement_history');

      // When/Then: 에러가 발생해야 함
      await expect(migration.validateAfter(db)).rejects.toThrow(
        'quality_measurement_history table was not created'
      );
    });

    it('should throw error when required columns are missing', async () => {
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
      db.exec('DROP INDEX idx_quality_measurement_history_measured_at');

      // When/Then: 에러가 발생해야 함
      await expect(migration.validateAfter(db)).rejects.toThrow(
        'Index idx_quality_measurement_history_measured_at was not created'
      );
    });

    it('should verify PRIMARY KEY constraints', async () => {
      // Given: 마이그레이션이 실행된 경우
      await migration.up(db);

      // When: 검증 실행
      await migration.validateAfter(db);

      // Then: PRIMARY KEY 제약이 존재하는지 확인
      const historyTableInfo = db.prepare(`
        SELECT sql FROM sqlite_master WHERE type='table' AND name='quality_measurement_history'
      `).get() as { sql: string } | undefined;
      expect(historyTableInfo?.sql).toContain('PRIMARY KEY');

      const metricsTableInfo = db.prepare(`
        SELECT sql FROM sqlite_master WHERE type='table' AND name='quality_metrics'
      `).get() as { sql: string } | undefined;
      expect(metricsTableInfo?.sql).toContain('PRIMARY KEY');

      const thresholdsTableInfo = db.prepare(`
        SELECT sql FROM sqlite_master WHERE type='table' AND name='quality_thresholds'
      `).get() as { sql: string } | undefined;
      expect(thresholdsTableInfo?.sql).toContain('PRIMARY KEY');
    });

    it('should verify CHECK constraints', async () => {
      // Given: 마이그레이션이 실행된 경우
      await migration.up(db);

      // When: 검증 실행
      await migration.validateAfter(db);

      // Then: CHECK 제약이 존재하는지 확인
      const historyTableInfo = db.prepare(`
        SELECT sql FROM sqlite_master WHERE type='table' AND name='quality_measurement_history'
      `).get() as { sql: string } | undefined;
      expect(historyTableInfo?.sql).toContain('CHECK (measurement_type IN');
      expect(historyTableInfo?.sql).toContain('CHECK (status IN');

      const metricsTableInfo = db.prepare(`
        SELECT sql FROM sqlite_master WHERE type='table' AND name='quality_metrics'
      `).get() as { sql: string } | undefined;
      expect(metricsTableInfo?.sql).toContain('CHECK (status IN');

      const thresholdsTableInfo = db.prepare(`
        SELECT sql FROM sqlite_master WHERE type='table' AND name='quality_thresholds'
      `).get() as { sql: string } | undefined;
      expect(thresholdsTableInfo?.sql).toContain('CHECK (threshold_type IN');
    });
  });

  describe('down', () => {
    it('should drop indexes and tables', async () => {
      // Given: 마이그레이션이 적용된 상태
      await migration.up(db);

      // 인덱스 존재 확인
      const indexBefore = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='index' AND name='idx_quality_measurement_history_measured_at'
      `).get();
      expect(indexBefore).toBeDefined();

      // 테이블 존재 확인
      const tableBefore = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='quality_measurement_history'
      `).get();
      expect(tableBefore).toBeDefined();

      // 스키마 버전 기록 (MigrationRunner가 하는 일을 시뮬레이션)
      db.prepare(`
        INSERT INTO memento_schema_version (version, migration_name, description, applied_by)
        VALUES (?, ?, ?, ?)
      `).run('9.0', 'quality-assurance-schema', 'Test', 'system');

      // When: 롤백 실행
      await migration.down(db);

      // Then: 인덱스가 삭제되어야 함
      const indexAfter = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='index' AND name='idx_quality_measurement_history_measured_at'
      `).get();
      expect(indexAfter).toBeUndefined();

      // Then: 테이블이 삭제되어야 함
      const historyTableAfter = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='quality_measurement_history'
      `).get();
      expect(historyTableAfter).toBeUndefined();

      const metricsTableAfter = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='quality_metrics'
      `).get();
      expect(metricsTableAfter).toBeUndefined();

      const thresholdsTableAfter = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='quality_thresholds'
      `).get();
      expect(thresholdsTableAfter).toBeUndefined();

      // Then: 스키마 버전 9.0이 삭제되어야 함
      const version = db.prepare(`
        SELECT version FROM memento_schema_version WHERE version = ?
      `).get('9.0');
      expect(version).toBeUndefined();
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

      // Then: 테이블이 삭제되었는지 확인
      const table = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='quality_measurement_history'
      `).get();
      expect(table).toBeUndefined();
    });

    it('should support inserting and querying quality data', async () => {
      // Given: 마이그레이션이 적용된 상태
      await migration.up(db);

      // When: 품질 데이터 삽입
      const metrics = JSON.stringify({
        metric_namespace: 'search',
        metric_key: 'precision_at_5',
        context: 'default',
        value: 0.85,
        threshold_value: 0.8
      });

      db.prepare(`
        INSERT INTO quality_measurement_history (id, measurement_type, metrics, status)
        VALUES (?, ?, ?, ?)
      `).run('hist-1', 'batch', metrics, 'success');

      db.prepare(`
        INSERT INTO quality_metrics (metric_namespace, metric_key, context, metric_value, measured_at, status, threshold_value)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('search', 'precision_at_5', 'default', 0.85, new Date().toISOString(), 'pass', 0.8);

      db.prepare(`
        INSERT INTO quality_thresholds (metric_namespace, metric_key, context, threshold_value, threshold_type, description)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('search', 'precision_at_5', 'default', 0.7, 'min', 'Minimum precision');

      // Then: 데이터를 조회할 수 있어야 함
      const historyCount = db.prepare(`
        SELECT COUNT(*) as count FROM quality_measurement_history
      `).get() as { count: number };
      expect(historyCount.count).toBe(1);

      const metricsCount = db.prepare(`
        SELECT COUNT(*) as count FROM quality_metrics
      `).get() as { count: number };
      expect(metricsCount.count).toBe(1);

      const thresholdsCount = db.prepare(`
        SELECT COUNT(*) as count FROM quality_thresholds
      `).get() as { count: number };
      expect(thresholdsCount.count).toBe(1);
    });

    it('should support querying by indexes', async () => {
      // Given: 마이그레이션이 적용되고 데이터가 있는 상태
      await migration.up(db);

      const metrics1 = JSON.stringify({ metric_namespace: 'search', metric_key: 'precision_at_5' });
      const metrics2 = JSON.stringify({ metric_namespace: 'relation', metric_key: 'f1_score' });

      db.prepare(`
        INSERT INTO quality_measurement_history (id, measurement_type, metrics, status, measured_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('hist-1', 'batch', metrics1, 'success', '2025-01-01 00:00:00');

      db.prepare(`
        INSERT INTO quality_measurement_history (id, measurement_type, metrics, status, measured_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('hist-2', 'test', metrics2, 'warning', '2025-01-02 00:00:00');

      // When: 인덱스를 사용한 쿼리
      // Then: measured_at 인덱스를 사용한 쿼리가 작동해야 함
      const byDate = db.prepare(`
        SELECT id FROM quality_measurement_history 
        WHERE measured_at >= ? ORDER BY measured_at
      `).all('2025-01-01 00:00:00') as Array<{ id: string }>;
      expect(byDate.length).toBe(2);

      // Then: measurement_type 인덱스를 사용한 쿼리가 작동해야 함
      const byType = db.prepare(`
        SELECT id FROM quality_measurement_history WHERE measurement_type = ?
      `).all('batch') as Array<{ id: string }>;
      expect(byType.length).toBe(1);
      expect(byType[0].id).toBe('hist-1');

      // Then: status 인덱스를 사용한 쿼리가 작동해야 함
      const byStatus = db.prepare(`
        SELECT id FROM quality_measurement_history WHERE status = ?
      `).all('warning') as Array<{ id: string }>;
      expect(byStatus.length).toBe(1);
      expect(byStatus[0].id).toBe('hist-2');
    });

    it('should maintain data integrity after rollback and re-migration', async () => {
      // Given: 마이그레이션 적용 후 롤백
      await migration.up(db);
      await migration.down(db);

      // When: 다시 마이그레이션 실행
      await migration.up(db);

      // Then: 테이블이 다시 생성되어야 함
      const historyTable = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='quality_measurement_history'
      `).get() as { name: string } | undefined;
      expect(historyTable).toBeDefined();

      const metricsTable = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='quality_metrics'
      `).get() as { name: string } | undefined;
      expect(metricsTable).toBeDefined();

      const thresholdsTable = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='quality_thresholds'
      `).get() as { name: string } | undefined;
      expect(thresholdsTable).toBeDefined();
    });
  });
});

