import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MetaMemoryStatsSchemaMigration } from '../../../infrastructure/database/database/migration/migrations/011-meta-memory-stats-schema.js';
import { MemoryReviewCandidateSchemaMigration } from '../../../infrastructure/database/database/migration/migrations/033-memory-review-candidate-schema.js';
import {
  upsertPendingMemoryReviewCandidates,
  getMemoryReviewCandidateById,
  listMemoryReviewCandidates,
  countPendingMemoryReviewCandidates,
  markMemoryReviewCandidateReviewed,
  markMemoryReviewCandidateDismissed,
  markMemoryReviewCandidateExpired,
  bulkUpdatePendingMemoryReviewCandidates,
  countPendingMemoryReviewCandidatesBySelector,
} from './memory-review-candidate-persistence-service.js';
import {
  MemoryReviewCandidateError,
  MEMORY_REVIEW_CANDIDATE_NOT_ACTIONABLE,
  MEMORY_REVIEW_CANDIDATE_NOT_FOUND,
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
    expect(countPendingMemoryReviewCandidates(db)).toBe(1);
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
  it('dismiss updates only candidate row', () => {
    upsertPendingMemoryReviewCandidates(
      db,
      [{ memory_id: 'mem_a', priority: 1, reason: 'q', due_at: '2026-07-01T00:00:00.000Z' }],
      NOW,
    );
    const row = listMemoryReviewCandidates(db, { status: 'pending' })[0];
    const before = db.prepare(`SELECT content, importance FROM memory_item WHERE id = 'mem_a'`).get() as {
      content: string;
      importance: number;
    };
    markMemoryReviewCandidateDismissed(db, row.id, NOW);
    const after = db.prepare(`SELECT content, importance FROM memory_item WHERE id = 'mem_a'`).get() as {
      content: string;
      importance: number;
    };
    expect(after).toEqual(before);
    expect(getMemoryReviewCandidateById(db, row.id)?.status).toBe('dismissed');
  });
  it('expire moves pending to expired without touching memory_item importance', () => {
    upsertPendingMemoryReviewCandidates(
      db,
      [{ memory_id: 'mem_a', priority: 1, reason: 'q', due_at: '2026-07-01T00:00:00.000Z' }],
      NOW,
    );
    const row = listMemoryReviewCandidates(db, { status: 'pending' })[0];
    const beforeImp = (
      db.prepare(`SELECT importance FROM memory_item WHERE id = 'mem_a'`).get() as { importance: number }
    ).importance;
    markMemoryReviewCandidateExpired(db, row.id, NOW);
    expect(getMemoryReviewCandidateById(db, row.id)?.status).toBe('expired');
    const afterImp = (
      db.prepare(`SELECT importance FROM memory_item WHERE id = 'mem_a'`).get() as { importance: number }
    ).importance;
    expect(afterImp).toBe(beforeImp);
  });

  it('unknown id on expire throws not found', () => {
    let caught: unknown;
    expect(() => {
      try {
        markMemoryReviewCandidateExpired(db, '00000000-0000-0000-0000-000000000000', NOW);
      } catch (e) {
        caught = e;
        throw e;
      }
    }).toThrow(MemoryReviewCandidateError);
    expect(caught).toMatchObject({
      code: MEMORY_REVIEW_CANDIDATE_NOT_FOUND,
      statusCode: 404,
    });
  });

  it('bulk dismiss updates only selected pending ids and reports matched rows', () => {
    upsertPendingMemoryReviewCandidates(
      db,
      [{ memory_id: 'mem_a', priority: 1, reason: 'q', due_at: '2026-07-01T00:00:00.000Z' }],
      NOW,
    );
    const row = listMemoryReviewCandidates(db, { status: 'pending' })[0];
    expect(bulkUpdatePendingMemoryReviewCandidates(db, 'dismiss', { ids: [row.id] }, NOW)).toEqual({
      matched: 1,
      updated: 1,
    });
    expect(getMemoryReviewCandidateById(db, row.id)?.status).toBe('dismissed');
  });

  it('bulk expire selects pending candidates older than the requested age', () => {
    upsertPendingMemoryReviewCandidates(
      db,
      [{ memory_id: 'mem_a', priority: 1, reason: 'q', due_at: '2026-07-01T00:00:00.000Z' }],
      '2026-05-01T00:00:00.000Z',
    );
    expect(
      bulkUpdatePendingMemoryReviewCandidates(db, 'expire', { older_than_days: 30 }, NOW),
    ).toEqual({
      matched: 1,
      updated: 1,
    });
    expect(listMemoryReviewCandidates(db, { status: 'expired' })).toHaveLength(1);
  });

  it('counts the same pending candidates without mutating them', () => {
    upsertPendingMemoryReviewCandidates(
      db,
      [{ memory_id: 'mem_a', priority: 1, reason: 'q', due_at: '2026-07-01T00:00:00.000Z' }],
      '2026-05-01T00:00:00.000Z',
    );

    const targetCount = countPendingMemoryReviewCandidatesBySelector(
      db,
      { older_than_days: 30 },
      NOW,
    );
    expect(targetCount).toBe(1);
    expect(listMemoryReviewCandidates(db, { status: 'pending' })).toHaveLength(1);
    expect(
      bulkUpdatePendingMemoryReviewCandidates(db, 'expire', { older_than_days: 30 }, NOW),
    ).toEqual({ matched: targetCount, updated: targetCount });
  });

  it.each([
    ['dismiss', 'ids'],
    ['dismiss', 'older_than_days'],
    ['dismiss', 'all_pending'],
    ['expire', 'ids'],
    ['expire', 'older_than_days'],
    ['expire', 'all_pending'],
  ] as const)('supports %s with the %s selector', (action, selectorKind) => {
    upsertPendingMemoryReviewCandidates(
      db,
      [{ memory_id: 'mem_a', priority: 1, reason: 'q', due_at: '2026-07-01T00:00:00.000Z' }],
      '2026-05-01T00:00:00.000Z',
    );
    const row = listMemoryReviewCandidates(db, { status: 'pending' })[0];
    const selector =
      selectorKind === 'ids'
        ? { ids: [row.id] }
        : selectorKind === 'older_than_days'
          ? { older_than_days: 30 }
          : { all_pending: true as const };

    expect(bulkUpdatePendingMemoryReviewCandidates(db, action, selector, NOW)).toEqual({
      matched: 1,
      updated: 1,
    });
  });
});
