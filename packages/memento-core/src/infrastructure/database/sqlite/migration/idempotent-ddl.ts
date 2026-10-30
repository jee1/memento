/**
 * 마이그레이션 up() 과 레거시 테스트 부트스트랩 전용 idempotent DDL.
 * 운영 서비스 경로에서는 호출하지 않는다 (#1535).
 */

import type Database from 'better-sqlite3';
import { hashMemoryContent } from '../../../../shared/utils/memory-content-hash.js';

export function applyQualityAssuranceSchema(db: Database.Database): void {
  if (!db.open) {
    return;
  }
  db.exec(`
CREATE TABLE IF NOT EXISTS quality_measurement_history (
  id TEXT PRIMARY KEY,
  measurement_type TEXT NOT NULL CHECK (measurement_type IN ('batch', 'test', 'manual')),
  measured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metrics TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'warning', 'error')) DEFAULT 'success',
  warnings TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quality_metrics (
  metric_namespace TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT 'default',
  metric_value REAL NOT NULL,
  measured_at TIMESTAMP NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass', 'warning', 'fail')) DEFAULT 'pass',
  threshold_value REAL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (metric_namespace, metric_key, context)
);

CREATE TABLE IF NOT EXISTS quality_thresholds (
  metric_namespace TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT 'default',
  threshold_value REAL NOT NULL,
  threshold_type TEXT NOT NULL CHECK (threshold_type IN ('min', 'max')),
  description TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (metric_namespace, metric_key, context)
);

CREATE INDEX IF NOT EXISTS idx_quality_measurement_history_measured_at
  ON quality_measurement_history(measured_at);
CREATE INDEX IF NOT EXISTS idx_quality_measurement_history_type
  ON quality_measurement_history(measurement_type);
CREATE INDEX IF NOT EXISTS idx_quality_measurement_history_status
  ON quality_measurement_history(status);

CREATE INDEX IF NOT EXISTS idx_quality_metrics_namespace_key
  ON quality_metrics(metric_namespace, metric_key);
CREATE INDEX IF NOT EXISTS idx_quality_metrics_context
  ON quality_metrics(context);
CREATE INDEX IF NOT EXISTS idx_quality_metrics_status
  ON quality_metrics(status);
CREATE INDEX IF NOT EXISTS idx_quality_metrics_measured_at
  ON quality_metrics(measured_at);

CREATE INDEX IF NOT EXISTS idx_quality_thresholds_namespace_key
  ON quality_thresholds(metric_namespace, metric_key);
CREATE INDEX IF NOT EXISTS idx_quality_thresholds_context
  ON quality_thresholds(context);
`);
}

export function applyMetaMemoryStatsSchema(db: Database.Database): void {
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

export function applyMemoryReviewCandidateSchema(db: Database.Database): void {
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

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
    (item) => item.name === column,
  );
}

export function applyWorkRecordColumn(db: Database.Database): void {
  if (!hasColumn(db, 'memory_item', 'work_record')) {
    db.exec('ALTER TABLE memory_item ADD COLUMN work_record TEXT');
  }
}

export function applyMemoryEmbeddingContentHash(db: Database.Database): void {
  db.transaction(() => {
    if (!hasColumn(db, 'memory_embedding', 'content_hash')) {
      db.exec('ALTER TABLE memory_embedding ADD COLUMN content_hash TEXT');
    }
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_item_embedding_content_update
      AFTER UPDATE OF content ON memory_item
      WHEN OLD.content IS NOT NEW.content
      BEGIN
        DELETE FROM memory_embedding WHERE memory_id = NEW.id;
      END;
    `);

    const pending = db
      .prepare(
        `SELECT DISTINCT m.id AS id, m.content AS content
       FROM memory_embedding e JOIN memory_item m ON m.id = e.memory_id
       WHERE e.content_hash IS NULL`,
      )
      .all() as Array<{ id: string; content: string }>;
    const backfill = db.prepare(
      'UPDATE memory_embedding SET content_hash = ? WHERE memory_id = ? AND content_hash IS NULL',
    );
    for (const row of pending) {
      backfill.run(hashMemoryContent(row.content), row.id);
    }
  })();
}
