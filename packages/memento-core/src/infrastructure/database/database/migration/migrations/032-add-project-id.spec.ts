/**
 * Migration 032 테스트 — memory_item project_id 컬럼
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { AddProjectIdMigration } from './032-add-project-id.js';

function createMemoryItemTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function columnExists(db: Database.Database, tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name: string }>;
  return columns.some(c => c.name === columnName);
}

function indexExists(db: Database.Database, indexName: string): boolean {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`
  ).get(indexName) as { name: string } | undefined;
  return !!row;
}

describe('Migration 032 - project_id column', () => {
  let db: Database.Database;
  let migration: AddProjectIdMigration;

  beforeEach(() => {
    db = new Database(':memory:');
    createMemoryItemTable(db);
    migration = new AddProjectIdMigration();
  });

  afterEach(() => {
    db.close();
  });

  it('adds project_id column to memory_item', async () => {
    expect(columnExists(db, 'memory_item', 'project_id')).toBe(false);
    await migration.up(db);
    expect(columnExists(db, 'memory_item', 'project_id')).toBe(true);
  });

  it('creates composite partial index on (project_id, type)', async () => {
    await migration.up(db);
    expect(indexExists(db, 'idx_memory_item_project_id_type')).toBe(true);
  });

  it('is idempotent — running up() twice does not throw', async () => {
    await migration.up(db);
    await expect(migration.up(db)).resolves.not.toThrow();
  });

  it('existing rows get NULL project_id after migration', async () => {
    db.exec(`INSERT INTO memory_item (id, type, content) VALUES ('mem_1', 'episodic', 'test')`);
    await migration.up(db);
    const row = db.prepare(`SELECT project_id FROM memory_item WHERE id = 'mem_1'`).get() as { project_id: string | null };
    expect(row.project_id).toBeNull();
  });

  it('validateAfter passes after up()', async () => {
    await migration.up(db);
    await expect(migration.validateAfter(db)).resolves.not.toThrow();
  });
});
