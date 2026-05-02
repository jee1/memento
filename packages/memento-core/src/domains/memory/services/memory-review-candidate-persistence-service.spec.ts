import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MetaMemoryStatsSchemaMigration } from '../../../infrastructure/database/database/migration/migrations/011-meta-memory-stats-schema.js';
import { MemoryReviewCandidateSchemaMigration } from '../../../infrastructure/database/database/migration/migrations/033-memory-review-candidate-schema.js';
import {
  upsertPendingMemoryReviewCandidates,
  getMemoryReviewCandidateById,
  listMemoryReviewCandidates,
  markMemoryReviewCandidateReviewed,
} from './memory-review-candidate-persistence-service.js';
import {
  MemoryReviewCandidateError,
  MEMORY_REVIEW_CANDIDATE_NOT_ACTIONABLE,
} from './memory-review-candidate-persistence-error.js';

const NOW = '2026-06-01T12:00:00.000Z';

function createBaseSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      privacy_scope TEXT DEFAULT 'private',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_accessed TIMESTAMP,
      last_accessed_at TEXT,
      pinned BOOLEAN DEFAULT FALSE,
      tags TEXT,
      source TEXT,
      project_id TEXT,
      is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
      deleted_at TEXT
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS memento_schema_version (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      migration_name TEXT NOT NULL,
      checksum TEXT,
      applied_by TEXT DEFAULT 'system',
      description TEXT
    );
  `);
}

describe('memory-review-candidate-persistence upsert', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    createBaseSchema(db);
    await new MetaMemoryStatsSchemaMigration().up(db);
    await new MemoryReviewCandidateSchemaMigration().up(db);
    db.exec(`
      INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at, pinned, is_deleted, deleted_at)
      VALUES ('mem_a', 'semantic', 'hello', 0.9, 'private', '2020-01-01 00:00:00', 0, 0, NULL)
    `);
    db.exec(`
      INSERT INTO meta_memory_stats (
        memory_id, recall_count, success_count, failure_count,
        avg_confidence, last_recalled_at, created_at, updated_at
      ) VALUES (
        'mem_a', 1, 1, 0, 0.9, '2020-02-01 00:00:00', '2020-02-01 00:00:00', '2020-02-01 00:00:00'
      )
    `);
  });

  afterEach(() => {
    db.close();
  });

  it('inserts pending on first upsert and updates same memory_id on second (idempotent)', () => {
    const first = upsertPendingMemoryReviewCandidates(
      db,
      [{ memory_id: 'mem_a', priority: 100, reason: 'r1', due_at: '2026-07-01T00:00:00.000Z' }],
      NOW,
    );
    expect(first.inserted).toBe(1);
    expect(first.updated).toBe(0);

    const rows1 = db
      .prepare(`SELECT priority, reason FROM memory_review_candidate WHERE memory_id = 'mem_a'`)
      .all() as { priority: number; reason: string }[];
    expect(rows1).toHaveLength(1);
    expect(rows1[0].priority).toBe(100);

    const second = upsertPendingMemoryReviewCandidates(
      db,
      [{ memory_id: 'mem_a', priority: 200, reason: 'r2', due_at: '2026-08-01T00:00:00.000Z' }],
      NOW,
    );
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(1);

    const rows2 = db
      .prepare(`SELECT COUNT(*) as c FROM memory_review_candidate WHERE memory_id = 'mem_a' AND status = 'pending'`)
      .get() as { c: number };
    expect(rows2.c).toBe(1);
    const pr = db
      .prepare(`SELECT priority, reason FROM memory_review_candidate WHERE memory_id = 'mem_a'`)
      .get() as { priority: number; reason: string };
    expect(pr.priority).toBe(200);
    expect(pr.reason).toBe('r2');
  });

  it('get and list return pending candidate', () => {
    upsertPendingMemoryReviewCandidates(
      db,
      [{ memory_id: 'mem_a', priority: 42, reason: 'x', due_at: '2026-07-01T00:00:00.000Z' }],
      NOW,
    );
    const rows = listMemoryReviewCandidates(db, { status: 'pending' });
    expect(rows).toHaveLength(1);
    const one = getMemoryReviewCandidateById(db, rows[0].id);
    expect(one?.memory_id).toBe('mem_a');
    expect(one?.status).toBe('pending');
  });

  it('markReviewed updates candidate and memory_item access timestamps', () => {
    upsertPendingMemoryReviewCandidates(
      db,
      [{ memory_id: 'mem_a', priority: 1, reason: 'q', due_at: '2026-07-01T00:00:00.000Z' }],
      NOW,
    );
    const row = listMemoryReviewCandidates(db, { status: 'pending' })[0];
    markMemoryReviewCandidateReviewed(db, row.id, NOW);

    const cand = getMemoryReviewCandidateById(db, row.id);
    expect(cand?.status).toBe('reviewed');
    expect(cand?.reviewed_at).toBe(NOW);

    const mem = db.prepare(`SELECT last_accessed_at FROM memory_item WHERE id = 'mem_a'`).get() as {
      last_accessed_at: string | null;
    };
    expect(mem.last_accessed_at).toBe(NOW);
  });

  it('second markReviewed throws not actionable', () => {
    upsertPendingMemoryReviewCandidates(
      db,
      [{ memory_id: 'mem_a', priority: 1, reason: 'q', due_at: '2026-07-01T00:00:00.000Z' }],
      NOW,
    );
    const row = listMemoryReviewCandidates(db, { status: 'pending' })[0];
    markMemoryReviewCandidateReviewed(db, row.id, NOW);
    let caught: unknown;
    expect(() => {
      try {
        markMemoryReviewCandidateReviewed(db, row.id, NOW);
      } catch (e) {
        caught = e;
        throw e;
      }
    }).toThrow(MemoryReviewCandidateError);
    expect(caught).toMatchObject({
      code: MEMORY_REVIEW_CANDIDATE_NOT_ACTIONABLE,
      statusCode: 409,
    });
  });
});
