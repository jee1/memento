#!/usr/bin/env node

/**
 * simple-migrate.js 래퍼
 * 
 * 4.3.2: simple-migrate.js를 MigrationRunner를 호출하는 래퍼로 변경
 * 
 * 참고: simple-migrate.js는 실제로 마이그레이션이 아니라 임베딩 데이터 분석 스크립트입니다.
 * 따라서 이 래퍼는 기존 분석 기능을 유지하면서, 필요시 마이그레이션 시스템을 활용할 수 있도록 합니다.
 * 
 * 사용법:
 *   npx tsx scripts/simple-migrate-wrapper.ts
 *   또는
 *   node dist/scripts/simple-migrate-wrapper.js
 */

import { initializeDatabase, closeDatabase } from '../packages/memento-core/src/infrastructure/database/database/init.js';
import { logger } from '../packages/memento-core/src/shared/utils/logger.js';

/**
 * simple-migrate.js의 기능 (임베딩 데이터 분석)
 * 
 * 이 함수는 기존 simple-migrate.js의 분석 기능을 유지합니다.
 * 실제 마이그레이션은 필요시 정식 마이그레이션 시스템을 통해 수행됩니다.
 */
async function analyzeEmbeddings() {
  logger.info('🔍 임베딩 데이터 분석 중...');
  console.log('🔍 임베딩 데이터 분석 중...');
  
  let db = null;
  
  try {
    // 공통 모듈을 사용하여 데이터베이스 초기화
    db = await initializeDatabase();
    
    // 기존 데이터 분석
    const analysis = db.prepare(`
      SELECT 
        dim,
        model,
        COUNT(*) as count
      FROM memory_embedding 
      GROUP BY dim, model
      ORDER BY count DESC
    `).all();
    
    logger.info('📊 기존 데이터 분석 결과', { recordCount: analysis.length });
    console.log('📊 기존 데이터 분석 결과:');
    console.table(analysis);
    
    // 전체 통계
    const total = db.prepare('SELECT COUNT(*) as total FROM memory_embedding').get() as { total: number };
    logger.info(`📈 총 임베딩 수: ${total.total}`);
    console.log(`\n📈 총 임베딩 수: ${total.total}`);
    
    // 스키마 확인
    const schema = db.prepare("PRAGMA table_info(memory_embedding)").all();
    logger.info('📋 현재 테이블 구조 확인', { columnCount: schema.length });
    console.log('\n📋 현재 테이블 구조:');
    console.table(schema);
    
    // 마이그레이션 상태 확인 (선택적)
    try {
      const migrationStatus = db.prepare(`
        SELECT version, migration_name, applied_at 
        FROM memento_schema_version 
        ORDER BY applied_at DESC 
        LIMIT 5
      `).all();
      
      if (migrationStatus.length > 0) {
        logger.info('📋 최근 마이그레이션 상태', { count: migrationStatus.length });
        console.log('\n📋 최근 마이그레이션 상태:');
        console.table(migrationStatus);
      }
    } catch {
      // memento_schema_version 테이블이 없으면 무시
    }
    
  } catch (error) {
    logger.error('❌ 오류 발생', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    console.error('❌ 오류 발생:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
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
  analyzeEmbeddings().catch((error) => {
    logger.error('❌ 스크립트 실행 중 오류 발생', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    console.error('❌ 스크립트 실행 중 오류 발생:', error);
    process.exit(1);
  });
}

export { analyzeEmbeddings };

