import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getAdminMemoryItemPreviewById,
  parseAdminMemoryItemIdParam,
} from './admin-memory-item-preview-service.js';

function openDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      privacy_scope TEXT DEFAULT 'private',
      created_at TEXT,
      last_accessed TEXT,
      last_accessed_at TEXT,
      pinned INTEGER DEFAULT 0,
      tags TEXT,
      source TEXT,
      project_id TEXT,
      owner_id TEXT,
      is_deleted INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

describe('admin-memory-item-preview-service', () => {
  afterEach(() => {
    /* db closed per test */
  });

  it('parseAdminMemoryItemIdParam accepts mem_ ids', () => {
    const ok = parseAdminMemoryItemIdParam('mem_abc_01');
    expect(ok).toEqual({ memoryId: 'mem_abc_01' });
  });

  it('parseAdminMemoryItemIdParam rejects invalid ids', () => {
    const bad = parseAdminMemoryItemIdParam('../etc');
    expect(bad).toMatchObject({ error: 'Invalid memory id', status: 400 });
  });

  it('getAdminMemoryItemPreviewById returns preview', () => {
    const db = openDb();
    try {
      db.prepare(
        `INSERT INTO memory_item (
          id, type, content, importance, privacy_scope, created_at, pinned, is_deleted
        ) VALUES ('mem_x', 'semantic', 'hello body', 0.5, 'private', '2020-01-01', 0, 0)`,
      ).run();
      const row = getAdminMemoryItemPreviewById(db, 'mem_x');
      expect(row).not.toBeNull();
      expect(row!.content).toBe('hello body');
      expect(row!.type).toBe('semantic');
    } finally {
      db.close();
    }
  });

  it('getAdminMemoryItemPreviewById returns null when deleted', () => {
    const db = openDb();
    try {
      db.prepare(
        `INSERT INTO memory_item (
          id, type, content, importance, privacy_scope, created_at, pinned, is_deleted
        ) VALUES ('mem_del', 'semantic', 'gone', 0.5, 'private', '2020-01-01', 0, 1)`,
      ).run();
      expect(getAdminMemoryItemPreviewById(db, 'mem_del')).toBeNull();
    } finally {
      db.close();
    }
  });
});
