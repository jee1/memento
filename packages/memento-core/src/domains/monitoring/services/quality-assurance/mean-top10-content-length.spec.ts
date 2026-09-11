import { describe, it, expect } from 'vitest';
import { meanTop10ContentLength } from './category-quality-aggregator.js';

describe('meanTop10ContentLength (#934)', () => {
  it('상위 10건 content 길이 평균을 반환한다', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      content: 'x'.repeat((i + 1) * 100),
    }));
    // top10 lengths: 100..1000 → sum = 100*(1+...+10)=5500 → mean 550
    expect(meanTop10ContentLength(items)).toBe(550);
  });

  it('10건 미만이면 있는 항목만 평균한다', () => {
    const items = [{ content: 'abcd' }, { content: 'ef' }, { content: null }];
    // lengths 4, 2, 0 → mean 2
    expect(meanTop10ContentLength(items)).toBe(2);
  });

  it('빈 배열이면 0', () => {
    expect(meanTop10ContentLength([])).toBe(0);
  });

  it('11번째 이후 길이는 평균에 넣지 않는다', () => {
    const items = [
      ...Array.from({ length: 10 }, () => ({ content: 'a'.repeat(100) })),
      { content: 'b'.repeat(10_000) },
    ];
    expect(meanTop10ContentLength(items)).toBe(100);
  });
});
