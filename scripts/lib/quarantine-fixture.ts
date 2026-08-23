/**
 * #804 격리 러너 테스트용 최소 스키마. 라이브 스키마의 부분집합이며 테스트에서만 쓴다.
 */

import Database from 'better-sqlite3';

export function createFixtureDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      subject TEXT,
      predicate TEXT,
      object TEXT,
      importance REAL,
      pinned BOOLEAN DEFAULT FALSE,
      project_id TEXT,
      owner_id TEXT,
      privacy_scope TEXT DEFAULT 'private',
      is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
      recall_count INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE memory_item_tag (
      memory_id TEXT REFERENCES memory_item(id) ON DELETE CASCADE,
      tag TEXT
    );
    CREATE TABLE memory_link (
      source_id TEXT REFERENCES memory_item(id) ON DELETE CASCADE,
      target_id TEXT REFERENCES memory_item(id) ON DELETE CASCADE
    );
    CREATE TABLE feedback_event (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL REFERENCES memory_item(id) ON DELETE CASCADE,
      event TEXT NOT NULL,
      score REAL,
      comment TEXT,
      session_id TEXT,
      agent_id TEXT,
      score_breakdown_json TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE memory_embedding (
      id INTEGER PRIMARY KEY,
      memory_id TEXT REFERENCES memory_item(id) ON DELETE CASCADE
    );
    CREATE TABLE memory_forgetting_event (
      id INTEGER PRIMARY KEY, memory_id TEXT, action TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE event_outbox (
      id TEXT PRIMARY KEY, event_type TEXT NOT NULL, target_uri TEXT NOT NULL,
      owner_id TEXT, payload_json TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
      attempts INTEGER NOT NULL DEFAULT 0,
      available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT, last_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE kg_triple (
      id INTEGER PRIMARY KEY,
      subject TEXT, predicate TEXT, object TEXT,
      representative_memory_id TEXT REFERENCES memory_item(id) ON DELETE SET NULL
    );
  `);
  return db;
}

export function insertMemory(db: Database.Database, row: Partial<{
  id: string; type: string; content: string; subject: string | null;
  predicate: string | null; object: string | null; importance: number;
  pinned: number; created_at: string;
}>): void {
  db.prepare(`
    INSERT INTO memory_item (id, type, content, subject, predicate, object, importance, pinned, created_at)
    VALUES (@id, @type, @content, @subject, @predicate, @object, @importance, @pinned, @created_at)
  `).run({
    id: row.id ?? 'mem_x', type: row.type ?? 'semantic', content: row.content ?? '',
    subject: row.subject ?? null, predicate: row.predicate ?? null, object: row.object ?? null,
    importance: row.importance ?? 0.5, pinned: row.pinned ?? 0,
    created_at: row.created_at ?? '2026-08-01T00:00:00Z',
  });
}
