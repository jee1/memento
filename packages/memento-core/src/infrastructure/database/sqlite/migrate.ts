/**
 * 데이터베이스 마이그레이션 스크립트
 * 기존 데이터베이스에 새 컬럼 추가
 */

import Database from 'better-sqlite3';
import { createRequire } from 'module';
import { mementoConfig } from '../../../shared/config/index.js';
import {
  computeL2Norm,
  decodeFloat32Embedding,
  migrateJsonEmbeddingToBlob,
  shouldNormalizeFlag,
} from '../../../shared/utils/embedding-serialization.js';
import { PIIMasker } from '../../../shared/utils/pii-masker.js';
import { logger } from '../../../shared/utils/logger.js';
import { runDatabaseIntegrityPreflight } from './db-integrity-preflight.js';
import { ensureMemoryEmbeddingMetadataDefaults } from './ensure-memory-embedding-metadata-defaults.js';
import {
  checkVecCardinality,
  listExistingVecTables,
  reconcileVecDistanceMetric,
  recreateVecTriggers
} from './vec-schema.js';

function isDuplicateColumnError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('duplicate column name');
}

/**
 * vec0 가상 테이블을 조작하려면 확장이 로드돼 있어야 한다.
 * CLI 스크립트라 초기화 경로(configureSqliteSession)를 거치지 않으므로 여기서 직접 로드한다.
 */
