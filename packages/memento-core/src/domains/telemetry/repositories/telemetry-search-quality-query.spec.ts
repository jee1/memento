import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TelemetryEventsMigration } from '../../../infrastructure/database/sqlite/migration/migrations/027-telemetry-events.js';
import { queryRejectionGateKneeMass, queryRejectionGateRate } from './telemetry-search-quality-query.js';

describe('rejection gate window queries', () => {
  let db: Database.Database;
  let seq = 0;

  const reranked = (createdAt: string, verdict: string | null, topScore: number | null, ownerId = 'o1') => {
    db.prepare(
      `INSERT INTO telemetry_events (id, event_type, request_id, owner_id, outcome, extra_data, created_at)
       VALUES (?, 'memory.search.reranked', ?, ?, 'success', ?, ?)`,
    ).run(
      `e${seq++}`,
      `r${seq}`,
      ownerId,
      JSON.stringify(verdict === null ? { reranked_count: 0 } : { rejection_gate_verdict: verdict, rejection_gate_top_score: topScore }),
      createdAt,
    );
  };

  beforeEach(async () => {
    db = new Database(':memory:');
    await new TelemetryEventsMigration().up(db);
    seq = 0;
  });

  afterEach(() => db.close());

  it('includes an event at start and excludes one exactly at end', () => {
    reranked('2026-11-02T00:00:00.000Z', 'rejected', 0.1);
    reranked('2026-11-05T12:00:00.000Z', 'passed', 0.9);
    reranked('2026-11-09T00:00:00.000Z', 'rejected', 0.1);

    expect(queryRejectionGateRate(db, { start: '2026-11-02T00:00:00.000Z', end: '2026-11-09T00:00:00.000Z' })).toEqual({
      rejection_rate: 1 / 2,
      rejection_decided_count: 2,
      fail_open_count: 0,
      rejected_count: 1,
    });
  });

  it('reads everything from start when end is omitted, and drops fail_open, off and keyless events from the denominator', () => {
    reranked('2026-11-02T00:00:00.000Z', 'rejected', 0.1);
    reranked('2026-11-03T00:00:00.000Z', 'fail_open', null);
    reranked('2026-11-03T00:00:00.000Z', 'off', null);
    reranked('2026-11-03T00:00:00.000Z', null, null);
    reranked('2026-11-10T00:00:00.000Z', 'passed', 0.8);

    expect(queryRejectionGateRate(db, { start: '2026-11-02T00:00:00.000Z' })).toEqual({
      rejection_rate: 1 / 2,
      rejection_decided_count: 2,
      fail_open_count: 1,
      rejected_count: 1,
    });
  });

  it('scopes by owner only when one is given', () => {
    reranked('2026-11-02T00:00:00.000Z', 'rejected', 0.1, 'o1');
    reranked('2026-11-02T00:00:00.000Z', 'passed', 0.9, 'o2');
    expect(queryRejectionGateRate(db, { start: '2026-11-01T00:00:00.000Z', ownerId: 'o1' }).rejection_rate).toBe(1);
    expect(queryRejectionGateRate(db, { start: '2026-11-01T00:00:00.000Z' }).rejection_rate).toBe(1 / 2);
  });

  it('reports no rate for an empty window', () => {
    expect(queryRejectionGateRate(db, { start: '2026-11-01T00:00:00.000Z' })).toEqual({
      rejection_rate: null,
      rejection_decided_count: 0,
      fail_open_count: 0,
      rejected_count: 0,
    });
    expect(queryRejectionGateKneeMass(db, { start: '2026-11-01T00:00:00.000Z' }, 0.4, 0.1)).toBeNull();
  });

  it('measures the decided share whose top score sits in [threshold, threshold + width)', () => {
    const at = '2026-11-02T00:00:00.000Z';
    reranked(at, 'rejected', 0.39);
    reranked(at, 'passed', 0.4);
    reranked(at, 'passed', 0.45);
    reranked(at, 'passed', 0.5);
    reranked(at, 'fail_open', 0.45);

    expect(queryRejectionGateKneeMass(db, { start: at }, 0.4, 0.1)).toBe(2 / 4);
  });
});
