import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mementoConfig } from '../../../../shared/config/index.js';
import {
  createGateDriftDb,
  insertRerankedEvents,
} from '../../../../domains/telemetry/gate-drift/__tests__/gate-drift-test-support.js';
import type { BatchSchedulerRunContext } from '../batch-scheduler-run-context.js';
import { runRejectionGateDriftCheck } from '../batch-scheduler-gate-drift-handlers.js';

function context(db: Database.Database | null): BatchSchedulerRunContext {
  return { db, config: {}, log: vi.fn() } as unknown as BatchSchedulerRunContext;
}

const driftEvents = (db: Database.Database) =>
  db.prepare(`SELECT extra_data FROM telemetry_events WHERE event_type = 'memory.search.gate_drift'`).all() as Array<{
    extra_data: string;
  }>;

describe('runRejectionGateDriftCheck (#1681)', () => {
  const saved = { gate: mementoConfig.searchRejectionGate, key: mementoConfig.typesafeApiKey };
  let db: Database.Database;

  beforeEach(async () => {
    db = await createGateDriftDb();
    mementoConfig.searchRejectionGate = 'typesafe';
    mementoConfig.typesafeApiKey = 'test-key';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    mementoConfig.searchRejectionGate = saved.gate;
    mementoConfig.typesafeApiKey = saved.key;
    db.close();
  });

  it('skips and writes no event while the gate is off', async () => {
    mementoConfig.searchRejectionGate = 'off';
    const result = await runRejectionGateDriftCheck(context(db));
    expect(result).toMatchObject({ success: true, details: { status: 'skipped', reason: 'SEARCH_REJECTION_GATE=off' } });
    expect(driftEvents(db)).toHaveLength(0);
  });

  it('skips with no_baseline on an empty history', async () => {
    const fresh = await createGateDriftDb({ freshInstall: true });
    const result = await runRejectionGateDriftCheck(context(fresh));
    expect(result).toMatchObject({ success: true, details: { status: 'skipped', reason: 'no_baseline' } });
    expect(driftEvents(fresh)).toHaveLength(0);
    fresh.close();
  });

  it('fails without a database', async () => {
    const result = await runRejectionGateDriftCheck(context(null));
    expect(result.success).toBe(false);
  });

  it('records one verdict event and never calls an external API', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await runRejectionGateDriftCheck(context(db));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([]);
    const events = driftEvents(db);
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].extra_data)).toMatchObject({ baseline_id: 2, threshold: 0.4, alert: false });
  });

  it('warns that a re-measurement is due when the weekly rate leaves the band', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T09:00:00.000Z'));
    insertRerankedEvents(db, '2026-11-03T12:00:00.000Z', 'rejected', 200, 0.1);
    insertRerankedEvents(db, '2026-11-03T12:00:00.000Z', 'passed', 421, 0.9);

    const result = await runRejectionGateDriftCheck(context(db));

    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('재측정');
    expect(JSON.parse(driftEvents(db)[0].extra_data)).toMatchObject({ alert: true, band: { outcome: 'alert' } });
  });
});
