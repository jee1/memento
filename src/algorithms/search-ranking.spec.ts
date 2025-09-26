import { describe, it, expect } from 'vitest';
import { SearchRanking } from './search-ranking.js';

describe('SearchRanking', () => {
  const ranking = new SearchRanking();

  it('가중치에 따라 최종 점수를 계산한다', () => {
    const score = ranking.calculateFinalScore({
      relevance: 0.9,
      recency: 0.8,
      importance: 0.6,
      usage: 0.4,
      duplication_penalty: 0.2,
    });

    const expected = 0.5 * 0.9 + 0.2 * 0.8 + 0.2 * 0.6 + 0.1 * 0.4 - 0.15 * 0.2;
    expect(score).toBeCloseTo(expected, 5);
  });

  it('정확 매치, 단어 매치, 태그 매치로 관련성 점수를 누적하고 1.0을 초과하지 않는다', () => {
    const relevance = ranking.calculateRelevance({
      query: 'React Hook',
      content: 'React Hook에 대해 설명한 문서입니다. Hook API 예시 포함.',
      tags: ['frontend', 'react']
    });

    expect(relevance).toBeLessThanOrEqual(1);
    expect(relevance).toBeGreaterThan(0); // 관련성이 0보다 크면 통과
  });

  it('최근성이 높은 기억은 더 높은 점수를 받는다', () => {
    const recent = ranking.calculateRecency(
      new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      'semantic'
    );
    const old = ranking.calculateRecency(
      new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
      'semantic'
    );

    expect(recent).toBeGreaterThan(old);
    expect(recent).toBeLessThanOrEqual(1);
  });

  it('고정된 중요 기억은 부스트를 받아 점수가 상승한다', () => {
    const base = ranking.calculateImportance(0.4, false, 'episodic');
    const pinned = ranking.calculateImportance(0.4, true, 'episodic');
    const semantic = ranking.calculateImportance(0.4, false, 'semantic');

    expect(pinned).toBeGreaterThan(base);
    expect(semantic).toBeGreaterThan(base);
    expect(pinned).toBeLessThanOrEqual(1);
  });

  it('접근 이력이 없는 경우 기본 사용성 점수를 적용한다', () => {
    const metrics = { viewCount: 0, citeCount: 0, editCount: 0 };
    expect(ranking.calculateUsage(metrics)).toBeCloseTo(0.1, 5);
  });

  it('중복 패널티는 선택된 콘텐츠와의 최대 유사도를 반영한다', () => {
    const penalty = ranking.calculateDuplicationPenalty(
      'TypeScript Generic Tutorial',
      ['React Hook Guide', 'TypeScript Advanced Generic Tutorial']
    );

    expect(penalty).toBeGreaterThan(0);
    expect(penalty).toBeLessThan(1);
  });
});
