import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countActiveMemoryItems } from '../../../memory/index.js';
import { mementoConfig } from '../../../../shared/config/index.js';
import { readActiveBaseline } from '../baseline-store.js';
import {
  captureRejectionGateBaselineIfChanged,
  checkRejectionGateDrift,
  fillReferenceIfDue,
  judgeRejectionBand,
  lastCompletedIsoWeek,
} from '../gate-drift-monitor.js';
import { createGateDriftDb, insertRerankedEvents, seedActiveMemoryItems } from './gate-drift-test-support.js';

const baselineCount = (db: Database.Database) =>
  (db.prepare('SELECT COUNT(*) AS n FROM rejection_gate_baseline').get() as { n: number }).n;

describe('captureRejectionGateBaselineIfChanged', () => {
  const saved = {
    gate: mementoConfig.searchRejectionGate,
    threshold: mementoConfig.searchRejectionGateThreshold,
    model: mementoConfig.typesafeModel,
  };
  let db: Database.Database;

  beforeEach(() => {
    mementoConfig.searchRejectionGate = 'typesafe';
    mementoConfig.searchRejectionGateThreshold = 0.4;
    mementoConfig.typesafeModel = '';
  });

  afterEach(() => {
    mementoConfig.searchRejectionGate = saved.gate;
    mementoConfig.searchRejectionGateThreshold = saved.threshold;
    mementoConfig.typesafeModel = saved.model;
    db.close();
  });

  it('adds nothing on startup while the effective threshold equals the seeded one', async () => {
    db = await createGateDriftDb();
    expect(captureRejectionGateBaselineIfChanged(db, 'startup', countActiveMemoryItems)).toBeNull();
    expect(captureRejectionGateBaselineIfChanged(db, 'startup', countActiveMemoryItems)).toBeNull();
    expect(baselineCount(db)).toBe(2);
  });

  it('adds exactly one startup row for a changed threshold, however often it is repeated', async () => {
    db = await createGateDriftDb();
    seedActiveMemoryItems(db, 3);
    mementoConfig.searchRejectionGateThreshold = 0.5;
    const now = new Date('2026-11-12T00:00:00.000Z');
    captureRejectionGateBaselineIfChanged(db, 'startup', countActiveMemoryItems, now);
    captureRejectionGateBaselineIfChanged(db, 'startup', countActiveMemoryItems, now);

    expect(baselineCount(db)).toBe(3);
    expect(readActiveBaseline(db)).toMatchObject({
      threshold: 0.5,
      n_items: 3,
      measured_at: '2026-11-12T00:00:00.000Z',
      judge_model: 'jev-latest',
      source: 'startup',
      reference: null,
    });
  });

  it('records nothing while the gate is off', async () => {
    db = await createGateDriftDb();
    mementoConfig.searchRejectionGate = 'off';
    mementoConfig.searchRejectionGateThreshold = 0.5;
    expect(captureRejectionGateBaselineIfChanged(db, 'startup', countActiveMemoryItems)).toBeNull();
    expect(baselineCount(db)).toBe(2);
  });

  it('starts the history on a fresh install whose table is empty', async () => {
    db = await createGateDriftDb({ freshInstall: true });
    expect(captureRejectionGateBaselineIfChanged(db, 'startup', countActiveMemoryItems)).toMatchObject({ id: 1, threshold: 0.4 });
    expect(baselineCount(db)).toBe(1);
  });
});

describe('judgeRejectionBand', () => {
  const reference = (knee: number) => ({
    window_start: 'a',
    window_end: 'b',
    decided_n: 500,
    rejection_rate: 0.5,
    knee_mass: knee,
  });

  it('waits for a reference', () => {
    expect(judgeRejectionBand(null, 1000, 500).outcome).toBe('reference_pending');
  });

  it('refuses to judge a week with fewer than 100 decided queries', () => {
    expect(judgeRejectionBand(reference(0.25), 99, 99).outcome).toBe('insufficient_n');
    expect(judgeRejectionBand(reference(0.25), 100, 50).outcome).toBe('ok');
  });

  it('treats the band edge as inside when the knee mass sets the half width', () => {
    const at = (rejected: number) => judgeRejectionBand(reference(0.25), 100, rejected);
    expect(at(75)).toMatchObject({ outcome: 'ok', half_width: 0.25, lower: 0.25, upper: 0.75 });
    expect(at(25).outcome).toBe('ok');
    expect(at(76).outcome).toBe('alert');
    expect(at(24).outcome).toBe('alert');
  });

  it('uses three standard errors when that is wider than the knee mass', () => {
    const judged = judgeRejectionBand(reference(0.01), 100, 64);
    expect(judged.half_width).toBeCloseTo(0.15, 10);
    expect(judged.outcome).toBe('ok');
    expect(judgeRejectionBand(reference(0.01), 100, 66).outcome).toBe('alert');
  });
});

