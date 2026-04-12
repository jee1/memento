/**
 * Migration: 030 — memory_item triple extraction columns (schema parity / fresh installs)
 * Version: 30.0
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

export class TripleExtractionFieldsMigration implements Migration {
  version = '30.0';
  name = 'triple-extraction-fields';
  description =
    'Add triple_extracted, triple_extracted_status, triple_extraction_metadata to memory_item (idempotent)';

  private tableExists(db: Database.Database, tableName: string): boolean {
    const result = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(tableName);
    return !!result;
  }

  private columnExists(db: Database.Database, table: string, column: string): boolean {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return rows.some(r => r.name === column);
  }

  private indexExists(db: Database.Database, indexName: string): boolean {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`)
      .get(indexName) as { name: string } | undefined;
    return !!row;
  }

  async validateBefore(_db: Database.Database): Promise<void> {}

  async up(db: Database.Database): Promise<void> {
    if (!this.tableExists(db, 'memory_item')) {
      return;
    }
    if (!this.columnExists(db, 'memory_item', 'triple_extracted')) {
      db.exec(`ALTER TABLE memory_item ADD COLUMN triple_extracted BOOLEAN DEFAULT FALSE NOT NULL`);
    }
    if (!this.columnExists(db, 'memory_item', 'triple_extracted_status')) {
      db.exec(`ALTER TABLE memory_item ADD COLUMN triple_extracted_status TEXT`);
    }
    if (!this.columnExists(db, 'memory_item', 'triple_extraction_metadata')) {
      db.exec(`ALTER TABLE memory_item ADD COLUMN triple_extraction_metadata TEXT`);
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_item_triple_extracted_episodic
        ON memory_item(triple_extracted)
        WHERE type = 'episodic';
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_item_triple_extracted_status_episodic
        ON memory_item(triple_extracted_status)
        WHERE type = 'episodic';
    `);
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP INDEX IF EXISTS idx_memory_item_triple_extracted_episodic');
    db.exec('DROP INDEX IF EXISTS idx_memory_item_triple_extracted_status_episodic');
    if (this.tableExists(db, 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('30.0');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!this.tableExists(db, 'memory_item')) {
      return;
    }
    if (!this.columnExists(db, 'memory_item', 'triple_extracted')) {
      throw new Error('triple_extracted column was not created');
    }
    if (!this.columnExists(db, 'memory_item', 'triple_extracted_status')) {
      throw new Error('triple_extracted_status column was not created');
    }
    if (!this.columnExists(db, 'memory_item', 'triple_extraction_metadata')) {
      throw new Error('triple_extraction_metadata column was not created');
    }
    if (!this.indexExists(db, 'idx_memory_item_triple_extracted_episodic')) {
      throw new Error('idx_memory_item_triple_extracted_episodic was not created');
    }
  }
}

export default TripleExtractionFieldsMigration;
