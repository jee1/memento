/**
 * SQLite 데이터베이스 초기화 스크립트
 */

import Database from 'better-sqlite3';
import fs, { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mementoConfig } from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// MCP 서버에서는 모든 로그 출력을 완전히 차단
const log = (...args: any[]) => {};

export async function initializeDatabase(): Promise<Database.Database> {
  log('🗄️  SQLite 데이터베이스 초기화 중...');
  
  // 데이터 디렉토리 생성
  const dbDir = dirname(mementoConfig.dbPath);
  try {
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
        log('🐳 Docker 환경에서 FTS5 사용 가능');
      } else {
        db.loadExtension('fts5');
        log('✅ FTS5 확장 로드 완료');
      }
    } catch (error) {
      log('⚠️  FTS5 확장 로드 실패, 기본 검색으로 전환:', error);
    }
    
    db.pragma('busy_timeout = 60000');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = 20000');
    db.pragma('temp_store = MEMORY');
    db.pragma('mmap_size = 268435456');
    db.pragma('wal_autocheckpoint = 100');
    db.pragma('journal_size_limit = 33554432');
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.pragma('locking_mode = NORMAL');
    db.pragma('read_uncommitted = 0');
    
    try {
      const { getLoadablePath } = await import('sqlite-vec');
      const extensionPath = getLoadablePath();
      db.loadExtension(extensionPath);
      console.log('✅ sqlite-vec 확장 로드 성공');
    } catch (error) {
      console.warn('⚠️ sqlite-vec 확장 로드 실패 (벡터 검색 기능 비활성화):', error);
    }
    
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
  (async () => {
    try {
      const db = await initializeDatabase();
      console.log('🎉 데이터베이스 초기화 성공!');
      closeDatabase(db);
      process.exit(0);
    } catch (error) {
      console.error('❌ 데이터베이스 초기화 실패:', error);
      process.exit(1);
    }
  })();
}
