/**
 * memory_review_candidate 테이블·인덱스 보정 (마이그레이션 033과 동일 DDL, idempotent).
 */

import Database from 'better-sqlite3';

export function ensureMemoryReviewCandidateSchema(db: Database.Database): void {
  const hasMemoryItem = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_item' LIMIT 1`)
    .get();
  if (!hasMemoryItem) {
    return;
  }

  db.exec(`
CREATE TABLE IF NOT EXISTS memory_review_candidate (
  id TEXT PRIMARY KEY NOT NULL,
  memory_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','reviewed','dismissed','expired')),
  priority REAL NOT NULL,
  reason TEXT NOT NULL,
  due_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT,
  dismissed_at TEXT,
  metadata_json TEXT,
  FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_review_candidate_pending_memory_id
  ON memory_review_candidate(memory_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_memory_review_candidate_queue
  ON memory_review_candidate(status, priority DESC, due_at ASC);
`);
}
