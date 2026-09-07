import { describe, expect, it } from 'vitest';
import {
  applyVectorLengthDecay,
  vectorLengthDecayFactor,
} from './vector-length-decay.js';

describe('vectorLengthDecayFactor (#921)', () => {
  it('is continuous and monotone increasing in length for fixed k', () => {
    const k = 40;
    const lengths = [1, 10, 21, 22, 40, 80, 200, 663];
    let prev = -1;
    for (const len of lengths) {
      const f = vectorLengthDecayFactor(len, k);
      expect(f).toBeGreaterThan(prev);
      expect(f).toBeGreaterThan(0);
      expect(f).toBeLessThanOrEqual(1);
      prev = f;
    }
  });

  it('approaches 1 for long documents', () => {
    expect(vectorLengthDecayFactor(10_000, 40)).toBeGreaterThan(0.995);
  });

  it('returns 0 for empty/non-positive length and 1 for non-positive k', () => {
    expect(vectorLengthDecayFactor(0, 40)).toBe(0);
    expect(vectorLengthDecayFactor(-1, 40)).toBe(0);
    expect(vectorLengthDecayFactor(21, 0)).toBe(1);
    expect(vectorLengthDecayFactor(21, -5)).toBe(1);
  });
});

describe('applyVectorLengthDecay (#921)', () => {
  const k = 40;

  it('leaves scores unchanged when disabled', () => {
    const items = [{ id: 'a', content: 'short', similarity: 0.9 }];
    expect(applyVectorLengthDecay(items, { enabled: false, characteristic_length: k })).toBe(items);
  });

  it('ranks long answer above short triple sentences given issue-like raw scores', () => {
    const shortA = '#917 수정은 검증 방법을 필요합니다'; // 21 chars (JS length)
    const shortB = '인제스트는 12:52 kst를 일치합니다'; // ~22
    const long = 'x'.repeat(663);
    expect(shortA.length).toBe(21);
    expect(shortB.length).toBeGreaterThanOrEqual(20);
    expect(shortB.length).toBeLessThan(30);
    expect(long.length).toBe(663);

    const raw = [
      { id: 'short-a', content: shortA, similarity: 0.749 },
      { id: 'short-b', content: shortB, similarity: 0.734 },
      { id: 'long', content: long, similarity: 0.722 },
    ];
    const decayed = applyVectorLengthDecay(raw, { enabled: true, characteristic_length: k });
    const ordered = [...decayed].sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
    expect(ordered[0]!.id).toBe('long');
    const longScore = decayed.find((r) => r.id === 'long')!.similarity!;
    expect(longScore).toBeGreaterThan(decayed.find((r) => r.id === 'short-a')!.similarity!);
    expect(longScore).toBeGreaterThan(decayed.find((r) => r.id === 'short-b')!.similarity!);
  });

  it('does not hard-zero moderate short facts (14–25 chars)', () => {
    const content = '사용자는 커피를 선호합니다';
    expect(content.length).toBeGreaterThanOrEqual(14);
    expect(content.length).toBeLessThanOrEqual(25);
    const [out] = applyVectorLengthDecay(
      [{ content, similarity: 0.8 }],
      { enabled: true, characteristic_length: k }
    );
    expect(out!.similarity).toBeGreaterThan(0);
    expect(out!.similarity).toBeCloseTo(0.8 * vectorLengthDecayFactor(content.length, k), 6);
  });
});
