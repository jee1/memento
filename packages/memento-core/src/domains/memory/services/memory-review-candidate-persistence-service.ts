import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { ensureMemoryReviewCandidateSchema } from '../../../shared/utils/ensure-memory-review-candidate-schema.js';
import type {
  ListMemoryReviewCandidatesQuery,
  MemoryReviewCandidateRow,
  UpsertPendingMemoryReviewCandidateInput,
  UpsertPendingMemoryReviewCandidatesResult,
} from './memory-review-candidate-persistence.types.js';

export function upsertPendingMemoryReviewCandidates(
  db: Database.Database,
  items: UpsertPendingMemoryReviewCandidateInput[],
  now: string,
): UpsertPendingMemoryReviewCandidatesResult {
  ensureMemoryReviewCandidateSchema(db);
  let inserted = 0;
  let updated = 0;

  const run = db.transaction(() => {
    const selectPending = db.prepare<[string], { id: string }>(
      `SELECT id FROM memory_review_candidate WHERE memory_id = ? AND status = 'pending'`,
    );
    const updatePending = db.prepare(
      `UPDATE memory_review_candidate SET
        priority = @priority,
        reason = @reason,
        due_at = @due_at,
        metadata_json = @metadata_json,
        updated_at = @updated_at
      WHERE id = @id`,
    );
    const insert = db.prepare(
      `INSERT INTO memory_review_candidate (
        id, memory_id, status, priority, reason, due_at, created_at, updated_at, metadata_json
      ) VALUES (
        @id, @memory_id, 'pending', @priority, @reason, @due_at, @created_at, @updated_at, @metadata_json
      )`,
    );

    for (const item of items) {
      const existing = selectPending.get(item.memory_id);
      if (existing) {
        updatePending.run({
          id: existing.id,
          priority: item.priority,
          reason: item.reason,
          due_at: item.due_at,
          metadata_json: item.metadata_json ?? null,
          updated_at: now,
        });
        updated += 1;
      } else {
        insert.run({
          id: randomUUID(),
          memory_id: item.memory_id,
          priority: item.priority,
          reason: item.reason,
          due_at: item.due_at,
          created_at: now,
          updated_at: now,
          metadata_json: item.metadata_json ?? null,
        });
        inserted += 1;
      }
    }
  });

  run();
  return { inserted, updated };
}

function mapRow(r: Record<string, unknown>): MemoryReviewCandidateRow {
  return {
    id: String(r.id),
    memory_id: String(r.memory_id),
    status: r.status as MemoryReviewCandidateRow['status'],
    priority: Number(r.priority),
    reason: String(r.reason),
    due_at: String(r.due_at),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    reviewed_at: r.reviewed_at == null ? null : String(r.reviewed_at),
    dismissed_at: r.dismissed_at == null ? null : String(r.dismissed_at),
    metadata_json: r.metadata_json == null ? null : String(r.metadata_json),
  };
}

export function getMemoryReviewCandidateById(
  db: Database.Database,
  id: string,
): MemoryReviewCandidateRow | null {
  ensureMemoryReviewCandidateSchema(db);
  const r = db
    .prepare<[string], Record<string, unknown>>(`SELECT * FROM memory_review_candidate WHERE id = ?`)
    .get(id);
  return r ? mapRow(r) : null;
}

export function listMemoryReviewCandidates(
  db: Database.Database,
  query: ListMemoryReviewCandidatesQuery = {},
): MemoryReviewCandidateRow[] {
  ensureMemoryReviewCandidateSchema(db);
  if (query.status) {
    return db
      .prepare<[string], Record<string, unknown>>(
        `SELECT * FROM memory_review_candidate WHERE status = ? ORDER BY priority DESC, due_at ASC`,
      )
      .all(query.status)
      .map((row) => mapRow(row));
  }
  return db
    .prepare<[], Record<string, unknown>>(
      `SELECT * FROM memory_review_candidate ORDER BY priority DESC, due_at ASC`,
    )
    .all()
    .map((row) => mapRow(row));
}
