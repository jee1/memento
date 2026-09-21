import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MetaMemoryStatsSchemaMigration } from '../../../infrastructure/database/sqlite/migration/migrations/011-meta-memory-stats-schema.js';
import { MemoryReviewCandidateSchemaMigration } from '../../../infrastructure/database/sqlite/migration/migrations/033-memory-review-candidate-schema.js';
import {
  queryMemoryReviewCandidates,
  upsertPendingMemoryReviewCandidates,
} from './memory-review-candidate-persistence-service.js';
import { MEMORY_REVIEW_IMPORTANCE_FALLBACK } from './memory-review-candidate-list-query.js';

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

function seedCandidate(
  db: Database.Database,
  memoryId: string,
  type: string,
  importance: number | null,
  createdAt: string,
  lastRecalledAt: string | null,
  reason: string,
  priority: number,
): void {
  db.prepare(
    `INSERT INTO memory_item (id, type, content, importance, created_at, pinned, is_deleted, deleted_at)
     VALUES (?, ?, 'content', ?, ?, 0, 0, NULL)`,
  ).run(memoryId, type, importance, createdAt);
  db.prepare(
    `INSERT INTO meta_memory_stats (
      memory_id, recall_count, success_count, failure_count,
      avg_confidence, last_recalled_at, created_at, updated_at
    ) VALUES (?, 1, 1, 0, 0.8, ?, ?, ?)`,
  ).run(memoryId, lastRecalledAt, createdAt, createdAt);
  upsertPendingMemoryReviewCandidates(
    db,
    [{ memory_id: memoryId, priority, reason, due_at: '2026-07-01T00:00:00.000Z' }],
    NOW,
  );
}

describe('queryMemoryReviewCandidates (#897 AC8)', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    createBaseSchema(db);
    await new MetaMemoryStatsSchemaMigration().up(db);
    await new MemoryReviewCandidateSchemaMigration().up(db);

    seedCandidate(db, 'mem_high', 'semantic', 0.9, '2020-01-01 00:00:00', '2020-06-01 00:00:00', 'eligible: anchor=last_recalled_at', 300);
    seedCandidate(db, 'mem_mid', 'episodic', 0.7, '2024-01-01 00:00:00', null, 'eligible: anchor=created_at_fallback', 200);
    seedCandidate(db, 'mem_low', 'working', null, '2025-05-01 00:00:00', '2025-05-15 00:00:00', 'low priority seed', 100);
  });

  afterEach(() => {
    db.close();
  });

  it('filters by importance_min', () => {
    const result = queryMemoryReviewCandidates(
      db,
      { status: 'pending', importance_min: 0.8, page_size: 25, page: 1 },
      { now: NOW },
    );
    expect(result.candidates.map((c) => c.memory_id)).toEqual(['mem_high']);
    expect(result.filters_applied.importance_min).toBe(0.8);
  });

  it('uses importance fallback 0.5 when memory_item.importance is NULL', () => {
    const result = queryMemoryReviewCandidates(
      db,
      { status: 'pending', importance_min: 0.4, page_size: 25, page: 1 },
      { now: NOW },
    );
    const low = result.candidates.find((c) => c.memory_id === 'mem_low');
    expect(low?.importance).toBe(MEMORY_REVIEW_IMPORTANCE_FALLBACK);
  });

  it('filters by memory_type and reason_contains', () => {
    const result = queryMemoryReviewCandidates(
      db,
      {
        status: 'pending',
        memory_type: 'semantic',
        reason_contains: 'last_recalled_at',
        page_size: 25,
        page: 1,
      },
      { now: NOW },
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].memory_id).toBe('mem_high');
  });

  it('computes unused_days from last_recalled_at or created_at fallback', () => {
    const result = queryMemoryReviewCandidates(
      db,
      { status: 'pending', page_size: 25, page: 1 },
      { now: NOW },
    );
    const high = result.candidates.find((c) => c.memory_id === 'mem_high');
    const mid = result.candidates.find((c) => c.memory_id === 'mem_mid');
    expect(high?.unused_anchor).toBe('last_recalled_at');
    expect(high?.unused_days).toBeGreaterThan(2000);
    expect(mid?.unused_anchor).toBe('created_at_fallback');
    expect(mid?.unused_days).toBeGreaterThan(800);
  });

  it('filters by unused_days_min', () => {
    const result = queryMemoryReviewCandidates(
      db,
      { status: 'pending', unused_days_min: 1000, page_size: 25, page: 1 },
      { now: NOW },
    );
    expect(result.candidates.every((c) => c.unused_days >= 1000)).toBe(true);
    expect(result.candidates.some((c) => c.memory_id === 'mem_low')).toBe(false);
  });

  it('paginates with page_size 25 and reports metadata', () => {
    const result = queryMemoryReviewCandidates(
      db,
      { status: 'pending', page_size: 25, page: 1 },
      { now: NOW },
    );
    expect(result.candidates).toHaveLength(3);
    expect(result.pagination).toMatchObject({
      page: 1,
      page_size: 25,
      total_count: 3,
      total_pages: 1,
      has_prev: false,
      has_next: false,
    });
  });

  it('returns empty page when page exceeds total_pages', () => {
    const result = queryMemoryReviewCandidates(
      db,
      { status: 'pending', page_size: 25, page: 99 },
      { now: NOW },
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.pagination?.page).toBe(99);
    expect(result.pagination?.total_count).toBe(3);
  });

  it('reports has_prev false when total_count is zero even on high page', () => {
    const result = queryMemoryReviewCandidates(
      db,
      { status: 'pending', importance_min: 0.99, page_size: 25, page: 5 },
      { now: NOW },
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.pagination).toMatchObject({
      total_count: 0,
      page: 5,
      has_prev: false,
      has_next: false,
    });
  });

  it('falls back unused_days anchor to candidate.created_at when recall and memory created_at are blank', () => {
    const memoryId = 'mem_candidate_created_only';
    db.prepare(
      `INSERT INTO memory_item (id, type, content, importance, created_at, pinned, is_deleted, deleted_at)
       VALUES (?, 'semantic', 'content', 0.8, '   ', 0, 0, NULL)`,
    ).run(memoryId);
    upsertPendingMemoryReviewCandidates(
      db,
      [{ memory_id: memoryId, priority: 150, reason: 'candidate created_at anchor', due_at: '2026-07-01T00:00:00.000Z' }],
      NOW,
    );
    db.prepare(
      `UPDATE memory_review_candidate SET created_at = ? WHERE memory_id = ?`,
    ).run('2020-01-01 00:00:00', memoryId);

    const result = queryMemoryReviewCandidates(
      db,
      { status: 'pending', reason_contains: 'candidate created_at anchor', page_size: 25, page: 1 },
      { now: NOW },
    );
    const row = result.candidates.find((c) => c.memory_id === memoryId);
    expect(row?.unused_anchor).toBe('created_at_fallback');
    expect(row?.unused_days).toBeGreaterThan(2000);
  });

  it('never selects memory_item.content', () => {
    const result = queryMemoryReviewCandidates(
      db,
      { status: 'pending', page_size: 25, page: 1 },
      { now: NOW },
    );
    for (const candidate of result.candidates) {
      expect(candidate).not.toHaveProperty('content');
    }
  });
});
