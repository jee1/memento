import { describe, expect, it } from 'vitest';
import { cosineSimilarity, dotProduct } from '../vector-math.js';

describe('vector math', () => {
  it('computes dot products and cosine similarity', () => {
    expect(dotProduct([1, 2], [3, 4])).toBe(11);
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('returns zero for empty, zero-magnitude, or mismatched vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
  });

  it('preserves NaN by default and can retain the legacy NaN-as-zero behavior', () => {
    expect(cosineSimilarity([Number.NaN, 1], [1, 1])).toBeNaN();
    expect(cosineSimilarity([Number.NaN, 1], [1, 1], { nanAsZero: true })).toBeCloseTo(
      Math.SQRT1_2,
    );
  });
});
