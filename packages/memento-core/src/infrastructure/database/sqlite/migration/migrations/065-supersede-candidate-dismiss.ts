/**
 * Migration: 065 — supersede candidate dismiss + audit (#1618)
 * Version: 65.0
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
    (item) => item.name === column,
  );
}

function rebuildSupersedeEventTable(db: Database.Database): void {
  const table = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_supersede_event'`)
    .get() as { sql: string } | undefined;
  if (!table?.sql.includes("'dismissed'")) {
    db.exec(`
      CREATE TABLE memory_supersede_event_new (
        id                 TEXT PRIMARY KEY,
        action             TEXT NOT NULL CHECK (action IN ('applied', 'restored', 'dismissed')),
        old_memory_id      TEXT NOT NULL,
        new_memory_id      TEXT NOT NULL,
        candidate_id       TEXT,
        actor              TEXT NOT NULL,
        reason             TEXT,
        old_content_sha256 TEXT NOT NULL,
        new_content_sha256 TEXT,
        created_at         TEXT NOT NULL
      );
      INSERT INTO memory_supersede_event_new
        SELECT id, action, old_memory_id, new_memory_id, candidate_id, actor, reason,
               old_content_sha256, new_content_sha256, created_at
        FROM memory_supersede_event;
      DROP TABLE memory_supersede_event;
      ALTER TABLE memory_supersede_event_new RENAME TO memory_supersede_event;
      CREATE INDEX IF NOT EXISTS idx_memory_supersede_event_old
        ON memory_supersede_event(old_memory_id);
    `);
  }
}

export class SupersedeCandidateDismissMigration implements Migration {
  version = '65.0';
  name = 'supersede-candidate-dismiss';
  description = 'dismissed_at on memory_supersede_candidate and dismissed audit events (#1618)';

  async validateBefore(db: Database.Database): Promise<void> {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_supersede_candidate'").get()) {
      throw new Error('Migration 065 requires memory_supersede_candidate');
    }
  }

  async up(db: Database.Database): Promise<void> {
    db.transaction(() => {
      if (!hasColumn(db, 'memory_supersede_candidate', 'dismissed_at')) {
        db.exec('ALTER TABLE memory_supersede_candidate ADD COLUMN dismissed_at TEXT');
      }
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_supersede_event'").get()) {
        rebuildSupersedeEventTable(db);
      }
    })();
  }

  async down(db: Database.Database): Promise<void> {
    db.transaction(() => {
      if (hasColumn(db, 'memory_supersede_candidate', 'dismissed_at')) {
        db.exec('ALTER TABLE memory_supersede_candidate DROP COLUMN dismissed_at');
      }
    })();
    const ver = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memento_schema_version'`)
      .get();
    if (ver) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('65.0');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!hasColumn(db, 'memory_supersede_candidate', 'dismissed_at')) {
      throw new Error('Migration 065 did not add dismissed_at');
    }
    const sql = (
      db
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_supersede_event'`)
        .get() as { sql: string } | undefined
    )?.sql;
    if (!sql?.includes("'dismissed'")) {
      throw new Error('Migration 065 did not extend memory_supersede_event actions');
    }
  }
}

export default SupersedeCandidateDismissMigration;
