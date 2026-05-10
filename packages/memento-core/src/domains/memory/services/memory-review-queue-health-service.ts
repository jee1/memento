/**
 * Pending review queue health metrics (GitHub #294 / issue #277 follow-up).
 * Uses memory_review_candidate timestamps; optional append-only snapshots for trends.
 */
import type Database from 'better-sqlite3';
import { ensureMemoryReviewCandidateSchema } from '../../../shared/utils/ensure-memory-review-candidate-schema.js';

export interface ReviewQueueWindowCounts {
  /** Rows inserted in the window (producer signal; created_at). */
  candidatesCreated: number;
  reviewed: number;
  dismissed: number;
  expired: number;
  /** reviewed + dismissed + expired in the window. */
  processedTotal: number;
  /** created − processed (same-window proxy for queue pressure). */
  netFlow: number;
  /** processed / created when created > 0; otherwise null. */
  processingRatio: number | null;
}

export interface MemoryReviewQueueHealthLive {
  sampledAt: string;
  pendingTotal: number;
  window1h: ReviewQueueWindowCounts;
  window24h: ReviewQueueWindowCounts;
}

export interface MemoryReviewQueueHealthSnapshotRow {
  id: number;
  sampled_at: string;
  pending_total: number;
  created_last_1h: number;
  reviewed_last_1h: number;
  dismissed_last_1h: number;
  expired_last_1h: number;
  created_last_24h: number;
  reviewed_last_24h: number;
  dismissed_last_24h: number;
  expired_last_24h: number;
  net_flow_1h: number;
  processing_ratio_1h: number | null;
}

function snapshotTableReady(db: Database.Database): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='memory_review_queue_health_snapshot'`,
    )
    .get() as { ok: number } | undefined;
  return !!row;
}

function countCandidates(db: Database.Database, whereSql: string, ...params: unknown[]): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM memory_review_candidate WHERE ${whereSql}`)
    .get(...params) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

function buildWindowCounts(db: Database.Database, cutoffIso: string): ReviewQueueWindowCounts {
  const candidatesCreated = countCandidates(db, 'created_at >= ?', cutoffIso);
  const reviewed = countCandidates(db, 'reviewed_at IS NOT NULL AND reviewed_at >= ?', cutoffIso);
  const dismissed = countCandidates(db, 'dismissed_at IS NOT NULL AND dismissed_at >= ?', cutoffIso);
  const expired = countCandidates(db, "status = 'expired' AND updated_at >= ?", cutoffIso);
  const processedTotal = reviewed + dismissed + expired;
  const netFlow = candidatesCreated - processedTotal;
  const processingRatio =
    candidatesCreated > 0 ? processedTotal / candidatesCreated : null;
  return {
    candidatesCreated,
    reviewed,
    dismissed,
    expired,
    processedTotal,
    netFlow,
    processingRatio,
  };
}

/**
 * Compute live health metrics from the current DB (no writes).
 */
export function computeMemoryReviewQueueHealthLive(
  db: Database.Database,
  nowMs?: number,
): MemoryReviewQueueHealthLive {
  ensureMemoryReviewCandidateSchema(db);
  const now = nowMs ?? Date.now();
  const sampledAt = new Date(now).toISOString();
  const cutoff1h = new Date(now - 3_600_000).toISOString();
  const cutoff24h = new Date(now - 86_400_000).toISOString();
  const pendingRow = db
    .prepare(`SELECT COUNT(*) AS n FROM memory_review_candidate WHERE status = 'pending'`)
    .get() as { n: number };

  return {
    sampledAt,
    pendingTotal: Number(pendingRow?.n ?? 0),
    window1h: buildWindowCounts(db, cutoff1h),
    window24h: buildWindowCounts(db, cutoff24h),
  };
}

export function memoryReviewQueueHealthSnapshotTableReady(db: Database.Database): boolean {
  return snapshotTableReady(db);
}

/**
 * Append one snapshot row from current metrics. No-op when migration 034 is not applied.
 */
export function recordMemoryReviewQueueHealthSnapshot(
  db: Database.Database,
  nowMs?: number,
): MemoryReviewQueueHealthSnapshotRow | null {
  ensureMemoryReviewCandidateSchema(db);
  if (!snapshotTableReady(db)) {
    return null;
  }
  const live = computeMemoryReviewQueueHealthLive(db, nowMs);
  const w1 = live.window1h;

  const info = db
    .prepare(
      `INSERT INTO memory_review_queue_health_snapshot (
        sampled_at, pending_total,
        created_last_1h, reviewed_last_1h, dismissed_last_1h, expired_last_1h,
        created_last_24h, reviewed_last_24h, dismissed_last_24h, expired_last_24h,
        net_flow_1h, processing_ratio_1h
      ) VALUES (
        @sampled_at, @pending_total,
        @c1, @r1, @d1, @e1,
        @c24, @r24, @d24, @e24,
        @net_flow_1h, @processing_ratio_1h
      )`,
    )
    .run({
      sampled_at: live.sampledAt,
      pending_total: live.pendingTotal,
      c1: w1.candidatesCreated,
      r1: w1.reviewed,
      d1: w1.dismissed,
      e1: w1.expired,
      c24: live.window24h.candidatesCreated,
      r24: live.window24h.reviewed,
      d24: live.window24h.dismissed,
      e24: live.window24h.expired,
      net_flow_1h: w1.netFlow,
      processing_ratio_1h: w1.processingRatio,
    });

  const id = Number(info.lastInsertRowid);
  const row = db
    .prepare(`SELECT * FROM memory_review_queue_health_snapshot WHERE id = ?`)
    .get(id) as MemoryReviewQueueHealthSnapshotRow | undefined;
  return row ?? null;
}

/**
 * Recent snapshots newest-first (for dashboard / APIs).
 */
export function listMemoryReviewQueueHealthSnapshots(
  db: Database.Database,
  limit: number,
): MemoryReviewQueueHealthSnapshotRow[] {
  if (!snapshotTableReady(db)) {
    return [];
  }
  const cap = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 500) : 48;
  return db
    .prepare(`SELECT * FROM memory_review_queue_health_snapshot ORDER BY id DESC LIMIT ?`)
    .all(cap) as MemoryReviewQueueHealthSnapshotRow[];
}

/** Insert a snapshot at most once per minGapMs based on latest sampled_at (for on-demand refreshes). */
export function maybeRecordMemoryReviewQueueHealthSnapshot(
  db: Database.Database,
  minGapMs: number,
  nowMs?: number,
): MemoryReviewQueueHealthSnapshotRow | null {
  if (!snapshotTableReady(db)) {
    return null;
  }
  const now = nowMs ?? Date.now();
  const last = db
    .prepare(`SELECT sampled_at FROM memory_review_queue_health_snapshot ORDER BY id DESC LIMIT 1`)
    .get() as { sampled_at: string } | undefined;
  if (last?.sampled_at) {
    const t = Date.parse(last.sampled_at);
    if (Number.isFinite(t) && now - t < minGapMs) {
      return null;
    }
  }
  return recordMemoryReviewQueueHealthSnapshot(db, now);
}
