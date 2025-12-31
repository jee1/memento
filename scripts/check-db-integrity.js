#!/usr/bin/env node
/**
 * Memento 데이터베이스 무결성 검사 스크립트
 * 
 * 리팩토링: 공통 모듈(initializeDatabase)을 사용하여 일관된 DB 초기화 보장
 * 
 * 사용법: 
 *   - 개발 환경: npx tsx scripts/check-db-integrity.js
 *   - 프로덕션: npm run build && node dist/scripts/check-db-integrity.js
 */

// TypeScript 소스를 직접 import (tsx로 실행 시)
// 빌드된 파일을 사용하려면 '../dist/infrastructure/database/database/init.js'로 변경
import { initializeDatabase, closeDatabase } from '../src/infrastructure/database/database/init.js';
import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';

const LOG_PATH = './logs/db-integrity.log';

// 로그 디렉토리 생성
if (!existsSync('./logs')) {
  mkdirSync('./logs', { recursive: true });
}

/**
 * 로그 메시지 출력 및 파일 기록
 */
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(message);
  appendFileSync(LOG_PATH, logMessage);
}

/**
 * 데이터베이스 무결성 검사
 * 
 * @returns {Promise<boolean>} 검사 통과 여부
 */
async function checkDatabaseIntegrity() {
  log('데이터베이스 무결성 검사 시작...');
  
  let db = null;
  
  try {
    // 공통 모듈을 사용하여 데이터베이스 초기화
    // initializeDatabase는 DB 파일이 없으면 자동으로 생성하고 초기화함
    db = await initializeDatabase();
    
    // PRAGMA integrity_check 실행
    const integrityResult = db.prepare('PRAGMA integrity_check').get();
    if (integrityResult.integrity_check !== 'ok') {
      log(`❌ 데이터베이스 무결성 검사 실패: ${integrityResult.integrity_check}`);
      return false;
    }
    
    // 기본 테이블 존재 확인
    const tables = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name IN ('memory_item', 'memory_embedding', 'memory_tag')
    `).all();
    
    if (tables.length < 3) {
      log('❌ 필수 테이블이 누락되었습니다.');
      log(`   발견된 테이블: ${tables.map(t => t.name).join(', ')}`);
      return false;
    }
    
    // 데이터 개수 확인
    const memoryCount = db.prepare('SELECT COUNT(*) as count FROM memory_item').get();
    const embeddingCount = db.prepare('SELECT COUNT(*) as count FROM memory_embedding').get();
    
    log(`✅ 데이터베이스 무결성 검사 통과`);
    log(`   - 메모리 아이템: ${memoryCount.count}개`);
    log(`   - 임베딩: ${embeddingCount.count}개`);
    log(`   - 테이블: ${tables.length}개`);
    
    return true;
    
  } catch (error) {
    log(`❌ 데이터베이스 검사 중 오류 발생: ${error.message}`);
    if (error.stack) {
      log(`   스택 트레이스: ${error.stack}`);
    }
    return false;
  } finally {
    // 데이터베이스 연결 종료
    if (db) {
      closeDatabase(db);
    }
  }
}

/**
 * 메인 함수
 */
async function main() {
  const isHealthy = await checkDatabaseIntegrity();
  
  if (!isHealthy) {
    log('🚨 데이터베이스에 문제가 있습니다. 백업에서 복구를 고려하세요.');
    process.exit(1);
  } else {
    log('✅ 데이터베이스가 정상 상태입니다.');
    process.exit(0);
  }
}

// 스크립트가 직접 실행될 때만 main 함수 호출
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1])) {
  main().catch((error) => {
    console.error('❌ 스크립트 실행 중 오류 발생:', error);
    process.exit(1);
  });
}

export { checkDatabaseIntegrity };
