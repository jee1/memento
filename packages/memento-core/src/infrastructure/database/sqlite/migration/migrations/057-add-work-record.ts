/**
 * Migration: 057 — episodic work_record JSON (#1446)
 * Version: 57.0
 *
 * 라벨은 이 컬럼에만 있고 content 는 검색 본문이다.
 */

import type Database from 'better-sqlite3';
import { applyWorkRecordColumn } from '../idempotent-ddl.js';
import type { Migration } from '../types.js';

export class AddWorkRecordMigration implements Migration {
  version = '57.0';
  name = 'add-work-record';
  description = 'Store episodic work records as JSON so search text has no template labels (#1446)';

  async validateBefore(db: Database.Database): Promise<void> {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_item'").get()) {
      throw new Error('Migration 057 requires the memory_item table');
    }
  }

  async up(db: Database.Database): Promise<void> {
    applyWorkRecordColumn(db);
  }

  async down(db: Database.Database): Promise<void> {
    const columns = db.prepare('PRAGMA table_info(memory_item)').all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === 'work_record')) {
      db.exec('ALTER TABLE memory_item DROP COLUMN work_record');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    const columns = db.prepare('PRAGMA table_info(memory_item)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'work_record')) {
      throw new Error('Migration 057 did not add memory_item.work_record');
    }
  }
}

export default AddWorkRecordMigration;
