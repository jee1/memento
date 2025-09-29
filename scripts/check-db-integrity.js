#!/usr/bin/env node
/**
 * Memento 데이터베이스 무결성 검사 스크립트
 * 사용법: node scripts/check-db-integrity.js
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = './data/memory.db';
const LOG_PATH = './logs/db-integrity.log';

// 로그 디렉토리 생성
if (!fs.existsSync('./logs')) {
  fs.mkdirSync('./logs');
}

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(message);
  fs.appendFileSync(LOG_PATH, logMessage);
}

function checkDatabaseIntegrity() {
  log('데이터베이스 무결성 검사 시작...');
  
  try {
    // 데이터베이스 파일 존재 확인
    if (!fs.existsSync(DB_PATH)) {
      log('❌ 데이터베이스 파일이 존재하지 않습니다.');
      return false;
    }
    
    // 데이터베이스 연결 테스트
    const db = new Database(DB_PATH);
    
    // PRAGMA integrity_check 실행
    const integrityResult = db.prepare('PRAGMA integrity_check').get();
    if (integrityResult.integrity_check !== 'ok') {
      log(`❌ 데이터베이스 무결성 검사 실패: ${integrityResult.integrity_check}`);
      db.close();
      return false;
    }
    
    // 기본 테이블 존재 확인
    const tables = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name IN ('memory_item', 'memory_embedding', 'memory_tag')
    `).all();
    
    if (tables.length < 3) {
      log('❌ 필수 테이블이 누락되었습니다.');
      db.close();
      return false;
    }
    
    // 데이터 개수 확인
    const memoryCount = db.prepare('SELECT COUNT(*) as count FROM memory_item').get();
    const embeddingCount = db.prepare('SELECT COUNT(*) as count FROM memory_embedding').get();
    
    log(`✅ 데이터베이스 무결성 검사 통과`);
    log(`   - 메모리 아이템: ${memoryCount.count}개`);
    log(`   - 임베딩: ${embeddingCount.count}개`);
    log(`   - 테이블: ${tables.length}개`);
    
    db.close();
    return true;
    
  } catch (error) {
    log(`❌ 데이터베이스 검사 중 오류 발생: ${error.message}`);
    return false;
  }
}

function main() {
  const isHealthy = checkDatabaseIntegrity();
  
  if (!isHealthy) {
    log('🚨 데이터베이스에 문제가 있습니다. 백업에서 복구를 고려하세요.');
    process.exit(1);
  } else {
    log('✅ 데이터베이스가 정상 상태입니다.');
    process.exit(0);
  }
}

if (require.main === module) {
  main();
}

module.exports = { checkDatabaseIntegrity };
