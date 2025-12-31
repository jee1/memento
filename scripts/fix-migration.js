#!/usr/bin/env node
/**
 * Memento 마이그레이션 수정 스크립트
 * 
 * 리팩토링: 공통 모듈(initializeDatabase)을 사용하여 일관된 DB 초기화 보장
 * 
 * 사용법: 
 *   - 개발 환경: npx tsx scripts/fix-migration.js
 *   - 프로덕션: npm run build && node dist/scripts/fix-migration.js
 */

// TypeScript 소스를 직접 import (tsx로 실행 시)
// 빌드된 파일을 사용하려면 '../dist/infrastructure/database/database/init.js'로 변경
import { initializeDatabase, closeDatabase } from '../src/infrastructure/database/database/init.js';

console.log('🔧 마이그레이션 수정 중...');

/**
 * 마이그레이션 수정 메인 함수
 */
async function fixMigration() {
  let db = null;
  
  try {
    // 공통 모듈을 사용하여 데이터베이스 초기화
    // initializeDatabase는 DB 파일이 없으면 자동으로 생성하고 초기화함
    db = await initializeDatabase();
    
    // 1. 현재 상태 확인
    console.log('📊 현재 상태 확인...');
    const currentSchema = db.prepare("PRAGMA table_info(memory_embedding)").all();
    console.log('현재 테이블 구조:');
    console.table(currentSchema);
    
    // 2. 컬럼이 있는지 확인
    const hasProvider = currentSchema.some(col => col.name === 'embedding_provider');
    const hasDimensions = currentSchema.some(col => col.name === 'dimensions');
    const hasCreatedBy = currentSchema.some(col => col.name === 'created_by');
    
    console.log(`embedding_provider: ${hasProvider ? '✅' : '❌'}`);
    console.log(`dimensions: ${hasDimensions ? '✅' : '❌'}`);
    console.log(`created_by: ${hasCreatedBy ? '✅' : '❌'}`);
    
    // 3. 데이터 업데이트 (컬럼이 있는 경우에만)
    if (hasProvider && hasDimensions && hasCreatedBy) {
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
      
      // 4. 인덱스 추가
      console.log('📝 인덱스 추가 중...');
      db.exec('CREATE INDEX IF NOT EXISTS idx_memory_embedding_provider ON memory_embedding(embedding_provider)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_memory_embedding_dimensions ON memory_embedding(dimensions)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_memory_embedding_created_by ON memory_embedding(created_by)');
      console.log('✅ 인덱스 추가 완료');
      
      // 5. 최종 검증
      console.log('🔍 최종 검증...');
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
      
      // 6. 최종 데이터 분포
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
      
    } else {
      console.log('❌ 필요한 컬럼이 없습니다. 스키마를 먼저 업데이트해주세요.');
      console.log('   initializeDatabase가 자동으로 스키마를 생성하지만, 필요한 컬럼이 없을 수 있습니다.');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ 오류 발생:', error.message);
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

// 스크립트가 직접 실행될 때만 main 함수 호출
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1])) {
  fixMigration().catch((error) => {
    console.error('❌ 스크립트 실행 중 오류 발생:', error);
    process.exit(1);
  });
}

export { fixMigration };
