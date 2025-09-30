import { describe, it, expect } from 'vitest';
import { SearchRanking } from './search-ranking.js';

describe('SearchRanking', () => {
  const ranking = new SearchRanking();

  describe('calculateFinalScore', () => {
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

    it('음수 점수가 나올 수 있다', () => {
      const score = ranking.calculateFinalScore({
        relevance: 0.1,
        recency: 0.1,
        importance: 0.1,
        usage: 0.1,
        duplication_penalty: 0.9,
      });

      expect(score).toBeLessThan(0);
    });
  });

  describe('calculateRelevance', () => {
    it('기본 관련성 점수를 계산한다', () => {
      const relevance = ranking.calculateRelevance({
        query: 'React Hook',
        content: 'React Hook에 대해 설명한 문서입니다. Hook API 예시 포함.',
        tags: ['frontend', 'react']
      });

      expect(relevance).toBeLessThanOrEqual(1);
      expect(relevance).toBeGreaterThan(0);
    });

    it('임베딩 유사도가 제공된 경우 관련성 점수를 계산한다', () => {
      const relevance = ranking.calculateRelevance({
        query: 'React Hook',
        content: 'React Hook에 대한 내용',
        tags: ['react'],
        embeddingSimilarity: {
          queryEmbedding: [0.1, 0.2, 0.3, 0.4],
          docEmbedding: [0.1, 0.2, 0.3, 0.4]
        }
      });
      expect(relevance).toBeGreaterThan(0);
    });

    it('BM25 결과가 제공된 경우 관련성 점수를 계산한다', () => {
      const relevance = ranking.calculateRelevance({
        query: 'React Hook',
        content: 'React Hook에 대한 내용',
        tags: ['react'],
        bm25Result: { score: 2.5, normalizedScore: 0.8 }
      });
      expect(relevance).toBeGreaterThan(0);
    });

    it('타이틀이 있는 경우 타이틀 히트 점수를 반영한다', () => {
      const relevance = ranking.calculateRelevance({
        query: 'React Hook',
        content: 'React Hook에 대한 내용',
        title: 'React Hook Guide',
        tags: ['react']
      });
      expect(relevance).toBeGreaterThan(0);
    });

    it('빈 문자열 입력에 대해 안전하게 처리한다', () => {
      const relevance = ranking.calculateRelevance({
        query: '',
        content: '',
        tags: []
      });
      expect(relevance).toBe(0);
    });

    it('null/undefined 입력에 대해 안전하게 처리한다', () => {
      const relevance = ranking.calculateRelevance({
        query: null as any,
        content: undefined as any,
        tags: []
      });
      expect(relevance).toBe(0);
    });
  });

  describe('calculateRecency', () => {
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

    it('타입별로 다른 반감기를 적용한다', () => {
      const working = ranking.calculateRecency(
        new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        'working'
      );
      const episodic = ranking.calculateRecency(
        new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        'episodic'
      );
      const semantic = ranking.calculateRecency(
        new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        'semantic'
      );

      expect(working).toBeLessThan(episodic);
      expect(episodic).toBeLessThan(semantic);
    });

    it('매우 오래된 기억은 낮은 점수를 받는다', () => {
      const veryOld = ranking.calculateRecency(
        new Date(Date.now() - 1000 * 24 * 60 * 60 * 1000),
        'semantic'
      );
      expect(veryOld).toBeLessThan(0.1); // 1000일 전의 기억은 0.1보다 작은 점수
    });
  });

  describe('calculateImportance', () => {
    it('고정된 중요 기억은 부스트를 받아 점수가 상승한다', () => {
      const base = ranking.calculateImportance(0.4, false, 'episodic');
      const pinned = ranking.calculateImportance(0.4, true, 'episodic');
      const semantic = ranking.calculateImportance(0.4, false, 'semantic');

      expect(pinned).toBeGreaterThan(base);
      expect(semantic).toBeGreaterThan(base);
      expect(pinned).toBeLessThanOrEqual(1);
    });

    it('타입별로 다른 부스트를 적용한다', () => {
      const working = ranking.calculateImportance(0.5, false, 'working');
      const episodic = ranking.calculateImportance(0.5, false, 'episodic');
      const semantic = ranking.calculateImportance(0.5, false, 'semantic');
      const procedural = ranking.calculateImportance(0.5, false, 'procedural');

      expect(working).toBeLessThan(episodic);
      expect(episodic).toBeLessThan(procedural);
      expect(procedural).toBeLessThan(semantic);
    });

    it('중요도는 0과 1 사이로 제한된다', () => {
      const low = ranking.calculateImportance(-0.5, false, 'episodic');
      const high = ranking.calculateImportance(1.5, false, 'episodic');

      expect(low).toBeGreaterThanOrEqual(0);
      expect(high).toBeLessThanOrEqual(1);
    });
  });

  describe('calculateUsage', () => {
    it('접근 이력이 없는 경우 기본 사용성 점수를 적용한다', () => {
      const metrics = { viewCount: 0, citeCount: 0, editCount: 0 };
      expect(ranking.calculateUsage(metrics)).toBeCloseTo(0.1, 5);
    });

    it('다양한 사용성 메트릭을 올바르게 계산한다', () => {
      const metrics = { viewCount: 10, citeCount: 5, editCount: 2 };
      const usage = ranking.calculateUsage(metrics);
      expect(usage).toBeGreaterThan(0.1);
      expect(usage).toBeLessThanOrEqual(1);
    });

    it('배치 정규화가 적용된 사용성 점수를 계산한다', () => {
      const metrics = { viewCount: 10, citeCount: 5, editCount: 2 };
      const usage = ranking.calculateUsage(metrics, 0, 20);
      expect(usage).toBeGreaterThanOrEqual(0);
      expect(usage).toBeLessThanOrEqual(1);
    });

    it('null 입력에 대해 안전하게 처리한다', () => {
      const usage = ranking.calculateUsage(null as any);
      expect(usage).toBe(0);
    });

    it('모든 메트릭이 0인 경우 기본값을 반환한다', () => {
      const metrics = { viewCount: 0, citeCount: 0, editCount: 0 };
      const usage = ranking.calculateUsage(metrics);
      expect(usage).toBeCloseTo(0.1, 5);
    });
  });

  describe('calculateBatchUsage', () => {
    it('여러 메모리에 대한 배치 사용성 점수를 계산한다', () => {
      const metricsList = [
        { viewCount: 10, citeCount: 5, editCount: 2 },
        { viewCount: 20, citeCount: 10, editCount: 4 },
        { viewCount: 5, citeCount: 2, editCount: 1 }
      ];
      
      const result = ranking.calculateBatchUsage(metricsList);
      expect(result.normalized).toHaveLength(3);
      expect(result.min).toBeLessThanOrEqual(result.max);
      expect(result.normalized.every(score => score >= 0 && score <= 1)).toBe(true);
    });

    it('빈 배열에 대해 안전하게 처리한다', () => {
      const result = ranking.calculateBatchUsage([]);
      expect(result.normalized).toHaveLength(0);
    });
  });

  describe('calculateDuplicationPenalty', () => {
    it('중복 패널티는 선택된 콘텐츠와의 최대 유사도를 반영한다', () => {
      const penalty = ranking.calculateDuplicationPenalty(
        'TypeScript Generic Tutorial',
        ['React Hook Guide', 'TypeScript Advanced Generic Tutorial']
      );

      expect(penalty).toBeGreaterThan(0);
      expect(penalty).toBeLessThan(1);
    });

    it('선택된 콘텐츠가 없으면 패널티가 0이다', () => {
      const penalty = ranking.calculateDuplicationPenalty(
        'TypeScript Generic Tutorial',
        []
      );
      expect(penalty).toBe(0);
    });

    it('완전히 다른 콘텐츠는 낮은 패널티를 받는다', () => {
      const penalty = ranking.calculateDuplicationPenalty(
        'React Hook Guide',
        ['Python Machine Learning', 'Database Design Patterns']
      );
      expect(penalty).toBeLessThan(0.5);
    });
  });

  describe('하위 호환성 메서드들', () => {
    it('calculateRelevanceSimple이 올바르게 작동한다', () => {
      const relevance = ranking.calculateRelevanceSimple(
        'React Hook',
        'React Hook에 대한 내용',
        ['react', 'hook']
      );
      expect(relevance).toBeGreaterThan(0);
    });

    it('calculateUsageSimple이 올바르게 작동한다', () => {
      const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
      const usage = ranking.calculateUsageSimple(recentDate);
      expect(usage).toBeGreaterThan(0);
    });

    it('calculateUsageSimple에서 lastAccessed가 없으면 기본값을 반환한다', () => {
      const usage = ranking.calculateUsageSimple(undefined);
      expect(usage).toBeCloseTo(0.1, 5);
    });
  });

  describe('엣지 케이스들', () => {
    it('0으로 나누기 상황을 안전하게 처리한다', () => {
      const usage = ranking.calculateUsage(
        { viewCount: 0, citeCount: 0, editCount: 0 },
        0, 0 // min과 max가 같을 때
      );
      // rawUsage가 0이므로 기본값 0.1을 반환
      expect(usage).toBe(0.1);
    });

    it('매우 큰 값들에 대해 안전하게 처리한다', () => {
      const relevance = ranking.calculateRelevance({
        query: 'a'.repeat(10000),
        content: 'b'.repeat(10000),
        tags: Array(1000).fill('tag')
      });
      expect(relevance).toBeGreaterThanOrEqual(0);
      expect(relevance).toBeLessThanOrEqual(1);
    });
  });
});
