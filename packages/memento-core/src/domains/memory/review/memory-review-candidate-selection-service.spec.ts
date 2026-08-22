/**
 * Memory review candidate selection service — integration tests (Issue #241)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { selectMemoryReviewCandidates } from './memory-review-candidate-selection-service.js';
import { MetaMemoryStatsSchemaMigration } from '../../../infrastructure/database/sqlite/migration/migrations/011-meta-memory-stats-schema.js';
import { MemoryReviewCandidateSchemaMigration } from '../../../infrastructure/database/sqlite/migration/migrations/033-memory-review-candidate-schema.js';

const FIXED_NOW = new Date('2026-06-01T12:00:00.000Z');

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

describe('selectMemoryReviewCandidates', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    createBaseSchema(db);
    await new MetaMemoryStatsSchemaMigration().up(db);
    await new MemoryReviewCandidateSchemaMigration().up(db);

    db.exec(`
      INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at, pinned, is_deleted, deleted_at)
      VALUES (
        'mem_stale',
        'semantic',
        'Stale high-importance memory',
        0.85,
        'private',
        '2020-01-15 00:00:00',
        0,
        0,
        NULL
      )
    `);

    db.exec(`
      INSERT INTO meta_memory_stats (
        memory_id, recall_count, success_count, failure_count,
        avg_confidence, last_recalled_at, created_at, updated_at
      ) VALUES (
        'mem_stale',
        10, 8, 2,
        0.8,
        '2020-06-01 00:00:00',
        '2020-06-01 00:00:00',
        '2020-06-01 00:00:00'
      )
    `);
  });

  afterEach(() => {
    db.close();
  });

  it('includes eligible stale high-importance memory with last_recalled anchor and eligible reason', () => {
    const results = selectMemoryReviewCandidates(db, {
      importanceThreshold: 0.7,
      staleDays: 14,
      maxCandidates: 50,
      now: FIXED_NOW,
    });

    expect(results).toHaveLength(1);
    expect(results[0].memory_id).toBe('mem_stale');
    expect(results[0].score_breakdown.anchor_kind).toBe('last_recalled_at');
    expect(results[0].reason).toContain('eligible:');
  });

  it('excludes memory that already has a pending memory_review_candidate row', () => {
    db.exec(`
      INSERT INTO memory_review_candidate (
        id, memory_id, status, priority, reason, due_at, created_at, updated_at
      ) VALUES (
        'cand-1', 'mem_stale', 'pending', 0.5, 'queued',
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z'
      )
    `);

    const results = selectMemoryReviewCandidates(db, {
      importanceThreshold: 0.7,
      staleDays: 14,
      maxCandidates: 50,
      now: FIXED_NOW,
    });

    expect(results).toEqual([]);
  });
});
