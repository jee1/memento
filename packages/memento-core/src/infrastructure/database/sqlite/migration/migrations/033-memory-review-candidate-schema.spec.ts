/**
 * Migration 033 테스트 — memory_review_candidate
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MemoryReviewCandidateSchemaMigration } from './033-memory-review-candidate-schema.js';

function createMemoryItemTable(db: Database.Database): void {
  db.pragma('foreign_keys = ON');
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

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name);
  return !!row;
}

describe('Migration 033 - memory_review_candidate', () => {
  let db: Database.Database;
  let migration: MemoryReviewCandidateSchemaMigration;

  beforeEach(() => {
    db = new Database(':memory:');
    createMemoryItemTable(db);
    migration = new MemoryReviewCandidateSchemaMigration();
  });

  afterEach(() => {
    db.close();
  });

  it('creates memory_review_candidate and indexes', async () => {
    await migration.up(db);
    expect(tableExists(db, 'memory_review_candidate')).toBe(true);
    await expect(migration.validateAfter(db)).resolves.not.toThrow();
  });

  it('is idempotent — up() twice does not throw', async () => {
    await migration.up(db);
    await expect(migration.up(db)).resolves.not.toThrow();
    await expect(migration.validateAfter(db)).resolves.not.toThrow();
  });

  it('rejects two pending rows for the same memory_id', async () => {
    await migration.up(db);
    db.exec(`
      INSERT INTO memory_item (id, type, content) VALUES ('m1', 'episodic', 'a');
      INSERT INTO memory_review_candidate (
        id, memory_id, status, priority, reason, due_at, created_at, updated_at
      ) VALUES (
        'c1', 'm1', 'pending', 0.5, 'test', '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
    `);
    expect(() =>
      db.exec(`
        INSERT INTO memory_review_candidate (
          id, memory_id, status, priority, reason, due_at, created_at, updated_at
        ) VALUES (
          'c2', 'm1', 'pending', 0.6, 'test2', '2026-01-02T00:00:00.000Z',
          '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z'
        );
      `)
    ).toThrow();
  });

  it('allows two rows for same memory_id if only one is pending', async () => {
    await migration.up(db);
    db.exec(`
      INSERT INTO memory_item (id, type, content) VALUES ('m1', 'episodic', 'a');
      INSERT INTO memory_review_candidate (
        id, memory_id, status, priority, reason, due_at, created_at, updated_at
      ) VALUES (
        'c1', 'm1', 'reviewed', 0.5, 'r', '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
      INSERT INTO memory_review_candidate (
        id, memory_id, status, priority, reason, due_at, created_at, updated_at
      ) VALUES (
        'c2', 'm1', 'pending', 0.6, 'p', '2026-01-02T00:00:00.000Z',
        '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z'
      );
    `);
    const n = db
      .prepare(`SELECT COUNT(*) as n FROM memory_review_candidate WHERE memory_id = 'm1'`)
      .get() as { n: number };
    expect(n.n).toBe(2);
  });
});
