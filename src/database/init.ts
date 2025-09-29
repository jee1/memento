/**
 * SQLite 데이터베이스 초기화 스크립트
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mementoConfig } from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// MCP 서버에서는 모든 로그 출력을 완전히 차단
const log = (...args: any[]) => {};

export function initializeDatabase(): Database.Database {
  log('🗄️  SQLite 데이터베이스 초기화 중...');
  
  // 데이터 디렉토리 생성
  const dbDir = dirname(mementoConfig.dbPath);
  try {
    const fs = require('fs');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  } catch (error) {
    // 디렉토리가 이미 존재하는 경우 무시
  }
  
  try {
    // SQLite 데이터베이스 연결
    const db = new Database(mementoConfig.dbPath);
    
    // WAL 모드 사용 (동시 읽기 성능 향상)
    db.pragma('journal_mode = WAL');
    
    // 외래키 제약 조건 활성화
    db.pragma('foreign_keys = ON');
    
    // FTS5 확장 로드 시도 (Docker 환경에서는 더 안정적)
    try {
      // Docker 환경에서는 FTS5가 기본적으로 포함되어 있음
      if (process.env.NODE_ENV === 'production' || process.env.DOCKER === 'true') {
        // Docker 환경에서는 FTS5가 기본 포함되어 있으므로 로드 시도하지 않음
        log('🐳 Docker 환경에서 FTS5 사용 가능');
      } else {
        // 로컬 환경에서만 확장 로드 시도
        db.loadExtension('fts5');
        log('✅ FTS5 확장 로드 완료');
      }
    } catch (error) {
      log('⚠️  FTS5 확장 로드 실패, 기본 검색으로 전환:', error);
      // FTS5가 없어도 기본 기능은 동작하도록 계속 진행
    }
    
    // 잠금 타임아웃 설정 (60초로 증가)
    db.pragma('busy_timeout = 60000');
    
    // 동시성 설정 최적화
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = 20000'); // 캐시 크기 증가
    db.pragma('temp_store = MEMORY');
    db.pragma('mmap_size = 268435456'); // 256MB 메모리 맵핑
    
    // WAL 설정 최적화 (락 문제 해결)
    db.pragma('wal_autocheckpoint = 100'); // 더 자주 체크포인트 (100페이지마다)
    db.pragma('journal_size_limit = 33554432'); // 32MB WAL 크기 제한 (더 작게)
    db.pragma('wal_checkpoint(TRUNCATE)'); // WAL 파일 정리
    
    // 추가 안정성 설정
    db.pragma('locking_mode = NORMAL'); // 정상 잠금 모드
    db.pragma('read_uncommitted = 0'); // 커밋된 읽기만 허용
    
    // 스키마 파일 읽기 및 실행
    const schemaPath = join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    
    // 스키마 실행
    db.exec(schema);
    
    log('✅ 데이터베이스 초기화 완료');
    log(`📁 데이터베이스 경로: ${mementoConfig.dbPath}`);
    
    return db;
  } catch (error) {
    log('❌ 데이터베이스 초기화 실패:', error);
    throw error;
  }
}

export function closeDatabase(db: Database.Database): void {
  if (!db) {
    log('🔒 데이터베이스가 이미 닫혔습니다');
    return;
  }
  
  try {
    db.close();
    log('🔒 데이터베이스 연결 종료');
  } catch (error) {
    log('❌ 데이터베이스 종료 실패:', error);
  }
}

// CLI에서 직접 실행할 때
if (process.argv[1] && process.argv[1].endsWith('init.ts')) {
  console.log('🚀 데이터베이스 초기화 스크립트 시작');
  try {
    const db = initializeDatabase();
    console.log('🎉 데이터베이스 초기화 성공!');
    closeDatabase(db);
    process.exit(0);
  } catch (error) {
    console.error('❌ 데이터베이스 초기화 실패:', error);
    process.exit(1);
  }
}
