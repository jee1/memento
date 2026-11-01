import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

/** Keep the no-approval probe proportional to non-null pointers, not all memories. */
export class SupersedePointerIndexMigration implements Migration {
  version = '62.0';
  name = 'supersede-pointer-index';
  description = 'Partial index for same-request live supersede pointer probes (#1552)';

  async validateBefore(db: Database.Database): Promise<void> {
    const columns = db.prepare('PRAGMA table_info(memory_item)').all() as Array<{ name: string }>;
    if (!columns.some(column => column.name === 'superseded_by')) {
      throw new Error('Migration 062 requires memory_item.superseded_by');
    }
  }

  async up(db: Database.Database): Promise<void> {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_item_superseded_by
      ON memory_item(superseded_by) WHERE superseded_by IS NOT NULL;`);
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP INDEX IF EXISTS idx_memory_item_superseded_by');
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'memento_schema_version'").get()) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run(this.version);
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_memory_item_superseded_by'").get()) {
      throw new Error('Migration 062 did not create the supersede pointer index');
    }
  }
}

export default SupersedePointerIndexMigration;
