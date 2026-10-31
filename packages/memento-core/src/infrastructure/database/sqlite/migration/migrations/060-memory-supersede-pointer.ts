/**
 * Migration: 060 — direct supersede pointer and audit events (#1551)
 * Version: 60.0
 *
 * 감사 사건은 기억이 지워져도 남도록 memory_item 에 FK 를 걸지 않는다.
 */

import type Database from 'better-sqlite3';
import { applySupersedePointerDdl } from '../idempotent-ddl.js';
import type { Migration } from '../types.js';

export class MemorySupersedePointerMigration implements Migration {
  version = '60.0';
  name = 'memory-supersede-pointer';
  description = 'memory_item.superseded_by for approved same-scope direct replacement plus memory_supersede_event audit (#1551)';

  async validateBefore(db: Database.Database): Promise<void> {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_item'").get()) {
      throw new Error('Migration 060 requires the memory_item table');
    }
  }

  async up(db: Database.Database): Promise<void> {
    applySupersedePointerDdl(db);
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP TABLE IF EXISTS memory_supersede_event;');
    const columns = db.prepare('PRAGMA table_info(memory_item)').all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === 'superseded_by')) {
      db.exec('ALTER TABLE memory_item DROP COLUMN superseded_by');
    }
    const ver = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memento_schema_version'`)
      .get();
    if (ver) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('60.0');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    const columns = db.prepare('PRAGMA table_info(memory_item)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'superseded_by')) {
      throw new Error('Migration 060 did not add memory_item.superseded_by');
    }
    if (!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memory_supersede_event'`).get()) {
      throw new Error('Migration 060 did not create memory_supersede_event');
    }
  }
}

export default MemorySupersedePointerMigration;
