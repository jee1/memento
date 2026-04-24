/**
 * 테스트용 데이터베이스 헬퍼 유틸리티
 * 표준화된 테스트 DB 초기화 및 관리
 */

import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../shared/utils/database.js';

/**
 * 표준화된 테스트 데이터베이스 초기화
 * 
 * @returns 초기화된 SQLite 데이터베이스 인스턴스
 */
export async function setupTestDatabase(): Promise<Database.Database> {
  const db = new Database(':memory:');
  
  // 1. 기본 스키마 초기화
  await DatabaseUtils.initializeDatabase(db);
  
  // 1.5. FTS5 트리거 업데이트 (reflection_notes 포함)
  // 기존 트리거를 삭제하고 새로 생성하여 reflection_notes를 포함하도록 함
  try {
    db.exec('DROP TRIGGER IF EXISTS memory_item_fts_insert');
    db.exec('DROP TRIGGER IF EXISTS memory_item_fts_update');
    db.exec('DROP TRIGGER IF EXISTS memory_item_fts_delete');
    
    // reflection_notes 정규화 함수 등록
    const { normalizeReflectionNotes } = await import('../../utils/reflection-notes-normalize.js');
    db.function('normalize_reflection_notes', {
      deterministic: true,
      varargs: false
    }, (reflectionNotes: string | null) => {
      return normalizeReflectionNotes(reflectionNotes);
    });
    
    // 새 트리거 생성 (reflection_notes 포함)
    db.exec(`
      CREATE TRIGGER memory_item_fts_insert AFTER INSERT ON memory_item BEGIN
        INSERT INTO memory_item_fts(rowid, content, tags, source, reflection_notes)
        VALUES (new.rowid, new.content, new.tags, new.source, normalize_reflection_notes(new.reflection_notes));
      END
    `);
    
    db.exec(`
      CREATE TRIGGER memory_item_fts_update AFTER UPDATE ON memory_item BEGIN
        INSERT INTO memory_item_fts(memory_item_fts, rowid, content, tags, source, reflection_notes)
        VALUES('delete', old.rowid, old.content, old.tags, old.source, normalize_reflection_notes(old.reflection_notes));
        INSERT INTO memory_item_fts(rowid, content, tags, source, reflection_notes)
        VALUES (new.rowid, new.content, new.tags, new.source, normalize_reflection_notes(new.reflection_notes));
      END
    `);
    
    db.exec(`
      CREATE TRIGGER memory_item_fts_delete AFTER DELETE ON memory_item BEGIN
        INSERT INTO memory_item_fts(memory_item_fts, rowid, content, tags, source, reflection_notes)
        VALUES('delete', old.rowid, old.content, old.tags, old.source, normalize_reflection_notes(old.reflection_notes));
      END
    `);
  } catch (error) {
    // FTS5 트리거 업데이트 실패는 무시 (테스트는 계속 진행)
  }
  
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
      { name: 'memory_item_vec', dimension: 384 },
      { name: 'memory_item_vec_tfidf', dimension: 512 },
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
  
  // 5. AriGraph Pipeline 스키마 확장 (008-arigraph-schema-expansion.sql)
  // memory_item 테이블에 subject, predicate, object 컬럼 추가
  try {
    // 컬럼이 이미 존재하는지 확인
    const columns = DatabaseUtils.all(db, `
      SELECT name FROM pragma_table_info('memory_item')
    `) as Array<{ name: string }>;
    
    const columnNames = columns.map(c => c.name);
    
    if (!columnNames.includes('subject')) {
      db.exec('ALTER TABLE memory_item ADD COLUMN subject TEXT');
    }
    if (!columnNames.includes('predicate')) {
      db.exec('ALTER TABLE memory_item ADD COLUMN predicate TEXT');
    }
    if (!columnNames.includes('object')) {
      db.exec('ALTER TABLE memory_item ADD COLUMN object TEXT');
    }
    if (!columnNames.includes('triple_extracted')) {
      db.exec('ALTER TABLE memory_item ADD COLUMN triple_extracted BOOLEAN DEFAULT NULL');
    }
    if (!columnNames.includes('triple_extracted_status')) {
      db.exec('ALTER TABLE memory_item ADD COLUMN triple_extracted_status TEXT DEFAULT NULL');
    }
    if (!columnNames.includes('triple_extraction_metadata')) {
      db.exec('ALTER TABLE memory_item ADD COLUMN triple_extraction_metadata TEXT DEFAULT NULL');
    }
    // Consolidation Score 필드 추가 (recall_count 등)
    if (!columnNames.includes('recall_count')) {
      db.exec('ALTER TABLE memory_item ADD COLUMN recall_count INTEGER NOT NULL DEFAULT 0');
    }
    if (!columnNames.includes('last_accessed_at')) {
      db.exec('ALTER TABLE memory_item ADD COLUMN last_accessed_at TIMESTAMP');
    }
    if (!columnNames.includes('consolidation_score')) {
      db.exec('ALTER TABLE memory_item ADD COLUMN consolidation_score REAL');
    }
    if (!columnNames.includes('g_value')) {
      db.exec('ALTER TABLE memory_item ADD COLUMN g_value REAL');
    }
    
    // 인덱스 생성
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_item_triple_extracted ON memory_item(triple_extracted);
      CREATE INDEX IF NOT EXISTS idx_memory_item_triple_status ON memory_item(triple_extracted_status);
      CREATE INDEX IF NOT EXISTS idx_memory_item_last_accessed ON memory_item(last_accessed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_item_consol_desc ON memory_item(consolidation_score DESC);
    `);
  } catch (error) {
    // 컬럼 추가 실패는 무시 (이미 존재할 수 있음)
  }
  
  // memory_relation 테이블 생성 (AriGraph Pipeline용)
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_relation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.7 CHECK (confidence >= 0.0 AND confidence <= 1.0),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT,
      FOREIGN KEY (source_id) REFERENCES memory_item(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES memory_item(id) ON DELETE CASCADE,
      UNIQUE(source_id, target_id, relation_type)
    );
    
    CREATE INDEX IF NOT EXISTS idx_memory_relation_source ON memory_relation(source_id);
    CREATE INDEX IF NOT EXISTS idx_memory_relation_target ON memory_relation(target_id);
    CREATE INDEX IF NOT EXISTS idx_memory_relation_type ON memory_relation(relation_type);
  `);
  
  // relation_type_registry 테이블 생성 (AriGraph Pipeline용)
  db.exec(`
    CREATE TABLE IF NOT EXISTS relation_type_registry (
      type_name TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      description TEXT,
      applicable_types TEXT,
      default_confidence REAL DEFAULT 0.7,
      search_boost REAL DEFAULT 1.0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  // extracted_from, supported_by 관계 타입 등록
  db.exec(`
    INSERT OR IGNORE INTO relation_type_registry (type_name, category, description, applicable_types, default_confidence, search_boost)
    VALUES 
      ('extracted_from', 'Structural', '추출 관계: Semantic Memory가 Episodic Memory에서 추출됨', '["episodic", "semantic"]', 0.7, 1.1),
      ('supported_by', 'Structural', '근거 관계: Semantic Memory가 Episodic Memory에 의해 근거를 가짐', '["episodic", "semantic"]', 0.7, 1.1);
  `);

  // Issue #90: kg_triple 테이블 (KG 전용 저장소 및 dedupe)
  db.exec(`
    CREATE TABLE IF NOT EXISTS kg_triple (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object TEXT NOT NULL,
      owner_id TEXT NULL,
      process_id TEXT NULL,
      session_id TEXT NULL,
      representative_memory_id TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (representative_memory_id) REFERENCES memory_item(id) ON DELETE SET NULL,
      UNIQUE(subject, predicate, object)
    );
    CREATE INDEX IF NOT EXISTS idx_kg_triple_spo ON kg_triple(subject, predicate, object);
    CREATE INDEX IF NOT EXISTS idx_kg_triple_representative ON kg_triple(representative_memory_id);
    CREATE INDEX IF NOT EXISTS idx_kg_triple_owner ON kg_triple(owner_id);
    CREATE INDEX IF NOT EXISTS idx_kg_triple_process ON kg_triple(process_id);
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
    reflection_notes?: string | null;
    workflow_name?: string | null;
    skill_name?: string | null;
    steps?: string | null;
    trigger_conditions?: string | null;
    task_goal?: string | null;
    edit_count?: number;
  }
): string {
  const memoryId = options.id || `mem_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const type = options.type || 'episodic';
  const importance = options.importance ?? 0.5;
  const privacy_scope = options.privacy_scope || 'private';
  const pinned = options.pinned ?? false;
  const tags = options.tags ? JSON.stringify(options.tags) : null;
  const reflection_notes = options.reflection_notes !== undefined ? options.reflection_notes : null;
  
  DatabaseUtils.run(db, `
    INSERT INTO memory_item (id, type, content, importance, privacy_scope, pinned, tags, source, reflection_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    memoryId,
    type,
    options.content,
    importance,
    privacy_scope,
    pinned ? 1 : 0,
    tags,
    options.source || null,
    reflection_notes
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

