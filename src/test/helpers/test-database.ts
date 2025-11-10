/**
 * 테스트용 데이터베이스 헬퍼 유틸리티
 * 표준화된 테스트 DB 초기화 및 관리
 */

import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../utils/database.js';

/**
 * 표준화된 테스트 데이터베이스 초기화
 * 
 * @returns 초기화된 SQLite 데이터베이스 인스턴스
 */
export async function setupTestDatabase(): Promise<Database.Database> {
  const db = new Database(':memory:');
  
  // 1. 기본 스키마 초기화
  await DatabaseUtils.initializeDatabase(db);
  
  // 2. VEC 확장 로딩 (벡터 검색 기능 활성화)
  // sqlite-vec 패키지의 getLoadablePath()를 사용하여 확장 경로 가져오기
  // 테스트 환경에서는 VEC 확장이 없을 수 있으므로 try-catch로 처리
  let vecExtensionLoaded = false;
  try {
    const { getLoadablePath } = await import('sqlite-vec');
    const extensionPath = getLoadablePath();
    db.loadExtension(extensionPath);
    vecExtensionLoaded = true;
  } catch (error) {
    // VEC 확장이 없는 경우 벡터 테이블은 생성하지 않음
    // 테스트는 벡터 기능 없이도 진행 가능하도록 설계
  }
  
  // 3. 벡터 테이블 초기화 (VEC 확장이 로드된 경우에만)
  if (vecExtensionLoaded) {
    const vecTables = [
      { name: 'memory_item_vec_tfidf', dimension: 384 },
      { name: 'memory_item_vec_minilm', dimension: 384 },
      { name: 'memory_item_vec_openai', dimension: 1536 },
      { name: 'memory_item_vec_gemini', dimension: 768 }
    ];
    
    for (const table of vecTables) {
      try {
        db.exec(`DROP TABLE IF EXISTS ${table.name}`);
        db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${table.name} USING vec0(embedding float[${table.dimension}])`);
      } catch (error) {
        // 벡터 테이블 생성 실패는 무시 (테스트는 계속 진행)
      }
    }
  }
  
  // 4. anchor 테이블 초기화
  db.exec(`
    CREATE TABLE IF NOT EXISTS anchor (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      slot TEXT CHECK (slot IN ('A', 'B', 'C')) NOT NULL,
      memory_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE SET NULL,
      UNIQUE(agent_id, slot)
    );
    CREATE INDEX IF NOT EXISTS idx_anchor_agent_slot ON anchor(agent_id, slot);
    CREATE INDEX IF NOT EXISTS idx_anchor_memory_id ON anchor(memory_id) WHERE memory_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_anchor_agent_memory ON anchor(agent_id, memory_id) WHERE memory_id IS NOT NULL;
  `);
  
  return db;
}

/**
 * 표준화된 테스트 메모리 생성 헬퍼
 * 
 * @param db 데이터베이스 인스턴스
 * @param options 메모리 생성 옵션
 * @returns 생성된 메모리 ID
 */
export function createTestMemory(
  db: Database.Database,
  options: {
    id?: string;
    type?: 'working' | 'episodic' | 'semantic' | 'procedural';
    content: string;
    importance?: number;
    privacy_scope?: 'private' | 'team' | 'public';
    pinned?: boolean;
    tags?: string[];
    source?: string;
  }
): string {
  const memoryId = options.id || `mem_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const type = options.type || 'episodic';
  const importance = options.importance ?? 0.5;
  const privacy_scope = options.privacy_scope || 'private';
  const pinned = options.pinned ?? false;
  const tags = options.tags ? JSON.stringify(options.tags) : null;
  
  DatabaseUtils.run(db, `
    INSERT INTO memory_item (id, type, content, importance, privacy_scope, pinned, tags, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    memoryId,
    type,
    options.content,
    importance,
    privacy_scope,
    pinned ? 1 : 0,
    tags,
    options.source || null
  ]);
  
  return memoryId;
}

/**
 * 테스트 데이터베이스 정리
 * 
 * @param db 데이터베이스 인스턴스
 */
export function cleanupTestDatabase(db: Database.Database): void {
  try {
    db.close();
  } catch (error) {
    // 이미 닫혀있거나 오류가 발생해도 무시
  }
}

