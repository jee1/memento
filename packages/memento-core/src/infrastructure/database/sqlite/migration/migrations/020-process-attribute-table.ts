/**
 * Migration: 020 - process_attribute table (Issue #91)
 * Description: Create process_attribute table for process-specific topics/attributes (recall scoring)
 * Version: 20.0
 * Date: 2026-02-08
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

/**
 * Process Attribute Table Migration (Issue #91)
 *
 * Creates process_attribute table: process_id별 주제/속성(topics, workflow_names, skill_names) 저장.
 * recall 시 (query 유사도) × (process-attribute 적합도) 스코어링에 사용.
 */
export class ProcessAttributeTableMigration implements Migration {
  version = '20.0';
  name = 'process-attribute-table';
  description = 'Create process_attribute table for process-specific attributes (Issue #91: Process Attribute recall 스코어링)';

  private tableExists(db: Database.Database, tableName: string): boolean {
    const result = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
    ).get(tableName);
    return !!result;
  }

  private columnExists(db: Database.Database, tableName: string, columnName: string): boolean {
    const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name: string }>;
    return columns.some(col => col.name === columnName);
  }

  async validateBefore(db: Database.Database): Promise<void> {
    if (this.tableExists(db, 'process_attribute')) {
      throw new Error('process_attribute table already exists. Migration 020 may have been applied.');
    }
    const versionTableExists = this.tableExists(db, 'memento_schema_version');
    if (versionTableExists) {
      const row = db.prepare(
        `SELECT version FROM memento_schema_version WHERE version = ?`
      ).get('20.0') as { version: string } | undefined;
      if (row) {
        throw new Error('Migration 020 has already been applied. Current schema version: 20.0');
      }
    }
  }

  async up(db: Database.Database): Promise<void> {
    db.exec(`
      CREATE TABLE IF NOT EXISTS process_attribute (
        process_id TEXT PRIMARY KEY,
        topics TEXT NULL,
        workflow_names TEXT NULL,
        skill_names TEXT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )
    `);
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP TABLE IF EXISTS process_attribute');
    if (this.tableExists(db, 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('20.0');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!this.tableExists(db, 'process_attribute')) {
      throw new Error('process_attribute table was not created');
    }
    const requiredColumns = ['process_id', 'topics', 'workflow_names', 'skill_names', 'created_at', 'updated_at'];
    for (const col of requiredColumns) {
      if (!this.columnExists(db, 'process_attribute', col)) {
        throw new Error(`Column process_attribute.${col} was not created`);
      }
    }
  }
}
