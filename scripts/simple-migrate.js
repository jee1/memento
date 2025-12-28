#!/usr/bin/env node

/**
 * 간단한 마이그레이션 스크립트
 * 임베딩 데이터 분석
 * 
 * 리팩토링: 공통 모듈(initializeDatabase)을 사용하여 일관된 DB 초기화 보장
 * 
 * 사용법: 
 *   - 개발 환경: npx tsx scripts/simple-migrate.js
 *   - 프로덕션: npm run build && node dist/scripts/simple-migrate.js
 */

// TypeScript 소스를 직접 import (tsx로 실행 시)
// 빌드된 파일을 사용하려면 '../dist/infrastructure/database/database/init.js'로 변경
import { initializeDatabase, closeDatabase } from '../src/infrastructure/database/database/init.js';

async function analyzeEmbeddings() {
  console.log('🔍 임베딩 데이터 분석 중...');
  
  let db = null;
  
  try {
    // 공통 모듈을 사용하여 데이터베이스 초기화
    // initializeDatabase는 DB 파일이 없으면 자동으로 생성하고 초기화함
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
    
    console.log('📊 기존 데이터 분석 결과:');
    console.table(analysis);
    
    // 전체 통계
    const total = db.prepare('SELECT COUNT(*) as total FROM memory_embedding').get();
    console.log(`\n📈 총 임베딩 수: ${total.total}`);
    
    // 스키마 확인
    const schema = db.prepare("PRAGMA table_info(memory_embedding)").all();
    console.log('\n📋 현재 테이블 구조:');
    console.table(schema);
    
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

// 스크립트 실행
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1])) {
  analyzeEmbeddings().catch((error) => {
    console.error('❌ 스크립트 실행 중 오류 발생:', error);
    process.exit(1);
  });
}

export { analyzeEmbeddings };
