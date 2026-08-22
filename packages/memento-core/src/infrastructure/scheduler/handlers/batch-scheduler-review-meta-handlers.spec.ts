import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { MetaMemoryStatsSchemaMigration } from '../../database/sqlite/migration/migrations/011-meta-memory-stats-schema.js';
import { MemoryReviewCandidateSchemaMigration } from '../../database/sqlite/migration/migrations/033-memory-review-candidate-schema.js';
import {
  listMemoryReviewCandidates,
  upsertPendingMemoryReviewCandidates,
} from '../../../domains/memory/review/memory-review-candidate-persistence-service.js';
import { runMemoryReviewCandidatesJob } from './batch-scheduler-review-meta-handlers.js';
import type { BatchSchedulerRunContext } from './batch-scheduler-run-context.js';

function createBaseSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE memory_item (
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
    CREATE TABLE memento_schema_version (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      migration_name TEXT NOT NULL,
      checksum TEXT,
      applied_by TEXT DEFAULT 'system',
      description TEXT
    );
  `);
}

function createContext(db: Database.Database): BatchSchedulerRunContext {
  return {
    db,
    log: vi.fn(),
    emitMemoryReviewCandidatesRunRecord: vi.fn().mockResolvedValue(undefined),
  } as unknown as BatchSchedulerRunContext;
}

describe('runMemoryReviewCandidatesJob queue controls', () => {
  let db: Database.Database;

  beforeEach(async () => {
    vi.unstubAllEnvs();
    db = new Database(':memory:');
    createBaseSchema(db);
    await new MetaMemoryStatsSchemaMigration().up(db);
    await new MemoryReviewCandidateSchemaMigration().up(db);
    db.exec(`
      INSERT INTO memory_item (
        id, type, content, importance, privacy_scope, created_at, pinned, is_deleted, deleted_at
      ) VALUES (
        'mem_old', 'semantic', 'old', 0.9, 'private', '2020-01-01 00:00:00', 0, 0, NULL
      );
    `);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    db.close();
  });

  it('skips selection when pending backlog is at the configured maximum', async () => {
    vi.stubEnv('MEMORY_REVIEW_MAX_BACKLOG', '1');
    vi.stubEnv('MEMORY_REVIEW_CANDIDATE_TTL_DAYS', '0');
    upsertPendingMemoryReviewCandidates(
      db,
      [{ memory_id: 'mem_old', priority: 1, reason: 'seed', due_at: '2026-07-01T00:00:00.000Z' }],
      new Date().toISOString(),
    );

    const result = await runMemoryReviewCandidatesJob(createContext(db));

    expect(result.success).toBe(true);
    expect(result.processed).toBe(0);
    expect(result.details).toMatchObject({
      inserted: 0,
      updated: 0,
      expired: 0,
      pendingBefore: 1,
      pendingAfter: 1,
      skippedForBacklog: true,
    });
  });

  it('expires pending candidates older than the configured TTL before selection', async () => {
    vi.stubEnv('MEMORY_REVIEW_MAX_BACKLOG', '10');
    vi.stubEnv('MEMORY_REVIEW_CANDIDATE_TTL_DAYS', '30');
    upsertPendingMemoryReviewCandidates(
      db,
      [{ memory_id: 'mem_old', priority: 1, reason: 'seed', due_at: '2026-01-02T00:00:00.000Z' }],
      '2026-01-01T00:00:00.000Z',
    );

    const result = await runMemoryReviewCandidatesJob(createContext(db));

    expect(result.success).toBe(true);
    expect(result.details).toMatchObject({
      expired: 1,
      pendingBefore: 0,
      skippedForBacklog: false,
    });
    expect(listMemoryReviewCandidates(db, { status: 'expired' })).toHaveLength(1);
  });

  it('limits selection to the remaining backlog capacity', async () => {
    vi.stubEnv('MEMORY_REVIEW_MAX_BACKLOG', '2');
    vi.stubEnv('MEMORY_REVIEW_CANDIDATE_TTL_DAYS', '0');
    db.exec(`
      INSERT INTO memory_item (
        id, type, content, importance, privacy_scope, created_at, pinned, is_deleted, deleted_at
      ) VALUES
        ('mem_two', 'semantic', 'two', 0.8, 'private', '2020-01-02 00:00:00', 0, 0, NULL),
        ('mem_three', 'semantic', 'three', 0.7, 'private', '2020-01-03 00:00:00', 0, 0, NULL);
    `);
    upsertPendingMemoryReviewCandidates(
      db,
      [{ memory_id: 'mem_old', priority: 1, reason: 'seed', due_at: '2026-07-01T00:00:00.000Z' }],
      new Date().toISOString(),
    );

    const result = await runMemoryReviewCandidatesJob(createContext(db));

    expect(result.success).toBe(true);
    expect(result.processed).toBe(1);
    expect(result.details).toMatchObject({
      inserted: 1,
      pendingBefore: 1,
      pendingAfter: 2,
      skippedForBacklog: false,
    });
    expect(listMemoryReviewCandidates(db, { status: 'pending' })).toHaveLength(2);
  });
});