describe('lastCompletedIsoWeek', () => {
  it.each([
    ['2026-11-03T12:00:00.000Z', '2026-10-26T00:00:00.000Z', '2026-11-02T00:00:00.000Z'],
    ['2026-11-09T00:00:00.000Z', '2026-11-02T00:00:00.000Z', '2026-11-09T00:00:00.000Z'],
    ['2026-11-15T23:59:59.000Z', '2026-11-02T00:00:00.000Z', '2026-11-09T00:00:00.000Z'],
  ])('%s -> [%s, %s)', (now, start, end) => {
    expect(lastCompletedIsoWeek(new Date(now))).toEqual({ start, end });
  });
});

describe('reference fill and scale rule', () => {
  const saved = {
    gate: mementoConfig.searchRejectionGate,
    threshold: mementoConfig.searchRejectionGateThreshold,
  };
  const measuredAt = new Date('2026-11-12T00:00:00.000Z');
  let db: Database.Database;

  beforeEach(async () => {
    db = await createGateDriftDb();
    mementoConfig.searchRejectionGate = 'typesafe';
    mementoConfig.searchRejectionGateThreshold = 0.5;
  });

  afterEach(() => {
    mementoConfig.searchRejectionGate = saved.gate;
    mementoConfig.searchRejectionGateThreshold = saved.threshold;
    db.close();
  });

  function seedWindow(decided: number): void {
    const inWindow = '2026-11-13T00:00:00.000Z';
    const rejected = Math.round(decided * 0.3);
    const knee = Math.round(decided * 0.1);
    insertRerankedEvents(db, inWindow, 'rejected', rejected, 0.1);
    insertRerankedEvents(db, inWindow, 'passed', knee, 0.55);
    insertRerankedEvents(db, inWindow, 'passed', decided - rejected - knee, 0.9);
    insertRerankedEvents(db, inWindow, 'fail_open', 7, null);
    insertRerankedEvents(db, '2026-11-19T00:00:00.000Z', 'rejected', 5, 0.1);
  }

  it('keeps waiting until the window closes, then fills once from the observed distribution', () => {
    captureRejectionGateBaselineIfChanged(db, 'setting_change', countActiveMemoryItems, measuredAt);
    seedWindow(100);
    const active = readActiveBaseline(db)!;

    expect(fillReferenceIfDue(db, active, new Date('2026-11-18T23:59:59.000Z'))).toEqual(active);
    expect(baselineCount(db)).toBe(3);

    const closed = new Date('2026-11-19T00:00:00.000Z');
    const filled = fillReferenceIfDue(db, active, closed);
    expect(baselineCount(db)).toBe(4);
    expect(filled).toMatchObject({
      threshold: 0.5,
      measured_at: '2026-11-12T00:00:00.000Z',
      source: 'reference_fill',
      reference: {
        window_start: '2026-11-12T00:00:00.000Z',
        window_end: '2026-11-19T00:00:00.000Z',
        decided_n: 100,
      },
    });
    expect(filled.reference!.rejection_rate).toBeCloseTo(0.3, 10);
    expect(filled.reference!.knee_mass).toBeCloseTo(0.1, 10);

    fillReferenceIfDue(db, readActiveBaseline(db)!, new Date('2026-11-20T00:00:00.000Z'));
    expect(baselineCount(db)).toBe(4);
  });

  it('does not fill from 99 decided queries and leaves the band pending', () => {
    captureRejectionGateBaselineIfChanged(db, 'setting_change', countActiveMemoryItems, measuredAt);
    seedWindow(99);
    const verdict = checkRejectionGateDrift(db, new Date('2026-11-20T00:00:00.000Z'), countActiveMemoryItems);
    expect(baselineCount(db)).toBe(3);
    expect(verdict?.band.outcome).toBe('reference_pending');
    expect(verdict?.alert).toBe(false);
  });

  it('raises the scale alert at twice the baseline item count and not one item below', () => {
    const baselineN = readActiveBaseline(db)!.n_items;
    seedActiveMemoryItems(db, 2 * baselineN - 1);
    db.prepare(`INSERT INTO memory_item (id, is_deleted) VALUES ('gone', 1)`).run();
    const now = new Date('2026-11-12T00:00:00.000Z');
    expect(checkRejectionGateDrift(db, now, countActiveMemoryItems)?.scale).toEqual({
      n_items: 2 * baselineN - 1,
      baseline_n_items: baselineN,
      alert: false,
    });

    db.prepare(`INSERT INTO memory_item (id) VALUES ('one-more')`).run();
    const verdict = checkRejectionGateDrift(db, now, countActiveMemoryItems);
    expect(verdict?.scale.alert).toBe(true);
    expect(verdict?.alert).toBe(true);
  });

  it('reports no verdict when there is no baseline', async () => {
    const fresh = await createGateDriftDb({ freshInstall: true });
    expect(checkRejectionGateDrift(fresh, measuredAt, countActiveMemoryItems)).toBeNull();
    fresh.close();
  });
});
