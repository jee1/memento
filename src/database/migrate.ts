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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE,
        UNIQUE(memory_id)
      )
    `);
    
    console.log('✅ 임베딩 테이블 생성 완료');
    
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