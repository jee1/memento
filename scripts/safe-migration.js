#!/usr/bin/env node

/**
 * 안전한 마이그레이션 스크립트
 * 임시 데이터베이스를 사용하여 안전하게 마이그레이션 수행
 * 
 * 리팩토링: 공통 모듈(initializeDatabase)을 사용하여 일관된 DB 초기화 보장
 * 
 * 사용법: 
 *   - 개발 환경: npx tsx scripts/safe-migration.js
 *   - 프로덕션: npm run build && node dist/scripts/safe-migration.js
 */

// TypeScript 소스를 직접 import (tsx로 실행 시)
// 빌드된 파일을 사용하려면 '../dist/infrastructure/database/database/init.js'로 변경
import { initializeDatabase, closeDatabase } from '../src/infrastructure/database/database/init.js';
import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, copyFileSync, unlinkSync } from 'fs';

async function safeMigration() {
  console.log('🛡️ 안전한 마이그레이션 시작...');
  
  const dbPath = process.env.DB_PATH || join(process.cwd(), 'data', 'memory.db');
  const tempDbPath = join(process.cwd(), 'data', 'memory-temp.db');
  
  let db = null;
  let tempDb = null;
  
  try {
    // 1. 원본 데이터베이스 백업
    console.log('💾 원본 데이터베이스 백업 중...');
    const backupPath = join(process.cwd(), 'data', `memory-backup-${Date.now()}.db`);
    if (existsSync(dbPath)) {
      copyFileSync(dbPath, backupPath);
      console.log(`✅ 백업 생성: ${backupPath}`);
    }
    
    // 2. 원본 데이터베이스 초기화 (공통 모듈 사용)
    console.log('📝 원본 데이터베이스 초기화 중...');
    db = await initializeDatabase();
    
    // 3. 임시 데이터베이스 생성
    console.log('📝 임시 데이터베이스 생성 중...');
    tempDb = new Database(tempDbPath);
    
    // 4. 스키마 복사 (vec0 관련 부분 제외)
    console.log('📋 스키마 복사 중...');
    tempDb.exec(`
      CREATE TABLE memory_item (
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
    
    tempDb.exec(`
      CREATE TABLE memory_embedding (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL,
        embedding TEXT NOT NULL,
        dim INTEGER NOT NULL,
        model TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        embedding_provider TEXT,
        dimensions INTEGER,
        created_by TEXT DEFAULT 'migration',
        FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE,
        UNIQUE(memory_id)
      );
    `);
    
    // 5. 데이터 복사
    console.log('📊 데이터 복사 중...');
    
    // 원본 데이터베이스 연결
    tempDb.exec(`ATTACH DATABASE '${dbPath}' AS source`);
    
    // memory_item 데이터 복사
    tempDb.exec(`INSERT INTO memory_item SELECT * FROM source.memory_item`);
    
    // memory_embedding 데이터 복사 및 업데이트
    tempDb.exec(`
      INSERT INTO memory_embedding (memory_id, embedding, dim, model, created_at, embedding_provider, dimensions, created_by)
      SELECT 
        memory_id,
        embedding,
        dim,
        model,
        created_at,
        CASE 
          WHEN model = 'lightweight-hybrid' THEN 'tfidf'
          WHEN model IS NULL OR model = '' THEN 'tfidf'
          ELSE 'unknown'
        END,
        dim,
        'legacy'
      FROM source.memory_embedding
    `);
    
    tempDb.exec('DETACH DATABASE source');
    
    // 6. 인덱스 추가
    console.log('📝 인덱스 추가 중...');
    tempDb.exec('CREATE INDEX IF NOT EXISTS idx_memory_embedding_provider ON memory_embedding(embedding_provider)');
    tempDb.exec('CREATE INDEX IF NOT EXISTS idx_memory_embedding_dimensions ON memory_embedding(dimensions)');
    tempDb.exec('CREATE INDEX IF NOT EXISTS idx_memory_embedding_created_by ON memory_embedding(created_by)');
    
    // 7. 검증
    console.log('🔍 검증 중...');
    const validation = tempDb.prepare(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN embedding_provider IS NOT NULL THEN 1 END) as with_provider,
        COUNT(CASE WHEN dimensions IS NOT NULL THEN 1 END) as with_dimensions,
        COUNT(CASE WHEN created_by IS NOT NULL THEN 1 END) as with_created_by
      FROM memory_embedding
    `).get();
    
    console.log('📊 검증 결과:');
    console.table(validation);
    
    // 8. 임시 DB를 원본으로 교체
    console.log('🔄 데이터베이스 교체 중...');
    closeDatabase(db);
    closeDatabase(tempDb);
    
    // 원본 백업
    if (existsSync(dbPath)) {
      const finalBackup = join(process.cwd(), 'data', `memory-pre-migration-${Date.now()}.db`);
      copyFileSync(dbPath, finalBackup);
      console.log(`✅ 최종 백업: ${finalBackup}`);
    }
    
    // 임시 DB를 원본으로 교체
    copyFileSync(tempDbPath, dbPath);
    console.log('✅ 데이터베이스 교체 완료');
    
    // 임시 DB 삭제
    if (existsSync(tempDbPath)) {
      unlinkSync(tempDbPath);
    }
    
    console.log('\n🎉 안전한 마이그레이션 완료!');
    console.log(`💾 백업 파일: ${backupPath}`);
    
  } catch (error) {
    console.error('❌ 마이그레이션 실패:', error.message);
    if (error.stack) {
      console.error('   스택 트레이스:', error.stack);
    }
    
    // 임시 DB 정리
    if (tempDb) {
      try {
        closeDatabase(tempDb);
      } catch (e) {
        // 무시
      }
    }
    if (existsSync(tempDbPath)) {
      try {
        unlinkSync(tempDbPath);
      } catch (e) {
        // 무시
      }
    }
    
    console.log(`🔄 백업에서 복원하려면: cp ${backupPath} ${dbPath}`);
    process.exit(1);
  } finally {
    // 데이터베이스 연결 종료
    if (db) {
      closeDatabase(db);
    }
    if (tempDb) {
      closeDatabase(tempDb);
    }
  }
}

// 스크립트 실행
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1])) {
  safeMigration().catch((error) => {
    console.error('❌ 스크립트 실행 중 오류 발생:', error);
    process.exit(1);
  });
}

export { safeMigration };
