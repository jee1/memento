-- Migration: 006 - FTS5 Reflection Notes Migration Status Table
-- Description: Create migration status metadata table for FTS5 reflection_notes migration
-- Version: 6.0
-- Date: 2025-01-XX
--
-- This table tracks the status of the FTS5 reflection_notes migration
-- to enable fallback strategy when migration fails.

-- Create migration status metadata table
CREATE TABLE IF NOT EXISTS fts5_migration_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  migration_key TEXT NOT NULL UNIQUE DEFAULT 'fts5-reflection-notes',
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')) DEFAULT 'pending',
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  failed_at TIMESTAMP,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_fts5_migration_status_key ON fts5_migration_status(migration_key);
CREATE INDEX IF NOT EXISTS idx_fts5_migration_status_status ON fts5_migration_status(status);

-- Insert initial status (if not exists)
INSERT OR IGNORE INTO fts5_migration_status (migration_key, status)
VALUES ('fts5-reflection-notes', 'pending');

