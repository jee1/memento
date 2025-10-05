#!/usr/bin/env node

import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, copyFileSync } from 'fs';

const dbPath = join(process.cwd(), 'data', 'memory.db');
const tempDbPath = join(process.cwd(), 'data', 'memory-temp.db');

console.log('🛡️ 안전한 마이그레이션 시작...');

try {
  // 1. 원본 데이터베이스 백업
  console.log('💾 원본 데이터베이스 백업 중...');
  const backupPath = join(process.cwd(), 'data', `memory-backup-${Date.now()}.db`);
  copyFileSync(dbPath, backupPath);
  console.log(`✅ 백업 생성: ${backupPath}`);
  
  // 2. 임시 데이터베이스 생성 (sqlite-vec 없이)
  console.log('📝 임시 데이터베이스 생성 중...');
  const tempDb = new Database(tempDbPath);
  
  // 3. 스키마 복사 (vec0 관련 부분 제외)
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
  
  // 4. 데이터 복사
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
      END as embedding_provider,
      dim as dimensions,
      'legacy' as created_by
    FROM source.memory_embedding
  `);
  
  tempDb.exec('DETACH DATABASE source');
  
  console.log('✅ 데이터 복사 완료');
  
  // 5. 인덱스 생성
  console.log('📝 인덱스 생성 중...');
  tempDb.exec('CREATE INDEX IF NOT EXISTS idx_memory_embedding_provider ON memory_embedding(embedding_provider)');
  tempDb.exec('CREATE INDEX IF NOT EXISTS idx_memory_embedding_dimensions ON memory_embedding(dimensions)');
  tempDb.exec('CREATE INDEX IF NOT EXISTS idx_memory_embedding_created_by ON memory_embedding(created_by)');
  
  tempDb.close();
  
  // 6. 원본 데이터베이스 교체
  console.log('🔄 데이터베이스 교체 중...');
  copyFileSync(tempDbPath, dbPath);
  
  // 7. 임시 파일 정리
  if (existsSync(tempDbPath)) {
    const fs = require('fs');
    fs.unlinkSync(tempDbPath);
  }
  
  // 8. 검증
  console.log('🔍 마이그레이션 검증 중...');
  const db = new Database(dbPath);
  
  const validation = db.prepare(`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN embedding_provider IS NOT NULL THEN 1 END) as with_provider,
      COUNT(CASE WHEN dimensions IS NOT NULL THEN 1 END) as with_dimensions,
      COUNT(CASE WHEN created_by IS NOT NULL THEN 1 END) as with_created_by
    FROM memory_embedding
  `).get();
  
  console.log('📊 검증 결과:');
  console.table(validation);
  
  const finalAnalysis = db.prepare(`
    SELECT 
      embedding_provider,
      dimensions,
      COUNT(*) as count
    FROM memory_embedding 
    GROUP BY embedding_provider, dimensions
    ORDER BY count DESC
  `).all();
  
  console.log('\n📊 최종 데이터 분포:');
  console.table(finalAnalysis);
  
  db.close();
  
  console.log('\n🎉 마이그레이션 완료!');
  console.log(`💾 백업 파일: ${backupPath}`);
  console.log('🔄 롤백이 필요한 경우: cp ' + backupPath + ' ' + dbPath);
  
} catch (error) {
  console.error('❌ 마이그레이션 실패:', error.message);
  if (typeof backupPath !== 'undefined') {
    console.log(`🔄 백업에서 복원하려면: cp ${backupPath} ${dbPath}`);
  }
  process.exit(1);
}
