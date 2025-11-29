-- Migration: add migration history table
-- Up

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS migration_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_provider_from TEXT NOT NULL,
  plan_provider_to TEXT NOT NULL,
  plan_target_dimensions INTEGER NOT NULL,
  plan_projection_type TEXT NOT NULL,
  plan_normalization TEXT NOT NULL,
  plan_batch_size INTEGER NOT NULL,
  plan_dry_run INTEGER NOT NULL DEFAULT 0,
  plan_resume_from_id TEXT,
  plan_target_model TEXT,
  plan_created_by TEXT,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  processed INTEGER NOT NULL,
  succeeded INTEGER NOT NULL,
  failed INTEGER NOT NULL,
  success INTEGER NOT NULL,
  next_resume_from_id TEXT,
  error_count INTEGER NOT NULL DEFAULT 0,
  errors_json TEXT,
  rollback_entries_json TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_migration_history_created_at ON migration_history(created_at);
CREATE INDEX IF NOT EXISTS idx_migration_history_plan ON migration_history(plan_provider_from, plan_provider_to);

COMMIT;
PRAGMA foreign_keys = ON;

-- Down

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

DROP TABLE IF EXISTS migration_history;

COMMIT;
PRAGMA foreign_keys = ON;
