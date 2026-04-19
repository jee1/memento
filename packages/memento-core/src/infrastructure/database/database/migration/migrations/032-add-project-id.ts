/**
 * Migration: 032 — memory_item project_id column
 * Version: 32.0
 */
import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

export class AddProjectIdMigration implements Migration {
  version = '32.0';
  name = 'add-project-id';
  description = 'Add project_id to memory_item for project-scoped memory (Issue #81)';

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
    if (!this.columnExists(db, 'memory_item', 'project_id')) {
      db.exec(`ALTER TABLE memory_item ADD COLUMN project_id TEXT`);
    }
    if (!this.indexExists(db, 'idx_memory_item_project_id_type')) {
      db.exec(`
        CREATE INDEX idx_memory_item_project_id_type
          ON memory_item(project_id, type)
          WHERE project_id IS NOT NULL
      `);
    }
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP INDEX IF EXISTS idx_memory_item_project_id_type');
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!this.columnExists(db, 'memory_item', 'project_id')) {
      throw new Error('project_id column was not created');
    }
    if (!this.indexExists(db, 'idx_memory_item_project_id_type')) {
      throw new Error('idx_memory_item_project_id_type was not created');
    }
  }
}

export default AddProjectIdMigration;
