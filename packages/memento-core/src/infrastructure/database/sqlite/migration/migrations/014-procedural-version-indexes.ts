/**
 * Migration: 014 - Procedural Version Indexes
 * Description: Add partial indexes on memory_item for procedural version queries (Issue #57 Phase 2 B)
 * Version: 14.0
 * Date: 2026-02-05
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

/**
 * Procedural Version Indexes Migration
 *
 * Adds partial indexes to speed up procedural version chain and latest-version lookups:
 * - idx_memory_item_procedural_version_series (type, version_series_id) WHERE type = 'procedural'
 * - idx_memory_item_procedural_version (type, version_series_id, version) WHERE type = 'procedural'
 */
export class ProceduralVersionIndexesMigration implements Migration {
  version = '14.0';
  name = 'procedural-version-indexes';
  description = 'Add partial indexes on memory_item for procedural version management (Issue #57 Phase 2 B)';

  private columnExists(db: Database.Database, tableName: string, columnName: string): boolean {
    const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name: string }>;
    return columns.some(col => col.name === columnName);
  }

  private tableExists(db: Database.Database, tableName: string): boolean {
    const result = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
    ).get(tableName);
    return !!result;
  }

  private indexExists(db: Database.Database, indexName: string): boolean {
    const row = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND name=?`
    ).get(indexName) as { name: string } | undefined;
    return !!row;
  }

  async validateBefore(db: Database.Database): Promise<void> {
    if (!this.tableExists(db, 'memory_item')) {
      throw new Error('memory_item table does not exist. Cannot proceed with migration.');
    }
    if (!this.columnExists(db, 'memory_item', 'version')) {
      throw new Error('version column does not exist. Migration 013 must be applied first.');
    }
    if (!this.columnExists(db, 'memory_item', 'version_series_id')) {
      throw new Error('version_series_id column does not exist. Migration 013 must be applied first.');
    }
    if (this.tableExists(db, 'memento_schema_version')) {
      const row = db.prepare(
        `SELECT version FROM memento_schema_version WHERE version = ?`
      ).get('14.0') as { version: string } | undefined;
      if (row) {
        throw new Error('Migration 014 has already been applied. Current schema version: 14.0');
      }
    }
  }

  async up(db: Database.Database): Promise<void> {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_item_procedural_version_series
      ON memory_item(type, version_series_id) WHERE type = 'procedural'
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_item_procedural_version
      ON memory_item(type, version_series_id, version) WHERE type = 'procedural'
    `);
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP INDEX IF EXISTS idx_memory_item_procedural_version_series');
    db.exec('DROP INDEX IF EXISTS idx_memory_item_procedural_version');
    if (this.tableExists(db, 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('14.0');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!this.indexExists(db, 'idx_memory_item_procedural_version_series')) {
      throw new Error('idx_memory_item_procedural_version_series index was not created');
    }
    if (!this.indexExists(db, 'idx_memory_item_procedural_version')) {
      throw new Error('idx_memory_item_procedural_version index was not created');
    }
  }
}
