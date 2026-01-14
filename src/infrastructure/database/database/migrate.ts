/**
 * 데이터베이스 마이그레이션 스크립트
 * 기존 데이터베이스에 새 컬럼 추가
 */

import Database from 'better-sqlite3';
import { mementoConfig } from '../../../shared/config/index.js';
import { PIIMasker } from '../../../shared/utils/pii-masker.js';

function migrateDatabase() {
  console.log('🔄 데이터베이스 마이그레이션 시작');
  
  const db = new Database(mementoConfig.dbPath);
  
  try {
    // 사용성 통계 컬럼 추가
    console.log('📊 사용성 통계 컬럼 추가 중...');
    
    try {
      db.exec('ALTER TABLE memory_item ADD COLUMN view_count INTEGER DEFAULT 0');
    } catch (err: any) {
      if (!err.message.includes('duplicate column name')) {
        throw err;
      }
    }
    
    try {
      db.exec('ALTER TABLE memory_item ADD COLUMN cite_count INTEGER DEFAULT 0');
    } catch (err: any) {
      if (!err.message.includes('duplicate column name')) {
        throw err;
      }
    }
    
    try {
      db.exec('ALTER TABLE memory_item ADD COLUMN edit_count INTEGER DEFAULT 0');
    } catch (err: any) {
      if (!err.message.includes('duplicate column name')) {
        throw err;
      }
    }
    
    console.log('✅ 사용성 통계 컬럼 추가 완료');
    
    console.log('🧠 임베딩 테이블 구조 확인 중...');
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
      console.log('🧱 memory_embedding 테이블 재구성 중...');

      db.exec('DROP TRIGGER IF EXISTS memory_embedding_vec_insert;');
      db.exec('DROP TRIGGER IF EXISTS memory_embedding_vec_update;');
      db.exec('DROP TRIGGER IF EXISTS memory_embedding_vec_delete;');

      db.exec(`
        CREATE TABLE memory_embedding__new (
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
        )
      `);

      if (hasEmbeddingTable) {
        // 레거시 스키마 호환성: 각 컬럼 존재 여부 확인
        const hasEmbeddingColumn = columnInfo.some(column => column.name === 'embedding');
        const hasProvider = columnInfo.some(column => column.name === 'embedding_provider');
        const hasDimensions = columnInfo.some(column => column.name === 'dimensions');
        const hasCreatedBy = columnInfo.some(column => column.name === 'created_by');

        // embedding 컬럼이 없으면 기본값 '[]' 사용 (레거시 스키마)
        const embeddingSelect = hasEmbeddingColumn
          ? "COALESCE(NULLIF(embedding, ''), '[]')"
          : "'[]'";
        const providerSelect = hasProvider
          ? "COALESCE(NULLIF(embedding_provider, ''), 'tfidf')"
          : "'tfidf'";
        const dimensionsSelect = hasDimensions
          ? 'COALESCE(NULLIF(dimensions, 0), dim)'
          : 'dim';
        const createdBySelect = hasCreatedBy
          ? "COALESCE(NULLIF(created_by, ''), 'system')"
          : "'system'";

        db.exec(`
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
          )
          SELECT
            id,
            memory_id,
            ${providerSelect},
            'native',
            ${embeddingSelect},
            dim,
            ${dimensionsSelect},
            model,
            32,
            0,
            1,
            ${createdBySelect},
            created_at
          FROM memory_embedding
        `);

        db.exec('DROP TABLE memory_embedding;');
      }

      db.exec('ALTER TABLE memory_embedding__new RENAME TO memory_embedding;');
      console.log('✅ memory_embedding 테이블 재구성 완료');
    } else {
      console.log('✅ memory_embedding 테이블은 최신 구조입니다');
    }

    console.log('🧾 임베딩 인덱스 및 트리거 정비 중...');
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

    db.exec('DROP TRIGGER IF EXISTS memory_embedding_vec_insert;');
    db.exec('DROP TRIGGER IF EXISTS memory_embedding_vec_update;');
    db.exec('DROP TRIGGER IF EXISTS memory_embedding_vec_delete;');

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_embedding_vec_insert AFTER INSERT ON memory_embedding BEGIN
        INSERT INTO memory_item_vec(rowid, embedding)
        SELECT NEW.id, json_extract(NEW.embedding, '$')
        WHERE NEW.dimensions = 384;

        INSERT INTO memory_item_vec_tfidf(rowid, embedding)
        SELECT NEW.id, json_extract(NEW.embedding, '$')
        WHERE NEW.embedding_provider = 'tfidf' AND NEW.dimensions = 512 AND NEW.projection_type = 'native';

        INSERT INTO memory_item_vec_minilm(rowid, embedding)
        SELECT NEW.id, json_extract(NEW.embedding, '$')
        WHERE NEW.embedding_provider = 'minilm' AND NEW.dimensions = 384 AND NEW.projection_type = 'native';

        INSERT INTO memory_item_vec_openai(rowid, embedding)
        SELECT NEW.id, json_extract(NEW.embedding, '$')
        WHERE NEW.embedding_provider = 'openai' AND NEW.dimensions = 1536 AND NEW.projection_type = 'native';

        INSERT INTO memory_item_vec_gemini(rowid, embedding)
        SELECT NEW.id, json_extract(NEW.embedding, '$')
        WHERE NEW.embedding_provider = 'gemini' AND NEW.dimensions = 768 AND NEW.projection_type = 'native';
      END
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_embedding_vec_update AFTER UPDATE ON memory_embedding BEGIN
        DELETE FROM memory_item_vec WHERE rowid = NEW.id;
        DELETE FROM memory_item_vec_tfidf WHERE rowid = NEW.id;
        DELETE FROM memory_item_vec_minilm WHERE rowid = NEW.id;
        DELETE FROM memory_item_vec_openai WHERE rowid = NEW.id;
        DELETE FROM memory_item_vec_gemini WHERE rowid = NEW.id;

        INSERT INTO memory_item_vec(rowid, embedding)
        SELECT NEW.id, json_extract(NEW.embedding, '$')
        WHERE NEW.dimensions = 384;

        INSERT INTO memory_item_vec_tfidf(rowid, embedding)
        SELECT NEW.id, json_extract(NEW.embedding, '$')
        WHERE NEW.embedding_provider = 'tfidf' AND NEW.dimensions = 512 AND NEW.projection_type = 'native';

        INSERT INTO memory_item_vec_minilm(rowid, embedding)
        SELECT NEW.id, json_extract(NEW.embedding, '$')
        WHERE NEW.embedding_provider = 'minilm' AND NEW.dimensions = 384 AND NEW.projection_type = 'native';

        INSERT INTO memory_item_vec_openai(rowid, embedding)
        SELECT NEW.id, json_extract(NEW.embedding, '$')
        WHERE NEW.embedding_provider = 'openai' AND NEW.dimensions = 1536 AND NEW.projection_type = 'native';

        INSERT INTO memory_item_vec_gemini(rowid, embedding)
        SELECT NEW.id, json_extract(NEW.embedding, '$')
        WHERE NEW.embedding_provider = 'gemini' AND NEW.dimensions = 768 AND NEW.projection_type = 'native';
      END
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_embedding_vec_delete AFTER DELETE ON memory_embedding BEGIN
        DELETE FROM memory_item_vec WHERE rowid = OLD.id;
        DELETE FROM memory_item_vec_tfidf WHERE rowid = OLD.id;
        DELETE FROM memory_item_vec_minilm WHERE rowid = OLD.id;
        DELETE FROM memory_item_vec_openai WHERE rowid = OLD.id;
        DELETE FROM memory_item_vec_gemini WHERE rowid = OLD.id;
      END
    `);
    console.log('✅ 임베딩 인덱스 및 트리거 정비 완료');
    
    // 기존 데이터에 기본값 설정
    console.log('🔧 기존 데이터 업데이트 중...');
    
    db.exec(`
      UPDATE memory_item 
      SET view_count = 0, cite_count = 0, edit_count = 0 
      WHERE view_count IS NULL OR cite_count IS NULL OR edit_count IS NULL
    `);
    
    console.log('✅ 기존 데이터 업데이트 완료');
    
    // 마이그레이션 완료
    console.log('🎉 데이터베이스 마이그레이션 완료!');
    
  } catch (error) {
    const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
    console.error('❌ 마이그레이션 실패:', maskedError.message);
    throw error;
  } finally {
    db.close();
  }
}

// 마이그레이션 실행
if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  try {
    migrateDatabase();
    console.log('✅ 마이그레이션 완료');
    process.exit(0);
  } catch (error) {
    const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
    console.error('❌ 마이그레이션 실패:', maskedError.message);
    process.exit(1);
  }
}

export { migrateDatabase };
