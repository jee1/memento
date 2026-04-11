/**
 * meta_memory_stats 테이블·인덱스·트리거 보정 (마이그레이션 011과 동일 DDL, idempotent).
 * 구 DB·baseline 불일치 시에도 인트로스펙션·recall 통계 경로가 동작하도록 한다.
 */

import Database from 'better-sqlite3';

export function ensureMetaMemoryStatsSchema(db: Database.Database): void {
  const hasMemoryItem = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_item' LIMIT 1`)
    .get();
  if (!hasMemoryItem) {
    return;
  }

  db.exec(`
CREATE TABLE IF NOT EXISTS meta_memory_stats (
  memory_id TEXT PRIMARY KEY,
  recall_count INTEGER DEFAULT 0 NOT NULL,
  success_count INTEGER DEFAULT 0 NOT NULL,
  failure_count INTEGER DEFAULT 0 NOT NULL,
  avg_confidence REAL DEFAULT 0.0 NOT NULL,
  last_recalled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meta_memory_stats_recall_count ON meta_memory_stats(recall_count DESC);
CREATE INDEX IF NOT EXISTS idx_meta_memory_stats_avg_confidence ON meta_memory_stats(avg_confidence DESC);
CREATE INDEX IF NOT EXISTS idx_meta_memory_stats_last_recalled_at ON meta_memory_stats(last_recalled_at DESC);
CREATE INDEX IF NOT EXISTS idx_meta_memory_stats_failure_count ON meta_memory_stats(failure_count DESC);

CREATE TRIGGER IF NOT EXISTS trigger_meta_memory_stats_updated_at
  AFTER UPDATE ON meta_memory_stats
  FOR EACH ROW
  WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE meta_memory_stats
  SET updated_at = CURRENT_TIMESTAMP
  WHERE memory_id = NEW.memory_id;
END;
`);
}
