/**
 * Migration: 063 — runtime setting override (#1582)
 * Version: 63.0
 *
 * override 는 키마다 한 행이다. 변경 이력은 setting_override_event 에만 남고 UPDATE 와 DELETE 는
 * 트리거가 막는다(append-only). 이력은 override 행이 지워져도 남도록 FK 를 걸지 않는다.
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

export class SettingOverrideMigration implements Migration {
  version = '63.0';
  name = 'setting-override';
  description = 'Runtime setting override rows and an append-only change history (#1582)';

  async validateBefore(_db: Database.Database): Promise<void> {}

  async up(db: Database.Database): Promise<void> {
    db.exec(`
      CREATE TABLE IF NOT EXISTS setting_override (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS setting_override_event (
        id             TEXT PRIMARY KEY,
        setting_key    TEXT NOT NULL,
        action         TEXT NOT NULL CHECK (action IN ('set', 'revert')),
        previous_value TEXT,
        new_value      TEXT,
        actor          TEXT NOT NULL,
        reason         TEXT,
        created_at     TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_setting_override_event_key
        ON setting_override_event(setting_key, created_at);
      CREATE TRIGGER IF NOT EXISTS setting_override_event_prevent_update
      BEFORE UPDATE ON setting_override_event
      BEGIN
        SELECT RAISE(ABORT, 'setting_override_event is append-only');
      END;
      CREATE TRIGGER IF NOT EXISTS setting_override_event_prevent_delete
      BEFORE DELETE ON setting_override_event
      BEGIN
        SELECT RAISE(ABORT, 'setting_override_event is append-only');
      END;
    `);
  }

  async down(db: Database.Database): Promise<void> {
    db.exec(`
      DROP TABLE IF EXISTS setting_override_event;
      DROP TABLE IF EXISTS setting_override;
    `);
    const ver = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memento_schema_version'`)
      .get();
    if (ver) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run(this.version);
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    for (const table of ['setting_override', 'setting_override_event']) {
      if (!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(table)) {
        throw new Error(`Migration 063 did not create ${table}`);
      }
    }
    const triggers = db
      .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND tbl_name='setting_override_event'`)
      .get() as { n: number };
    if (triggers.n !== 2) {
      throw new Error('Migration 063 did not create the append-only triggers');
    }
  }
}

export default SettingOverrideMigration;
