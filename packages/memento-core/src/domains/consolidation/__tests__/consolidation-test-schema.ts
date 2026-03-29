/**
 * Sleep consolidation 단위 테스트용 최소 스키마 (:memory:)
 *
 * `memory_embedding` 제약은 프로덕션 `infrastructure/database/database/schema.sql`의
 * 해당 테이블과 동일하게 유지한다: UNIQUE(memory_id, embedding_provider, projection_type).
 */

import Database from 'better-sqlite3';

export function applyConsolidationTestSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT CHECK (type IN ('working','episodic','semantic','procedural')) NOT NULL,
      content TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      privacy_scope TEXT DEFAULT 'private',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_accessed TIMESTAMP,
      pinned BOOLEAN DEFAULT FALSE,
      tags TEXT,
      source TEXT,
      origin_source TEXT DEFAULT '{}',
      owner_id TEXT NULL,
      is_consolidated BOOLEAN DEFAULT FALSE
    );

    CREATE TABLE IF NOT EXISTS memory_embedding (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      embedding_provider TEXT NOT NULL DEFAULT 'tfidf',
      projection_type TEXT NOT NULL DEFAULT 'native',
      embedding TEXT NOT NULL,
      dim INTEGER NOT NULL,
      dimensions INTEGER DEFAULT 0,
      model TEXT,
      precision INTEGER DEFAULT 32,
      normalized BOOLEAN DEFAULT FALSE,
      version INTEGER DEFAULT 1,
      created_by TEXT DEFAULT 'system',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE,
      UNIQUE(memory_id, embedding_provider, projection_type)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_embedding_memory_id ON memory_embedding(memory_id);
    CREATE INDEX IF NOT EXISTS idx_memory_embedding_memory_provider ON memory_embedding(memory_id, embedding_provider);
    CREATE INDEX IF NOT EXISTS idx_memory_embedding_provider_projection ON memory_embedding(embedding_provider, projection_type);

    CREATE TABLE IF NOT EXISTS memory_relation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.7,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT,
      FOREIGN KEY (source_id) REFERENCES memory_item(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES memory_item(id) ON DELETE CASCADE,
      UNIQUE(source_id, target_id, relation_type)
    );

    CREATE TABLE IF NOT EXISTS relation_type_registry (
      type_name TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      description TEXT,
      applicable_types TEXT,
      default_confidence REAL DEFAULT 0.7,
      search_boost REAL DEFAULT 1.0
    );

    INSERT OR IGNORE INTO relation_type_registry (type_name, category, description, applicable_types, default_confidence, search_boost)
    VALUES
      ('extracted_from', 'Structural', 'extracted', '["episodic","semantic"]', 0.7, 1.1),
      ('supported_by', 'Structural', 'supported', '["episodic","semantic"]', 0.7, 1.1);
  `);
}
