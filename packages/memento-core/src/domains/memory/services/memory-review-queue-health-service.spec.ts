/**
 * Pending review queue health — Issue #294
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MemoryReviewCandidateSchemaMigration } from '../../../infrastructure/database/database/migration/migrations/033-memory-review-candidate-schema.js';
import { ReviewQueueHealthSnapshotMigration } from '../../../infrastructure/database/database/migration/migrations/034-review-queue-health-snapshot.js';
import {
  computeMemoryReviewQueueHealthLive,
  recordMemoryReviewQueueHealthSnapshot,
  listMemoryReviewQueueHealthSnapshots,
} from './memory-review-queue-health-service.js';
import {
  upsertPendingMemoryReviewCandidates,
  markMemoryReviewCandidateReviewed,
} from './memory-review-candidate-persistence-service.js';

describe('memory-review-queue-health-service', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
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
        owner_id TEXT,
        is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
        deleted_at TEXT
      );
    `);
    await new MemoryReviewCandidateSchemaMigration().up(db);
    await new ReviewQueueHealthSnapshotMigration().up(db);
    db.prepare(`INSERT INTO memory_item (id, type, content, pinned, is_deleted, deleted_at) VALUES ('m1', 'semantic', 'a', 0, 0, NULL)`).run();
    db.prepare(`INSERT INTO memory_item (id, type, content, pinned, is_deleted, deleted_at) VALUES ('m2', 'semantic', 'b', 0, 0, NULL)`).run();
    const seed = new Date(Date.now() - 3_600_000).toISOString();
    upsertPendingMemoryReviewCandidates(
      db,
      [{ memory_id: 'm1', priority: 0.9, reason: 'r1', due_at: seed, metadata_json: null }],
      seed,
    );
    upsertPendingMemoryReviewCandidates(
      db,
      [{ memory_id: 'm2', priority: 0.8, reason: 'r2', due_at: seed, metadata_json: null }],
      seed,
    );
    const pid = db
      .prepare(`SELECT id FROM memory_review_candidate WHERE memory_id='m2'`)
      .get() as { id: string };
    markMemoryReviewCandidateReviewed(db, pid.id, new Date().toISOString());
  });

  afterEach(() => {
    db.close();
  });

  it('computeMemoryReviewQueueHealthLive reports pending total and windows', () => {
    const live = computeMemoryReviewQueueHealthLive(db);
    expect(live.pendingTotal).toBe(1);
    expect(live.window1h.processedTotal).toBeGreaterThanOrEqual(1);
    expect(live.window24h.processedTotal).toBeGreaterThanOrEqual(1);
  });

  it('record + list snapshots', () => {
    const row = recordMemoryReviewQueueHealthSnapshot(db)!;
    expect(row.pending_total).toBe(1);
    const rows = listMemoryReviewQueueHealthSnapshots(db, 5);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(row.id);
  });
});
