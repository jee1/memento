import { describe, it, expect } from 'vitest';
import { reappearanceRate } from './quality-feedback-reappearance-report.js';

describe('reappearanceRate', () => {
  it('relevant.json에 정의된 쿼리 수로 나누고, 스냅샷에 없는 쿼리는 미스로 처리', () => {
    const relevant = { q1: ['a'], q2: ['b'] };
    const snap = { results: { q1: ['a', 'x'] } };
    expect(reappearanceRate(snap, relevant)).toBe(0.5);
  });

  it('relevant만 있고 스냅샷이 비어 있으면 0', () => {
    expect(reappearanceRate({ results: {} }, { q1: ['a'] })).toBe(0);
  });

  it('relevant가 비어 있으면 0', () => {
    expect(reappearanceRate({ results: { q1: ['a'] } }, {})).toBe(0);
  });
});
