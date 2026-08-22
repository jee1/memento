import { describe, expect, it } from 'vitest';
import { DAY_MS, daysBetween } from '../date.js';

describe('date utilities', () => {
  it('exposes the canonical millisecond day and fractional signed elapsed days', () => {
    expect(DAY_MS).toBe(86_400_000);
    const earlier = new Date('2026-01-01T00:00:00.000Z');
    const later = new Date(earlier.getTime() + DAY_MS * 1.5);
    expect(daysBetween(later, earlier)).toBe(1.5);
    expect(daysBetween(earlier, later)).toBe(-1.5);
  });
});
