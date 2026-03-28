#!/usr/bin/env node

/**
 * 간단한 데이터 업데이트 스크립트 (레거시)
 * 임베딩 메타데이터 업데이트
 * 
 * ⚠️  레거시 스크립트: 이 스크립트는 simple-update-wrapper.ts(래퍼)로 대체되었습니다.
 * simple-update-wrapper.ts는 정식 마이그레이션 시스템(MigrationRunner)을 사용합니다.
 * 
 * 사용법: 
 *   - 권장: npx tsx scripts/simple-update-wrapper.ts
 *   - 레거시: npx tsx scripts/simple-update.js (하위 호환성 유지)
 * 
 * @deprecated simple-update-wrapper.ts를 사용하세요
 */

// TypeScript 소스를 직접 import (tsx로 실행 시)
// 빌드된 파일을 사용하려면 '../dist/infrastructure/database/database/init.js'로 변경
import { initializeDatabase, closeDatabase } from '../src/infrastructure/database/database/init.js';
import { join } from 'path';
import { existsSync, copyFileSync } from 'fs';

async function updateEmbeddings() {
  console.log('🔧 간단한 데이터 업데이트 시작...');
  
  let db = null;
  
  try {
    // 공통 모듈을 사용하여 데이터베이스 초기화
    // initializeDatabase는 DB 파일이 없으면 자동으로 생성하고 초기화함
    db = await initializeDatabase();
    
    // 1. 백업 생성
    const dbPath = process.env.DB_PATH || join(process.cwd(), 'data', 'memory.db');
    const backupPath = join(process.cwd(), 'data', `memory-backup-${Date.now()}.db`);
    
    if (existsSync(dbPath)) {
      copyFileSync(dbPath, backupPath);
      console.log(`✅ 백업 생성: ${backupPath}`);
    }
    
    // 2. 현재 상태 확인
    console.log('📊 현재 상태 확인...');
    const currentSchema = db.prepare("PRAGMA table_info(memory_embedding)").all();
    console.log('현재 테이블 구조:');
    console.table(currentSchema);
    
    // 3. 컬럼 추가 (이미 있는 경우 무시)
    console.log('📝 컬럼 추가 중...');
    
    try {
      db.exec('ALTER TABLE memory_embedding ADD COLUMN embedding_provider TEXT');
      console.log('✅ embedding_provider 컬럼 추가');
    } catch (error) {
      if (error.message.includes('duplicate column name')) {
        console.log('ℹ️ embedding_provider 컬럼이 이미 존재합니다');
      } else {
        console.warn('⚠️ embedding_provider 컬럼 추가 실패:', error.message);
      }
    }
    
    try {
      db.exec('ALTER TABLE memory_embedding ADD COLUMN dimensions INTEGER');
      console.log('✅ dimensions 컬럼 추가');
    } catch (error) {
      if (error.message.includes('duplicate column name')) {
        console.log('ℹ️ dimensions 컬럼이 이미 존재합니다');
      } else {
        console.warn('⚠️ dimensions 컬럼 추가 실패:', error.message);
      }
    }
    
    try {
      db.exec('ALTER TABLE memory_embedding ADD COLUMN created_by TEXT DEFAULT "migration"');
      console.log('✅ created_by 컬럼 추가');
    } catch (error) {
      if (error.message.includes('duplicate column name')) {
        console.log('ℹ️ created_by 컬럼이 이미 존재합니다');
      } else {
        console.warn('⚠️ created_by 컬럼 추가 실패:', error.message);
      }
    }
    
    // 4. 데이터 업데이트
    console.log('🔄 데이터 업데이트 중...');
    
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
    console.log('🔍 검증 중...');
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
    
    console.log('\n🎉 업데이트 완료!');
    if (existsSync(backupPath)) {
      console.log(`💾 백업 파일: ${backupPath}`);
      console.log('🔄 롤백이 필요한 경우: cp ' + backupPath + ' ' + dbPath);
    }
    
  } catch (error) {
    console.error('❌ 업데이트 실패:', error.message);
    if (error.stack) {
      console.error('   스택 트레이스:', error.stack);
    }
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
  updateEmbeddings().catch((error) => {
    console.error('❌ 스크립트 실행 중 오류 발생:', error);
    process.exit(1);
  });
}

export { updateEmbeddings };
