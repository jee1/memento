import { describe, expect, it } from 'vitest';
import { cosineDistanceToSimilarity } from './vector-similarity.js';

describe('cosineDistanceToSimilarity', () => {
  it('distance 0 → similarity 1 (같은 방향)', () => {
    expect(cosineDistanceToSimilarity(0)).toBe(1);
  });

  it('distance 1 → similarity 0 (직교)', () => {
    expect(cosineDistanceToSimilarity(1)).toBe(0);
  });

  it('distance 2 → similarity 0 (반대 방향, 하한 clamp)', () => {
    expect(cosineDistanceToSimilarity(2)).toBe(0);
  });

  it('부동소수 오차로 음수 distance가 와도 상한 1로 clamp', () => {
    expect(cosineDistanceToSimilarity(-0.0000001)).toBe(1);
  });

  it('비유한값은 0', () => {
    expect(cosineDistanceToSimilarity(Number.NaN)).toBe(0);
    expect(cosineDistanceToSimilarity(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('작을수록 큰 유사도 — 방향이 뒤집히지 않는다', () => {
    expect(cosineDistanceToSimilarity(0.2)).toBeGreaterThan(cosineDistanceToSimilarity(0.8));
  });
});
