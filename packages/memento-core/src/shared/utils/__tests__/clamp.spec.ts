import { describe, expect, it } from 'vitest';
import { clamp01 } from '../clamp.js';

describe('clamp01', () => {
  it.each([
    [-1, 0],
    [0.25, 0.25],
    [2, 1],
  ])('clamps %s to %s', (value, expected) => {
    expect(clamp01(value)).toBe(expected);
  });

  it('uses the requested fallback for non-finite values', () => {
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Number.POSITIVE_INFINITY, 0.5)).toBe(0.5);
  });
});
