/**
 * Migration: 059 — memory supersede candidate (#1548)
 * Version: 59.0
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

export class MemorySupersedeCandidateMigration implements Migration {
  version = '59.0';
  name = 'memory-supersede-candidate';
  description = 'Judged supersede candidate pairs with provenance; never applied to memory_item (#1548)';

  async validateBefore(_db: Database.Database): Promise<void> {}

  async up(db: Database.Database): Promise<void> {
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_supersede_candidate (
        id                     TEXT PRIMARY KEY,
        old_memory_id          TEXT NOT NULL,
        new_memory_id          TEXT NOT NULL,
        owner_id               TEXT,
        project_id             TEXT,
        privacy_scope          TEXT NOT NULL,
        memory_type            TEXT NOT NULL,
        verdict                TEXT NOT NULL CHECK (verdict IN ('confirmed', 'pending', 'compatible')),
        rationale              TEXT NOT NULL,
        evidence_quote         TEXT,
        old_content_sha256     TEXT NOT NULL,
        new_content_sha256     TEXT NOT NULL,
        provider               TEXT NOT NULL,
        model                  TEXT NOT NULL,
        prompt_version         TEXT NOT NULL,
        input_hash             TEXT NOT NULL UNIQUE,
        llm_logical_request_id TEXT,
        created_at             TEXT NOT NULL,
        FOREIGN KEY (old_memory_id) REFERENCES memory_item(id) ON DELETE CASCADE,
        FOREIGN KEY (new_memory_id) REFERENCES memory_item(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_memory_supersede_candidate_old
        ON memory_supersede_candidate(old_memory_id);
      CREATE INDEX IF NOT EXISTS idx_memory_supersede_candidate_new
        ON memory_supersede_candidate(new_memory_id);
    `);
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP TABLE IF EXISTS memory_supersede_candidate;');
    const ver = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memento_schema_version'`)
      .get();
    if (ver) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('59.0');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    const t = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memory_supersede_candidate'`)
      .get();
    if (!t) {
      throw new Error('Migration 059 did not create memory_supersede_candidate');
    }
  }
}

export default MemorySupersedeCandidateMigration;
