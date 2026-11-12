import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countActiveMemoryItems } from '../../../memory/index.js';
import { checkRejectionGateDrift } from '../gate-drift-monitor.js';
import { createGateDriftDb, insertRerankedEvents } from './gate-drift-test-support.js';

/**
 * #1681 백테스트 재현. 세 주의 decided 건수와 기각 건수는 이슈 표의 값이고 이벤트는 합성이다.
 * 시드 기준(참조 기각률 104/503, 무릎 질량 36/503)이 ISO 44 와 45 를 갈라야 한다.
 */
describe('gate drift backtest on the seeded baseline', () => {
  let db: Database.Database;

  const week = (mondayIso: string, decided: number, rejected: number) => {
    insertRerankedEvents(db, mondayIso, 'rejected', rejected, 0.1);
    insertRerankedEvents(db, mondayIso, 'passed', decided - rejected, 0.9);
    insertRerankedEvents(db, mondayIso, 'fail_open', 40, null);
    insertRerankedEvents(db, mondayIso, 'off', 12, null);
  };

  beforeEach(async () => {
    db = await createGateDriftDb();
    week('2026-10-27T12:00:00.000Z', 1946, 539);
    week('2026-11-03T12:00:00.000Z', 621, 313);
    week('2026-11-10T12:00:00.000Z', 78, 30);
  });

  afterEach(() => db.close());

  it('ISO 44 stays inside the band because the knee mass widens it', () => {
    const verdict = checkRejectionGateDrift(db, new Date('2026-11-03T00:00:00.000Z'), countActiveMemoryItems)!;
    expect(verdict.band).toMatchObject({
      week_start: '2026-10-26T00:00:00.000Z',
      week_end: '2026-11-02T00:00:00.000Z',
      decided_n: 1946,
      outcome: 'ok',
    });
    expect(verdict.band.rejection_rate).toBeCloseTo(539 / 1946, 10);
    expect(verdict.band.half_width).toBeCloseTo(36 / 503, 10);
    expect(verdict.band.lower).toBeCloseTo(0.135, 3);
    expect(verdict.band.upper).toBeCloseTo(0.278, 3);
    expect(verdict.scale.alert).toBe(false);
    expect(verdict.alert).toBe(false);
  });

  it('ISO 45 falls outside the band', () => {
    const verdict = checkRejectionGateDrift(db, new Date('2026-11-10T00:00:00.000Z'), countActiveMemoryItems)!;
    expect(verdict.band).toMatchObject({ decided_n: 621, outcome: 'alert' });
    expect(verdict.band.rejection_rate).toBeCloseTo(313 / 621, 10);
    expect(verdict.scale.alert).toBe(false);
    expect(verdict.alert).toBe(true);
  });

  it('ISO 46 has too few decided queries to judge', () => {
    const verdict = checkRejectionGateDrift(db, new Date('2026-11-17T00:00:00.000Z'), countActiveMemoryItems)!;
    expect(verdict.band).toMatchObject({ decided_n: 78, outcome: 'insufficient_n' });
    expect(verdict.scale.alert).toBe(false);
    expect(verdict.alert).toBe(false);
  });
});
