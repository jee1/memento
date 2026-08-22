/**
 * Migration 020 테스트
 * process_attribute 테이블 (Issue #91)
 *
 * Given/When/Then:
 * - Given: 마이그레이션 019까지 적용된 DB (memory_item 등 존재)
 * - When: 020 up 실행
 * - Then: process_attribute 테이블 존재, process_id, topics, workflow_names, skill_names, created_at, updated_at 컬럼 존재
 * - When: down 실행
 * - Then: process_attribute 테이블 없음
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ProcessAttributeTableMigration } from './020-process-attribute-table.js';
import type { Migration } from '../types.js';

function createSchemaWith019(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      owner_id TEXT NULL,
      process_id TEXT NULL,
      session_id TEXT NULL,
          project_id TEXT,
          is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
          deleted_at TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS memento_schema_version (
      version TEXT PRIMARY KEY,
      migration_name TEXT NOT NULL
    )
  `);
}

function tableExists(db: Database.Database, tableName: string): boolean {
  const result = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
  ).get(tableName);
  return !!result;
}

function columnExists(db: Database.Database, tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name: string }>;
  return columns.some(c => c.name === columnName);
}

describe('Migration 020 - process_attribute table', () => {
  let db: Database.Database;
  let migration: Migration;

  beforeEach(() => {
    db = new Database(':memory:');
    createSchemaWith019(db);
    migration = new ProcessAttributeTableMigration();
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('Given: 019까지 적용된 스키마, When: up 실행, Then: process_attribute 테이블 및 컬럼 존재', async () => {
    await migration.up(db);
    expect(tableExists(db, 'process_attribute')).toBe(true);
    expect(columnExists(db, 'process_attribute', 'process_id')).toBe(true);
    expect(columnExists(db, 'process_attribute', 'topics')).toBe(true);
    expect(columnExists(db, 'process_attribute', 'workflow_names')).toBe(true);
    expect(columnExists(db, 'process_attribute', 'skill_names')).toBe(true);
    expect(columnExists(db, 'process_attribute', 'created_at')).toBe(true);
    expect(columnExists(db, 'process_attribute', 'updated_at')).toBe(true);
  });

  it('Given: up 적용 후, When: down 실행, Then: process_attribute 테이블 제거', async () => {
    await migration.up(db);
    expect(tableExists(db, 'process_attribute')).toBe(true);
    await migration.down(db);
    expect(tableExists(db, 'process_attribute')).toBe(false);
  });

  it('Given: process_attribute 없음, When: validateBefore 호출, Then: 통과', async () => {
    await expect(migration.validateBefore(db)).resolves.toBeUndefined();
  });

  it('Given: up 적용 후, When: validateAfter 호출, Then: 통과', async () => {
    await migration.up(db);
    await expect(migration.validateAfter(db)).resolves.toBeUndefined();
  });
});
