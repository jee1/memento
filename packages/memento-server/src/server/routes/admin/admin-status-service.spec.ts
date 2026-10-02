/**
 * Admin status service helpers (Issue #1054)
 */

import { describe, it, expect } from 'vitest';
import { formatDurationHumanKo, toDailySeries } from './admin-status-service.js';

describe('formatDurationHumanKo (#1054)', () => {
  const cases: Array<{ ms: number; expected: string }> = [
    { ms: 0, expected: '0초' },
    { ms: -1, expected: '0초' },
    { ms: Number.NaN, expected: '0초' },
    { ms: Number.POSITIVE_INFINITY, expected: '0초' },
    { ms: 45_000, expected: '45초' },
    { ms: 59_999, expected: '59초' },
    { ms: 60_000, expected: '1분' },
    { ms: 720_000, expected: '12분' },
    { ms: 3_600_000, expected: '1시간' },
    { ms: 3_660_000, expected: '1시간 1분' },
    { ms: 86_400_000, expected: '1일' },
    { ms: 302_400_000, expected: '3일 12시간' },
  ];

  for (const { ms, expected } of cases) {
    it(`formats ${ms} ms as "${expected}" (#1054)`, () => {
      expect(formatDurationHumanKo(ms)).toBe(expected);
    });
  }

  it('never returns a digits-only string for any pinned case (#1054)', () => {
    for (const { ms } of cases) {
      expect(formatDurationHumanKo(ms)).not.toMatch(/^\d+$/);
    }
  });
});

describe('toDailySeries (#1146)', () => {
  const now = Date.parse('2026-10-02T13:00:00.000Z');

  it('returns an array of zeros for empty input', () => {
    expect(toDailySeries([], now, 30)).toEqual(new Array(30).fill(0));
  });

  it('places today at the last index', () => {
    const series = toDailySeries([{ day: '2026-10-02', ms: 7 }], now, 30);
    expect(series[29]).toBe(7);
    expect(series.filter((v) => v !== 0)).toEqual([7]);
  });

  it('places 29 days before today at index 0', () => {
    const series = toDailySeries([{ day: '2026-09-03', ms: 5 }], now, 30);
    expect(series[0]).toBe(5);
  });

  it('drops rows outside the window', () => {
    expect(
      toDailySeries([{ day: '2026-09-02', ms: 5 }, { day: '2026-10-03', ms: 9 }], now, 30),
    ).toEqual(new Array(30).fill(0));
  });

  it('maps multiple in-window days to correct indices', () => {
    const series = toDailySeries(
      [{ day: '2026-10-01', ms: 4 }, { day: '2026-09-30', ms: 6 }],
      now,
      30,
    );
    expect(series[28]).toBe(4);
    expect(series[27]).toBe(6);
    expect(series).toHaveLength(30);
  });
});
