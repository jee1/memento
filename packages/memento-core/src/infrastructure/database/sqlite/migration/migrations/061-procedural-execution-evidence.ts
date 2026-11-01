/**
 * Migration: 061 — procedural execution evidence (#1550)
 * Version: 61.0
 *
 * 실행 증거는 실행한 절차 행이 지워져도 남도록 memory_item 에 FK 를 걸지 않는다.
 * UPDATE 와 DELETE 는 트리거가 막는다(append-only).
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

export class ProceduralExecutionEvidenceMigration implements Migration {
  version = '61.0';
  name = 'procedural-execution-evidence';
  description = 'Append-only execution results pinned to one procedure row, its content hash and environment (#1550)';

  async validateBefore(_db: Database.Database): Promise<void> {}

  async up(db: Database.Database): Promise<void> {
    db.exec(`
      CREATE TABLE IF NOT EXISTS procedural_execution_evidence (
        id             TEXT PRIMARY KEY,
        run_id         TEXT NOT NULL UNIQUE,
        memory_id      TEXT NOT NULL,
        content_sha256 TEXT NOT NULL,
        case_id        TEXT NOT NULL,
        kind           TEXT NOT NULL CHECK (kind IN ('replay', 'held_out')),
        environment    TEXT NOT NULL,
        tool_version   TEXT NOT NULL,
        outcome        TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
        detail         TEXT,
        created_at     TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_procedural_execution_evidence_memory
        ON procedural_execution_evidence(memory_id, environment, tool_version);
      CREATE TRIGGER IF NOT EXISTS procedural_execution_evidence_prevent_update
      BEFORE UPDATE ON procedural_execution_evidence
      BEGIN
        SELECT RAISE(ABORT, 'procedural_execution_evidence is append-only');
      END;
      CREATE TRIGGER IF NOT EXISTS procedural_execution_evidence_prevent_delete
      BEFORE DELETE ON procedural_execution_evidence
      BEGIN
        SELECT RAISE(ABORT, 'procedural_execution_evidence is append-only');
      END;
    `);
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP TABLE IF EXISTS procedural_execution_evidence;');
    const ver = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memento_schema_version'`)
      .get();
    if (ver) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('61.0');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    const t = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='procedural_execution_evidence'`)
      .get();
    if (!t) {
      throw new Error('Migration 061 did not create procedural_execution_evidence');
    }
    const triggers = db
      .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND tbl_name='procedural_execution_evidence'`)
      .get() as { n: number };
    if (triggers.n !== 2) {
      throw new Error('Migration 061 did not create the append-only triggers');
    }
  }
}

export default ProceduralExecutionEvidenceMigration;