function loadVecExtension(db: Database.Database): boolean {
  try {
    const requireFromHere = createRequire(import.meta.url);
    const { getLoadablePath } = requireFromHere('sqlite-vec') as { getLoadablePath: () => string };
    db.loadExtension(getLoadablePath());
    return true;
  } catch (error) {
    logger.warn('⚠️  sqlite-vec 확장 로드 실패 — vec 테이블 metric 정비를 건너뜁니다', {
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

function migrateDatabase() {
  logger.info('🔄 데이터베이스 마이그레이션 시작');
  
  runDatabaseIntegrityPreflight(mementoConfig.dbPath);
  const db = new Database(mementoConfig.dbPath);
  
  try {
    // 사용성 통계 컬럼 추가
    logger.info('📊 사용성 통계 컬럼 추가 중...');
    
    try {
      db.exec('ALTER TABLE memory_item ADD COLUMN view_count INTEGER DEFAULT 0');
    } catch (err: unknown) {
      if (!isDuplicateColumnError(err)) {
        throw err;
      }
    }
    
    try {
      db.exec('ALTER TABLE memory_item ADD COLUMN cite_count INTEGER DEFAULT 0');
    } catch (err: unknown) {
      if (!isDuplicateColumnError(err)) {
        throw err;
      }
    }
    
    try {
      db.exec('ALTER TABLE memory_item ADD COLUMN edit_count INTEGER DEFAULT 0');
    } catch (err: unknown) {
      if (!isDuplicateColumnError(err)) {
        throw err;
      }
    }
    
    logger.info('✅ 사용성 통계 컬럼 추가 완료');
    
    logger.info('🧠 임베딩 테이블 구조 확인 중...');
    const hasEmbeddingTable = !!db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='memory_embedding'
    `).get();

    const columnInfo = hasEmbeddingTable
      ? db.prepare(`PRAGMA table_info(memory_embedding)`).all() as Array<{ name: string; }>
      : [];

    // 레거시 스키마 호환성: embedding 컬럼 존재 여부 확인
    const hasEmbedding = columnInfo.some(column => column.name === 'embedding');
    const hasProjectionType = columnInfo.some(column => column.name === 'projection_type');
    const needsRebuild = !hasEmbeddingTable || !hasEmbedding || !hasProjectionType;

    if (needsRebuild) {
      logger.info('🧱 memory_embedding 테이블 재구성 중...');

      // #755: create/copy/drop/rename(+ vec trigger drop)을 단일 트랜잭션으로.
      // 트리거 DROP도 원자 단위 안에 두어 실패 시 테이블·트리거가 함께 롤백되게 한다.
      // (이후 recreateVecTriggers는 트랜잭션 밖에서 성공 경로만 정비)
      const rebuildMemoryEmbedding = db.transaction(() => {
        db.exec('DROP TRIGGER IF EXISTS memory_embedding_vec_insert;');
        db.exec('DROP TRIGGER IF EXISTS memory_embedding_vec_update;');
        db.exec('DROP TRIGGER IF EXISTS memory_embedding_vec_delete;');

        db.exec(`
          CREATE TABLE memory_embedding__new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            memory_id TEXT NOT NULL,
            embedding_provider TEXT NOT NULL DEFAULT 'tfidf',
            projection_type TEXT NOT NULL DEFAULT 'native',
            embedding BLOB,
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
          )
        `);

        if (hasEmbeddingTable) {
          // 레거시 스키마 호환성: 각 컬럼 존재 여부 확인
          const hasEmbeddingColumn = columnInfo.some(column => column.name === 'embedding');
          const hasProvider = columnInfo.some(column => column.name === 'embedding_provider');
          const hasDimensions = columnInfo.some(column => column.name === 'dimensions');
          const hasModel = columnInfo.some(column => column.name === 'model');
          const hasCreatedBy = columnInfo.some(column => column.name === 'created_by');
          const hasCreatedAt = columnInfo.some(column => column.name === 'created_at');
          const hasId = columnInfo.some(column => column.name === 'id');

          // #809: JSON TEXT를 BLOB 컬럼에 그대로 SELECT 복사하지 않고 JS에서 변환
          const selectSql = `
            SELECT
              ${hasId ? 'id' : 'NULL AS id'},
              memory_id,
              ${hasProvider ? 'embedding_provider' : "'tfidf' AS embedding_provider"},
              ${hasEmbeddingColumn ? 'embedding' : 'NULL AS embedding'},
              dim,
              ${hasDimensions ? 'dimensions' : 'dim AS dimensions'},
              ${hasModel ? 'model' : 'NULL AS model'},
              ${hasCreatedBy ? 'created_by' : "'system' AS created_by"},
              ${hasCreatedAt ? 'created_at' : 'CURRENT_TIMESTAMP AS created_at'}
            FROM memory_embedding
          `;

          const insert = db.prepare(`
            INSERT INTO memory_embedding__new (
              id,
              memory_id,
              embedding_provider,
              projection_type,
              embedding,
              dim,
              dimensions,
              model,
              precision,
              normalized,
              version,
              created_by,
              created_at
            ) VALUES (
              @id,
              @memory_id,
              @embedding_provider,
              'native',
              @embedding,
              @dim,
              @dimensions,
              @model,
              32,
              @normalized,
              1,
              @created_by,
              @created_at
            )
          `);

          const rows = db.prepare(selectSql).all() as Array<{
            id: number | null;
            memory_id: string;
            embedding_provider: string | null;
            embedding: unknown;
            dim: number;
            dimensions: number;
            model: string | null;
            created_by: string | null;
            created_at: string;
          }>;

          for (const row of rows) {
            const base = {
              id: row.id,
              memory_id: row.memory_id,
              embedding_provider:
                row.embedding_provider && row.embedding_provider !== ''
                  ? row.embedding_provider
                  : 'tfidf',
              model: row.model,
              created_by:
                row.created_by && row.created_by !== '' ? row.created_by : 'system',
              created_at: row.created_at,
            };

            if (Buffer.isBuffer(row.embedding)) {
              const floats = decodeFloat32Embedding(row.embedding);
              insert.run({
                ...base,
                embedding: row.embedding,
                dim: floats.length,
                dimensions: floats.length,
                normalized: shouldNormalizeFlag(computeL2Norm(floats)),
              });
              continue;
            }

            const raw =
              !hasEmbeddingColumn || row.embedding == null || row.embedding === ''
                ? '[]'
                : typeof row.embedding === 'string'
                  ? row.embedding
                  : String(row.embedding);

            const { blob, dimensions } = migrateJsonEmbeddingToBlob(raw);

            if (dimensions === 0 || blob == null) {
              insert.run({
                ...base,
                embedding: null,
                dim: 0,
                dimensions: 0,
                normalized: 0,
              });
              continue;
            }

            const floats = decodeFloat32Embedding(blob);
            insert.run({
              ...base,
              embedding: blob,
              dim: dimensions,
              dimensions,
              normalized: shouldNormalizeFlag(computeL2Norm(floats)),
            });
          }

          db.exec('DROP TABLE memory_embedding;');
        }

        db.exec('ALTER TABLE memory_embedding__new RENAME TO memory_embedding;');
      });
      rebuildMemoryEmbedding();
      logger.info('✅ memory_embedding 테이블 재구성 완료');
    } else {
      logger.info('✅ memory_embedding 테이블은 최신 구조입니다');
    }

    logger.info('🧾 임베딩 인덱스 및 트리거 정비 중...');
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_embedding_memory_id ON memory_embedding(memory_id);
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_embedding_memory_provider ON memory_embedding(memory_id, embedding_provider);
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_embedding_provider_projection ON memory_embedding(embedding_provider, projection_type);
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_embedding_dimensions ON memory_embedding(dimensions);
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_embedding_model ON memory_embedding(model);
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_embedding_version ON memory_embedding(version);
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS embedding_model_registry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        projection_type TEXT NOT NULL DEFAULT 'native',
        dimensions INTEGER NOT NULL,
        vec_table TEXT,
        priority INTEGER DEFAULT 100,
        status TEXT CHECK (status IN ('active','inactive','deprecated')) DEFAULT 'active',
        last_checked TIMESTAMP,
        metadata TEXT,
        UNIQUE(provider, projection_type),
        UNIQUE(provider, model),
        UNIQUE(vec_table)
      )
    `);

    // vec0 distance metric 계약 정비 (issue #713): 트리거는 vec-schema.ts 정의를 단일 원본으로 쓴다.
    // 확장 로드에 실패하면 vec0 테이블이 남아 있어도 이후 prepare/exec가
    // `no such module: vec0`로 실패하므로, 정비 작업 전체를 건너뛴다.
    if (loadVecExtension(db)) {
      const recreated = reconcileVecDistanceMetric(db);
      if (recreated.length > 0) {
        logger.info('🧭 vec 테이블을 cosine metric으로 재생성했습니다', { tables: recreated });
      }

      const existingVecTables = listExistingVecTables(db);
      recreateVecTriggers(db, existingVecTables);
      if (existingVecTables.length === 0) {
        logger.warn('⚠️  vec 테이블이 없어 벡터 트리거를 생성하지 않았습니다');
      } else {
        const mismatched = checkVecCardinality(db).filter(row => !row.matched);
        if (mismatched.length > 0) {
          logger.warn('⚠️  vec 인덱스 cardinality 불일치 (native 필터 기준)', { mismatched });
        }
      }
    }

    logger.info('✅ 임베딩 인덱스 및 트리거 정비 완료');

    // #753: embedding metadata 보정은 migrate/bootstrap 1회 (hot path 금지)
    logger.info('🔧 memory_embedding metadata 기본값 보정 중...');
    ensureMemoryEmbeddingMetadataDefaults(db);
    logger.info('✅ memory_embedding metadata 기본값 보정 완료');
    
    // 기존 데이터에 기본값 설정
    logger.info('🔧 기존 데이터 업데이트 중...');
    
    db.exec(`
      UPDATE memory_item 
      SET view_count = 0, cite_count = 0, edit_count = 0 
      WHERE view_count IS NULL OR cite_count IS NULL OR edit_count IS NULL
    `);
    
    logger.info('✅ 기존 데이터 업데이트 완료');
    
    // 마이그레이션 완료
    logger.info('🎉 데이터베이스 마이그레이션 완료!');
    
  } catch (error) {
    const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
    logger.error('❌ 마이그레이션 실패', { error: maskedError.message, errorName: maskedError.name });
    throw error;
  } finally {
    db.close();
  }
}

// 마이그레이션 실행
if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  try {
    migrateDatabase();
    logger.info('✅ 마이그레이션 완료');
    process.exit(0);
  } catch (error) {
    const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
    logger.error('❌ 마이그레이션 실패', { error: maskedError.message, errorName: maskedError.name });
    process.exit(1);
  }
}

export { migrateDatabase };
