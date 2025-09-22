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

export async function initializeDatabase(): Promise<Database.Database> {
  console.log('🗄️  SQLite 데이터베이스 초기화 중...');
  
  // 데이터 디렉토리 생성
  const dbDir = dirname(mementoConfig.dbPath);
  try {
    await import('fs').then(fs => fs.promises.mkdir(dbDir, { recursive: true }));
  } catch (error) {
    // 디렉토리가 이미 존재하는 경우 무시
  }
  
  // SQLite 데이터베이스 연결
  const db = new Database(mementoConfig.dbPath);
  
  // WAL 모드 활성화 (성능 향상)
  db.pragma('journal_mode = WAL');
  
  // 외래키 제약 조건 활성화
  db.pragma('foreign_keys = ON');
  
  // 스키마 파일 읽기 및 실행
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  
  // 스키마 실행
  db.exec(schema);
  
  console.log('✅ 데이터베이스 초기화 완료');
  console.log(`📁 데이터베이스 경로: ${mementoConfig.dbPath}`);
  
  return db;
}

export function closeDatabase(db: Database.Database): void {
  db.close();
  console.log('🔒 데이터베이스 연결 종료');
}

// CLI에서 직접 실행할 때
if (import.meta.url === `file://${process.argv[1]}`) {
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
