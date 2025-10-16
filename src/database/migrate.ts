/**
 * 데이터베이스 마이그레이션 스크립트
 * 기존 데이터베이스에 새 컬럼 추가
 */

import Database from 'better-sqlite3';
import { mementoConfig } from '../config/index.js';

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
    
    // 임베딩 테이블 생성 (기존에 없다면)
    console.log('🧠 임베딩 테이블 생성 중...');
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_embedding (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL,
        embedding TEXT NOT NULL,
        dim INTEGER NOT NULL,
        model TEXT,
        embedding_provider TEXT DEFAULT 'tfidf',
        dimensions INTEGER,
        created_by TEXT DEFAULT 'system',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE,
        UNIQUE(memory_id)
      )
    `);
    
    console.log('✅ 임베딩 테이블 생성 완료');
    
    console.log('🧩 임베딩 메타데이터 컬럼 동기화 중...');
    const embeddingColumns = [
      "embedding_provider TEXT DEFAULT 'tfidf'",
      'dimensions INTEGER',
      "created_by TEXT DEFAULT 'system'"
    ];
    
    for (const column of embeddingColumns) {
      try {
        db.exec(`ALTER TABLE memory_embedding ADD COLUMN ${column}`);
      } catch (err: any) {
        if (!err.message.includes('duplicate column name')) {
          throw err;
        }
      }
    }
    console.log('✅ 임베딩 메타데이터 컬럼 동기화 완료');
    
    console.log('🧾 임베딩 인덱스 및 트리거 정비 중...');
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_embedding_provider ON memory_embedding(embedding_provider);
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_embedding_dimensions ON memory_embedding(dimensions);
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_embedding_created_by ON memory_embedding(created_by);
    `);
    
    db.exec('DROP TRIGGER IF EXISTS memory_embedding_vec_insert;');
    db.exec('DROP TRIGGER IF EXISTS memory_embedding_vec_update;');
    db.exec('DROP TRIGGER IF EXISTS memory_embedding_vec_delete;');
    
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_embedding_vec_insert AFTER INSERT ON memory_embedding BEGIN
        INSERT INTO memory_item_vec(rowid, embedding)
        VALUES (NEW.id, json_extract(NEW.embedding, '$'));
      
        INSERT INTO memory_item_vec_tfidf(rowid, embedding)
        SELECT NEW.id, json_extract(NEW.embedding, '$')
        WHERE NEW.embedding_provider = 'tfidf';
      
        INSERT INTO memory_item_vec_minilm(rowid, embedding)
        SELECT NEW.id, json_extract(NEW.embedding, '$')
        WHERE NEW.embedding_provider = 'minilm';
      
        INSERT INTO memory_item_vec_openai(rowid, embedding)
        SELECT NEW.id, json_extract(NEW.embedding, '$')
        WHERE NEW.embedding_provider = 'openai';
      
        INSERT INTO memory_item_vec_gemini(rowid, embedding)
        SELECT NEW.id, json_extract(NEW.embedding, '$')
        WHERE NEW.embedding_provider = 'gemini';
      END
    `);
    
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_embedding_vec_update AFTER UPDATE ON memory_embedding BEGIN
        UPDATE memory_item_vec
        SET embedding = json_extract(NEW.embedding, '$')
        WHERE rowid = NEW.id;
      
        UPDATE memory_item_vec_tfidf
        SET embedding = json_extract(NEW.embedding, '$')
        WHERE rowid = NEW.id AND NEW.embedding_provider = 'tfidf';
      
        UPDATE memory_item_vec_minilm
        SET embedding = json_extract(NEW.embedding, '$')
        WHERE rowid = NEW.id AND NEW.embedding_provider = 'minilm';
      
        UPDATE memory_item_vec_openai
        SET embedding = json_extract(NEW.embedding, '$')
        WHERE rowid = NEW.id AND NEW.embedding_provider = 'openai';
      
        UPDATE memory_item_vec_gemini
        SET embedding = json_extract(NEW.embedding, '$')
        WHERE rowid = NEW.id AND NEW.embedding_provider = 'gemini';
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
    console.error('❌ 마이그레이션 실패:', error);
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
    console.error('❌ 마이그레이션 실패:', error);
    process.exit(1);
  }
}

export { migrateDatabase };
