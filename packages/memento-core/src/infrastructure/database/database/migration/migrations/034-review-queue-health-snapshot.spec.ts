/**
 * Migration 034 테스트 — memory_review_queue_health_snapshot
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MemoryReviewCandidateSchemaMigration } from './033-memory-review-candidate-schema.js';
import { ReviewQueueHealthSnapshotMigration } from './034-review-queue-health-snapshot.js';

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
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  return !!row;
}

describe('Migration 034 - review_queue_health_snapshot', () => {
  let db: Database.Database;
  let migration: ReviewQueueHealthSnapshotMigration;

  beforeEach(async () => {
    db = new Database(':memory:');
    createMemoryItemTable(db);
    await new MemoryReviewCandidateSchemaMigration().up(db);
    migration = new ReviewQueueHealthSnapshotMigration();
  });

  afterEach(() => {
    db.close();
  });

  it('creates snapshot table and index', async () => {
    await migration.up(db);
    expect(tableExists(db, 'memory_review_queue_health_snapshot')).toBe(true);
    const idx = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`)
      .get('idx_memory_review_queue_health_sampled');
    expect(idx).toBeTruthy();
  });

  it('down removes snapshot artifacts', async () => {
    await migration.up(db);
    await migration.down(db);
    expect(tableExists(db, 'memory_review_queue_health_snapshot')).toBe(false);
  });
});
