import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countActiveMemoryItems } from '../../../memory/index.js';
import { checkRejectionGateDrift } from '../gate-drift-monitor.js';
import { createGateDriftDb, insertRerankedEvents } from './gate-drift-test-support.js';

/**
 * #1681 백테스트 재현(설계 변경 b). 시드 참조는 ISO 45 창(기각률 313/621, 무릎 질량 75/621)이다.
 * ISO 45, 46 의 decided 건수와 기각 건수는 이슈 표의 값이고 이벤트는 합성이다. ISO 44 는 참조 창 앞이라 판정하지 않는다.
 * ISO 47, 48 은 이슈 표에 없는 가상 주다. 47 은 무릎 질량이 넓힌 하한 바로 위라 반폭을 3 시그마만으로 바꾸면 alert 로 뒤집힌다.
 */
describe('gate drift backtest on the seeded baseline', () => {
  let db: Database.Database;

  const week = (mondayIso: string, decided: number, rejected: number) => {
    insertRerankedEvents(db, mondayIso, 'rejected', rejected, 0.1);
    insertRerankedEvents(db, mondayIso, 'passed', decided - rejected, 0.9);
    insertRerankedEvents(db, mondayIso, 'fail_open', 40, null);
    insertRerankedEvents(db, mondayIso, 'off', 12, null);
  };

  const judge = (nowIso: string) => checkRejectionGateDrift(db, new Date(nowIso), countActiveMemoryItems)!;

  beforeEach(async () => {
    db = await createGateDriftDb();
    week('2026-11-03T12:00:00.000Z', 621, 313);
    week('2026-11-10T12:00:00.000Z', 78, 30);
    week('2026-11-17T12:00:00.000Z', 621, 242);
    week('2026-11-24T12:00:00.000Z', 621, 200);
  });

  afterEach(() => db.close());

  it('ISO 45, the reference week itself, sits at the band centre', () => {
    const verdict = judge('2026-11-10T00:00:00.000Z');
    expect(verdict.band).toMatchObject({
      week_start: '2026-11-02T00:00:00.000Z',
      week_end: '2026-11-09T00:00:00.000Z',
      decided_n: 621,
      outcome: 'ok',
    });
    expect(verdict.band.rejection_rate).toBeCloseTo(313 / 621, 10);
    expect(verdict.band.half_width).toBeCloseTo(75 / 621, 10);
    expect(verdict.band.lower).toBeCloseTo(0.383, 3);
    expect(verdict.band.upper).toBeCloseTo(0.625, 3);
    expect(verdict.scale.alert).toBe(false);
    expect(verdict.alert).toBe(false);
  });

  it('ISO 46 has too few decided queries to judge', () => {
    const verdict = judge('2026-11-17T00:00:00.000Z');
    expect(verdict.band).toMatchObject({ decided_n: 78, outcome: 'insufficient_n' });
    expect(verdict.scale.alert).toBe(false);
    expect(verdict.alert).toBe(false);
  });

  it('a week just above the knee-widened lower edge stays inside the band', () => {
    const verdict = judge('2026-11-24T00:00:00.000Z');
    expect(verdict.band).toMatchObject({ decided_n: 621, outcome: 'ok' });
    expect(verdict.band.rejection_rate).toBeCloseTo(242 / 621, 10);
    expect(verdict.band.half_width).toBeCloseTo(75 / 621, 10);
    expect(verdict.alert).toBe(false);
  });

  it('a week below the lower edge raises the alert', () => {
    const verdict = judge('2026-12-01T00:00:00.000Z');
    expect(verdict.band).toMatchObject({ decided_n: 621, outcome: 'alert' });
    expect(verdict.band.rejection_rate).toBeCloseTo(200 / 621, 10);
    expect(verdict.scale.alert).toBe(false);
    expect(verdict.alert).toBe(true);
  });
});
