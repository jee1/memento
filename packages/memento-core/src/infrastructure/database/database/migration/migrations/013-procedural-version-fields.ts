/**
 * Migration: 013 - Procedural Version Fields
 * Description: Add version and version_series_id to memory_item for procedural version management (Issue #57)
 * Version: 13.0
 * Date: 2026-02-05
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

/**
 * Procedural Version Fields Migration
 *
 * 1. Adds version INTEGER NULL, version_series_id TEXT NULL to memory_item
 * 2. Backfills: standalone procedural -> version=1, version_series_id=id
 * 3. Backfills: version_of chains -> version_series_id=chain root id, version=1,2,3...
 */
export class ProceduralVersionFieldsMigration implements Migration {
  version = '13.0';
  name = 'procedural-version-fields';
  description = 'Add version and version_series_id to memory_item for procedural version management (Issue #57)';

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

  async validateBefore(db: Database.Database): Promise<void> {
    if (!this.tableExists(db, 'memory_item')) {
      throw new Error('memory_item table does not exist. Cannot proceed with migration.');
    }
    if (this.columnExists(db, 'memory_item', 'version')) {
      throw new Error('version column already exists. Migration 013 may have been applied.');
    }
    if (this.columnExists(db, 'memory_item', 'version_series_id')) {
      throw new Error('version_series_id column already exists. Migration 013 may have been applied.');
    }
    if (this.tableExists(db, 'memento_schema_version')) {
      const row = db.prepare(
        `SELECT version FROM memento_schema_version WHERE version = ?`
      ).get('13.0') as { version: string } | undefined;
      if (row) {
        throw new Error('Migration 013 has already been applied. Current schema version: 13.0');
      }
    }
  }

  async up(db: Database.Database): Promise<void> {
    if (!this.columnExists(db, 'memory_item', 'version')) {
      db.exec('ALTER TABLE memory_item ADD COLUMN version INTEGER NULL');
    }
    if (!this.columnExists(db, 'memory_item', 'version_series_id')) {
      db.exec('ALTER TABLE memory_item ADD COLUMN version_series_id TEXT NULL');
    }

    // Backfill: standalone procedural (no version_of involvement) -> version=1, version_series_id=id
    db.exec(`
      UPDATE memory_item
      SET version = 1, version_series_id = id
      WHERE type = 'procedural'
        AND version_series_id IS NULL
        AND id NOT IN (SELECT source_id FROM memory_link WHERE relation_type = 'version_of')
        AND id NOT IN (SELECT target_id FROM memory_link WHERE relation_type = 'version_of')
    `);

    // Backfill: procedural rows that are in version_of chain but not yet updated
    const links = db.prepare(`
      SELECT source_id, target_id FROM memory_link WHERE relation_type = 'version_of'
    `).all() as Array<{ source_id: string; target_id: string }>;

    if (links.length === 0) {
      // Any remaining procedural with NULL version_series_id -> treat as standalone
      db.exec(`
        UPDATE memory_item
        SET version = 1, version_series_id = id
        WHERE type = 'procedural' AND (version_series_id IS NULL OR version IS NULL)
      `);
      return;
    }

    // Roots = target_id that never appear as source_id (oldest in chain)
    const sourceIds = new Set(links.map(l => l.source_id));
    const roots = new Set<string>();
    for (const l of links) {
      if (!sourceIds.has(l.target_id)) {
        roots.add(l.target_id);
      }
    }

    // Build chain per root: root=1, next level=2, ...
    const targetToSources = new Map<string, string[]>();
    for (const l of links) {
      const list = targetToSources.get(l.target_id) ?? [];
      list.push(l.source_id);
      targetToSources.set(l.target_id, list);
    }

    const assign = db.prepare(`
      UPDATE memory_item SET version = ?, version_series_id = ? WHERE id = ?
    `);

    for (const rootId of roots) {
      let level = 1;
      let currentLevel = [rootId];
      const seen = new Set<string>();

      assign.run(level, rootId, rootId);
      seen.add(rootId);
      level++;

      while (currentLevel.length > 0) {
        const nextLevel: string[] = [];
        for (const id of currentLevel) {
          const children = targetToSources.get(id) ?? [];
          for (const childId of children) {
            if (!seen.has(childId)) {
              seen.add(childId);
              assign.run(level, rootId, childId);
              nextLevel.push(childId);
            }
          }
        }
        currentLevel = nextLevel;
        level++;
      }
    }

    // Any procedural still NULL (e.g. not in any chain, or orphan source_id) -> standalone
    db.exec(`
      UPDATE memory_item
      SET version = 1, version_series_id = id
      WHERE type = 'procedural' AND (version_series_id IS NULL OR version IS NULL)
    `);
  }

  async down(db: Database.Database): Promise<void> {
    // SQLite 3.35+ supports DROP COLUMN; older versions would require table recreation.
    // We drop columns if supported; otherwise only remove version record.
    try {
      db.exec('ALTER TABLE memory_item DROP COLUMN version');
    } catch {
      // Ignore if not supported
    }
    try {
      db.exec('ALTER TABLE memory_item DROP COLUMN version_series_id');
    } catch {
      // Ignore if not supported
    }
    if (this.tableExists(db, 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('13.0');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!this.columnExists(db, 'memory_item', 'version')) {
      throw new Error('version column was not created');
    }
    if (!this.columnExists(db, 'memory_item', 'version_series_id')) {
      throw new Error('version_series_id column was not created');
    }
  }
}
