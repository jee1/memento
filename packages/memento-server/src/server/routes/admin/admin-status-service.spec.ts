/**
 * Admin status service helpers (Issue #1054)
 */

import { describe, it, expect } from 'vitest';
import { formatDurationHumanKo } from './admin-status-service.js';

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
