/**
 * SQLite 데이터베이스 초기화 스크립트
 */

import sqlite3 from 'sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mementoConfig } from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function initializeDatabase(): Promise<sqlite3.Database> {
  console.log('🗄️  SQLite 데이터베이스 초기화 중...');
  
  // 데이터 디렉토리 생성
  const dbDir = dirname(mementoConfig.dbPath);
  try {
    await import('fs').then(fs => fs.promises.mkdir(dbDir, { recursive: true }));
  } catch (error) {
    // 디렉토리가 이미 존재하는 경우 무시
  }
  
  return new Promise((resolve, reject) => {
    // SQLite 데이터베이스 연결
    const db = new sqlite3.Database(mementoConfig.dbPath, (err) => {
      if (err) {
        console.error('❌ 데이터베이스 연결 실패:', err);
        reject(err);
        return;
      }
      
      // WAL 모드 사용 (동시 읽기 성능 향상)
      db.run('PRAGMA journal_mode = WAL');
      
      // 외래키 제약 조건 활성화
      db.run('PRAGMA foreign_keys = ON');
      
      // 잠금 타임아웃 설정 (60초)
      db.run('PRAGMA busy_timeout = 60000');
      
      // 동시성 설정
      db.run('PRAGMA synchronous = NORMAL');
      db.run('PRAGMA cache_size = 10000');
      db.run('PRAGMA temp_store = MEMORY');
      
      // 스키마 파일 읽기 및 실행
      const schemaPath = join(__dirname, 'schema.sql');
      const schema = readFileSync(schemaPath, 'utf-8');
      
      // 스키마 실행
      db.exec(schema, (err) => {
        if (err) {
          console.error('❌ 스키마 실행 실패:', err);
          reject(err);
          return;
        }
        
        console.log('✅ 데이터베이스 초기화 완료');
        console.log(`📁 데이터베이스 경로: ${mementoConfig.dbPath}`);
        resolve(db);
      });
    });
  });
}

export function closeDatabase(db: sqlite3.Database): void {
  if (!db) {
    console.log('🔒 데이터베이스가 이미 닫혔습니다');
    return;
  }
  
  db.close((err) => {
    if (err) {
      // SQLITE_MISUSE 오류는 데이터베이스가 이미 닫혔을 때 발생하므로 무시
      if ((err as any).code === 'SQLITE_MISUSE') {
        console.log('🔒 데이터베이스가 이미 닫혔습니다');
      } else {
        console.error('❌ 데이터베이스 종료 실패:', err);
      }
    } else {
      console.log('🔒 데이터베이스 연결 종료');
    }
  });
}

// CLI에서 직접 실행할 때
if (process.argv[1] && process.argv[1].endsWith('init.ts')) {
  console.log('🚀 데이터베이스 초기화 스크립트 시작');
  initializeDatabase()
    .then(db => {
      console.log('🎉 데이터베이스 초기화 성공!');
      closeDatabase(db);
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ 데이터베이스 초기화 실패:', error);
      process.exit(1);
    });
}
