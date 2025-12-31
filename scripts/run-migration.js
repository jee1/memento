#!/usr/bin/env node

/**
 * 마이그레이션 실행 스크립트
 * 임베딩 메타데이터 마이그레이션
 * 
 * 리팩토링: 공통 모듈(initializeDatabase)을 사용하여 일관된 DB 초기화 보장
 * 
 * 사용법: 
 *   - 개발 환경: npx tsx scripts/run-migration.js
 *   - 프로덕션: npm run build && node dist/scripts/run-migration.js
 */

// TypeScript 소스를 직접 import (tsx로 실행 시)
// 빌드된 파일을 사용하려면 '../dist/infrastructure/database/database/init.js'로 변경
import { initializeDatabase, closeDatabase } from '../src/infrastructure/database/database/init.js';
import { join } from 'path';
import { existsSync, copyFileSync } from 'fs';

async function runMigration() {
  console.log('🚀 임베딩 데이터 마이그레이션 시작...');
  
  const dbPath = process.env.DB_PATH || join(process.cwd(), 'data', 'memory.db');
  const backupPath = join(process.cwd(), 'data', `memory-backup-${Date.now()}.db`);
  
  let db = null;
  
  try {
    // 1. 백업 생성
    console.log('💾 백업 생성 중...');
    if (existsSync(dbPath)) {
      copyFileSync(dbPath, backupPath);
      console.log(`✅ 백업 생성 완료: ${backupPath}`);
    }
    
    // 2. 공통 모듈을 사용하여 데이터베이스 초기화
    // initializeDatabase는 DB 파일이 없으면 자동으로 생성하고 초기화함
    db = await initializeDatabase();
    
    // 3. 새로운 컬럼 추가
    console.log('📝 새로운 컬럼 추가 중...');
    
    try {
      db.exec('ALTER TABLE memory_embedding ADD COLUMN embedding_provider TEXT');
      console.log('✅ embedding_provider 컬럼 추가');
    } catch (error) {
      if (error.message.includes('duplicate column name')) {
        console.log('ℹ️ embedding_provider 컬럼이 이미 존재합니다');
      } else {
        throw error;
      }
    }
    
    try {
      db.exec('ALTER TABLE memory_embedding ADD COLUMN dimensions INTEGER');
      console.log('✅ dimensions 컬럼 추가');
    } catch (error) {
      if (error.message.includes('duplicate column name')) {
        console.log('ℹ️ dimensions 컬럼이 이미 존재합니다');
      } else {
        throw error;
      }
    }
    
    try {
      db.exec('ALTER TABLE memory_embedding ADD COLUMN created_by TEXT DEFAULT "migration"');
      console.log('✅ created_by 컬럼 추가');
    } catch (error) {
      if (error.message.includes('duplicate column name')) {
        console.log('ℹ️ created_by 컬럼이 이미 존재합니다');
      } else {
        throw error;
      }
    }
    
    // 4. 기존 데이터 업데이트
    console.log('🔄 기존 데이터 업데이트 중...');
    
    const updateResult = db.prepare(`
      UPDATE memory_embedding 
      SET 
        embedding_provider = CASE 
          WHEN model = 'lightweight-hybrid' THEN 'tfidf'
          WHEN model IS NULL OR model = '' THEN 'tfidf'
          ELSE 'unknown'
        END,
        dimensions = dim,
        created_by = 'legacy'
      WHERE embedding_provider IS NULL
    `).run();
    
    console.log(`✅ ${updateResult.changes}개 레코드 업데이트 완료`);
    
    // 5. 인덱스 추가
    console.log('📝 인덱스 추가 중...');
    
    db.exec('CREATE INDEX IF NOT EXISTS idx_memory_embedding_provider ON memory_embedding(embedding_provider)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_memory_embedding_dimensions ON memory_embedding(dimensions)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_memory_embedding_created_by ON memory_embedding(created_by)');
    
    console.log('✅ 인덱스 추가 완료');
    
    // 6. 검증
    console.log('🔍 마이그레이션 검증 중...');
    
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
    
    // 7. 최종 결과 확인
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
    
    console.log('\n🎉 마이그레이션 완료!');
    console.log(`💾 백업 파일: ${backupPath}`);
    console.log('🔄 롤백이 필요한 경우: cp ' + backupPath + ' ' + dbPath);
    
  } catch (error) {
    console.error('❌ 마이그레이션 실패:', error.message);
    if (error.stack) {
      console.error('   스택 트레이스:', error.stack);
    }
    console.log(`🔄 백업에서 복원하려면: cp ${backupPath} ${dbPath}`);
    process.exit(1);
  } finally {
    // 데이터베이스 연결 종료
    if (db) {
      closeDatabase(db);
    }
  }
}

// 스크립트 실행
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1])) {
  runMigration().catch((error) => {
    console.error('❌ 스크립트 실행 중 오류 발생:', error);
    process.exit(1);
  });
}

export { runMigration };
