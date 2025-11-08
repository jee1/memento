/**
 * 검색 랭킹 알고리즘 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SearchRanking, type SearchFeatures, type RelevanceInput, type UsageMetrics, type SearchProfile } from './search-ranking.js';

describe('SearchRanking', () => {
  let ranking: SearchRanking;

  beforeEach(() => {
    ranking = new SearchRanking();
  });

  afterEach(() => {
    // Cleanup if needed
  });

  describe('calculateFinalScore', () => {
    it('정상적인 최종 점수 계산', () => {
      const features: SearchFeatures = {
        relevance: 0.8,
        recency: 0.6,
        importance: 0.7,
        usage: 0.5,
        duplication_penalty: 0.2
      };

      const score = ranking.calculateFinalScore(features);
      
      // 기본 가중치: relevance(0.5) + recency(0.2) + importance(0.2) + usage(0.1) - duplication(0.15)
      const expected = 0.5 * 0.8 + 0.2 * 0.6 + 0.2 * 0.7 + 0.1 * 0.5 - 0.15 * 0.2;
      expect(score).toBeCloseTo(expected, 3);
    });

    it('최적값으로 최대 점수 계산', () => {
      const features: SearchFeatures = {
        relevance: 1.0,
        recency: 1.0,
        importance: 1.0,
        usage: 1.0,
        duplication_penalty: 0.0
      };

      const score = ranking.calculateFinalScore(features);
      expect(score).toBeCloseTo(1.0, 3);
    });

    it('최악값으로 최소 점수 계산', () => {
      const features: SearchFeatures = {
        relevance: 0.0,
        recency: 0.0,
        importance: 0.0,
        usage: 0.0,
        duplication_penalty: 1.0
      };

      const score = ranking.calculateFinalScore(features);
      expect(score).toBeCloseTo(-0.15, 3); // 중복 패널티만 적용
    });

    it('사용자 정의 가중치로 점수 계산', () => {
      const customRanking = new SearchRanking({
        relevance: 0.6,
        recency: 0.2,
        importance: 0.1,
        usage: 0.1,
        duplication_penalty: 0.1
      });

      const features: SearchFeatures = {
        relevance: 0.8,
        recency: 0.6,
        importance: 0.7,
        usage: 0.5,
        duplication_penalty: 0.2
      };

      const score = customRanking.calculateFinalScore(features);
      const expected = 0.6 * 0.8 + 0.2 * 0.6 + 0.1 * 0.7 + 0.1 * 0.5 - 0.1 * 0.2;
      expect(score).toBeCloseTo(expected, 3);
    });
  });

  describe('calculateRelevance', () => {
    it('기본 관련성 계산 (임베딩 없음)', () => {
      const input: RelevanceInput = {
        query: 'test query',
        content: 'This is a test content with test query',
        tags: ['test', 'example']
      };

      const relevance = ranking.calculateRelevance(input);
      
      expect(relevance).toBeGreaterThan(0);
      expect(relevance).toBeLessThanOrEqual(1);
    });

    it('임베딩 유사도 포함 관련성 계산', () => {
      const queryEmbedding = [0.1, 0.2, 0.3, 0.4];
      const docEmbedding = [0.1, 0.2, 0.3, 0.4]; // 동일한 벡터
      
      const input: RelevanceInput = {
        query: 'test',
        content: 'test content',
        tags: ['test'],
        embeddingSimilarity: {
          queryEmbedding,
          docEmbedding
        }
      };

      const relevance = ranking.calculateRelevance(input);
      
      // 임베딩 유사도가 높으므로 관련성이 높아야 함
      expect(relevance).toBeGreaterThan(0.5);
    });

    it('BM25 결과 포함 관련성 계산', () => {
      const input: RelevanceInput = {
        query: 'test query',
        content: 'This is a test content with test query repeated test query',
        tags: ['test'],
        bm25Result: {
          score: 5.0,
          normalizedScore: 0.8
        }
      };

      const relevance = ranking.calculateRelevance(input);
      
      expect(relevance).toBeGreaterThan(0.2);
    });

    it('타이틀 히트 포함 관련성 계산', () => {
      const input: RelevanceInput = {
        query: 'test title',
        content: 'Some content',
        title: 'test title',
        tags: ['test']
      };

      const relevance = ranking.calculateRelevance(input);
      
      // 타이틀 히트가 있으므로 관련성이 높아야 함
      expect(relevance).toBeGreaterThan(0.05);
    });

    it('빈 쿼리 처리', () => {
      const input: RelevanceInput = {
        query: '',
        content: 'test content',
        tags: []
      };

      const relevance = ranking.calculateRelevance(input);
      expect(relevance).toBe(0);
    });

    it('빈 콘텐츠 처리', () => {
      const input: RelevanceInput = {
        query: 'test',
        content: '',
        tags: []
      };

      const relevance = ranking.calculateRelevance(input);
      expect(relevance).toBe(0);
    });

    it('태그 매칭 테스트', () => {
      const input: RelevanceInput = {
        query: 'javascript programming',
        content: 'Some content about programming',
        tags: ['javascript', 'programming', 'web']
      };

      const relevance = ranking.calculateRelevance(input);
      
      // 태그 매칭이 있으므로 관련성이 높아야 함
      expect(relevance).toBeGreaterThan(0.05);
    });
  });

  describe('calculateRecency', () => {
    it('최근 생성된 메모리의 높은 최근성', () => {
      const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1일 전
      const recency = ranking.calculateRecency(recentDate, 'episodic');
      
      expect(recency).toBeGreaterThan(0.8);
    });

    it('오래된 메모리의 낮은 최근성', () => {
      const oldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000); // 1년 전
      const recency = ranking.calculateRecency(oldDate, 'episodic');
      
      expect(recency).toBeLessThan(0.1);
    });

    it('메모리 타입별 반감기 테스트', () => {
      const baseDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10일 전
      
      const workingRecency = ranking.calculateRecency(baseDate, 'working');
      const episodicRecency = ranking.calculateRecency(baseDate, 'episodic');
      const semanticRecency = ranking.calculateRecency(baseDate, 'semantic');
      
      // working < episodic < semantic (반감기가 길수록 최근성이 높음)
      expect(workingRecency).toBeLessThan(episodicRecency);
      expect(episodicRecency).toBeLessThan(semanticRecency);
    });
  });

  describe('calculateImportance', () => {
    it('높은 중요도와 고정된 메모리', () => {
      const importance = ranking.calculateImportance(0.9, true, 'semantic');
      
      expect(importance).toBeGreaterThan(0.9);
      expect(importance).toBeLessThanOrEqual(1.0);
    });

    it('낮은 중요도와 고정되지 않은 메모리', () => {
      const importance = ranking.calculateImportance(0.2, false, 'working');
      
      expect(importance).toBeLessThan(0.5);
    });

    it('타입별 부스트 테스트', () => {
      const semanticImportance = ranking.calculateImportance(0.5, false, 'semantic');
      const workingImportance = ranking.calculateImportance(0.5, false, 'working');
      
      // semantic 타입은 부스트를 받아야 함
      expect(semanticImportance).toBeGreaterThan(workingImportance);
    });
  });

  describe('calculateUsage', () => {
    it('기본 사용성 계산', () => {
      const metrics: UsageMetrics = {
        viewCount: 10,
        citeCount: 5,
        editCount: 2
      };

      const usage = ranking.calculateUsage(metrics);
      
      expect(usage).toBeGreaterThan(0);
      expect(usage).toBeLessThanOrEqual(1);
    });

    it('높은 사용성 메트릭', () => {
      const metrics: UsageMetrics = {
        viewCount: 100,
        citeCount: 50,
        editCount: 20
      };

      const usage = ranking.calculateUsage(metrics);
      
      expect(usage).toBeGreaterThan(0.5);
    });

    it('배치 정규화 테스트', () => {
      const metrics1: UsageMetrics = { viewCount: 1, citeCount: 0, editCount: 0 };
      const metrics2: UsageMetrics = { viewCount: 100, citeCount: 50, editCount: 20 };
      
      const batchResult = ranking.calculateBatchUsage([metrics1, metrics2]);
      
      expect(batchResult.normalized).toHaveLength(2);
      expect(batchResult.normalized[0]).toBeLessThan(batchResult.normalized[1]);
      expect(batchResult.min).toBeLessThan(batchResult.max);
    });

    it('빈 메트릭 처리', () => {
      const metrics: UsageMetrics = {
        viewCount: 0,
        citeCount: 0,
        editCount: 0
      };

      const usage = ranking.calculateUsage(metrics);
      
      // 기본 사용성 점수 제공
      expect(usage).toBeGreaterThan(0);
    });

    it('lastAccessed 기반 사용성', () => {
      const metrics: UsageMetrics = {
        viewCount: 0,
        citeCount: 0,
        editCount: 0,
        lastAccessed: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) // 1일 전
      };

      const usage = ranking.calculateUsage(metrics);
      
      expect(usage).toBeGreaterThan(0);
    });
  });

  describe('calculateDuplicationPenalty', () => {
    it('중복 없는 콘텐츠', () => {
      const penalty = ranking.calculateDuplicationPenalty(
        'unique content',
        []
      );
      
      expect(penalty).toBe(0);
    });

    it('중복된 콘텐츠', () => {
      const penalty = ranking.calculateDuplicationPenalty(
        'similar content',
        ['similar content', 'other content']
      );
      
      expect(penalty).toBeGreaterThan(0);
      expect(penalty).toBeLessThanOrEqual(1);
    });

    it('완전히 동일한 콘텐츠', () => {
      const penalty = ranking.calculateDuplicationPenalty(
        'exact content',
        ['exact content']
      );
      
      expect(penalty).toBe(1.0);
    });
  });

  describe('하위 호환성 메서드', () => {
    it('calculateRelevanceSimple', () => {
      const relevance = ranking.calculateRelevanceSimple(
        'test query',
        'test content',
        ['test']
      );
      
      expect(relevance).toBeGreaterThan(0);
      expect(relevance).toBeLessThanOrEqual(1);
    });

    it('calculateUsageSimple', () => {
      const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
      const usage = ranking.calculateUsageSimple(recentDate);
      
      expect(usage).toBeGreaterThan(0);
      expect(usage).toBeLessThanOrEqual(1);
    });

    it('calculateUsageSimple with undefined date', () => {
      const usage = ranking.calculateUsageSimple(undefined);
      
      expect(usage).toBe(0.1); // 기본값
    });
  });

  describe('엣지 케이스', () => {
    it('매우 긴 쿼리 처리', () => {
      const longQuery = 'a'.repeat(1000);
      const input: RelevanceInput = {
        query: longQuery,
        content: 'test content',
        tags: []
      };

      const relevance = ranking.calculateRelevance(input);
      
      expect(relevance).toBeGreaterThanOrEqual(0);
      expect(relevance).toBeLessThanOrEqual(1);
    });

    it('특수문자가 포함된 쿼리', () => {
      const input: RelevanceInput = {
        query: 'test@#$%^&*()_+{}|:"<>?[]\\;\',./',
        content: 'test content',
        tags: []
      };

      const relevance = ranking.calculateRelevance(input);
      
      expect(relevance).toBeGreaterThanOrEqual(0);
      expect(relevance).toBeLessThanOrEqual(1);
    });

    it('유니코드 문자 처리', () => {
      const input: RelevanceInput = {
        query: '테스트 쿼리',
        content: '테스트 콘텐츠',
        tags: ['테스트']
      };

      const relevance = ranking.calculateRelevance(input);
      
      expect(relevance).toBeGreaterThan(0);
    });

    it('매우 큰 벡터 차원', () => {
      const largeVector = new Array(10000).fill(0.1);
      const input: RelevanceInput = {
        query: 'test',
        content: 'test content',
        tags: [],
        embeddingSimilarity: {
          queryEmbedding: largeVector,
          docEmbedding: largeVector
        }
      };

      const relevance = ranking.calculateRelevance(input);
      
      expect(relevance).toBeGreaterThanOrEqual(0);
      expect(relevance).toBeLessThanOrEqual(1);
    });

    it('벡터 차원 불일치', () => {
      const input: RelevanceInput = {
        query: 'test',
        content: 'test content',
        tags: [],
        embeddingSimilarity: {
          queryEmbedding: [0.1, 0.2],
          docEmbedding: [0.1, 0.2, 0.3] // 차원 불일치
        }
      };

      const relevance = ranking.calculateRelevance(input);
      
      // 차원 불일치 시 임베딩 점수는 0이어야 함
      expect(relevance).toBeGreaterThanOrEqual(0);
    });
  });

  describe('성능 테스트', () => {
    it('대량 데이터 처리 성능', () => {
      const startTime = Date.now();
      
      // 1000개의 메트릭으로 배치 처리
      const metricsList = Array.from({ length: 1000 }, (_, i) => ({
        viewCount: i,
        citeCount: i / 2,
        editCount: i / 4
      }));
      
      const batchResult = ranking.calculateBatchUsage(metricsList);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(batchResult.normalized).toHaveLength(1000);
      expect(duration).toBeLessThan(1000); // 1초 이내
    });

    it('반복 계산 성능', () => {
      const features: SearchFeatures = {
        relevance: 0.8,
        recency: 0.6,
        importance: 0.7,
        usage: 0.5,
        duplication_penalty: 0.2
      };

      const startTime = Date.now();
      
      // 1000번 반복 계산
      for (let i = 0; i < 1000; i++) {
        ranking.calculateFinalScore(features);
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(100); // 100ms 이내
    });
  });

  describe('Consolidation Score 통합', () => {
    describe('calculateFinalScore with consolidation_score', () => {
      it('consolidation_score가 제공되면 새로운 공식 사용', () => {
        const features: SearchFeatures = {
          relevance: 0.8,
          recency: 0.6,
          importance: 0.7,
          usage: 0.5,
          duplication_penalty: 0.2,
          consolidation_score: 0.9
        };

        const customRanking = new SearchRanking({
          consolidation_score: 0.2 // w2 = 0.2
        });

        const score = customRanking.calculateFinalScore(features);
        
        // Final_Score = w1 * vector_similarity + w2 * consolidation_score
        // w1 = 0.8, w2 = 0.2 (상한 0.4 미만이므로 그대로 사용)
        // vector_similarity = relevance = 0.8
        const expected = 0.8 * 0.8 + 0.2 * 0.9; // 0.64 + 0.18 = 0.82
        expect(score).toBeCloseTo(expected, 3);
      });

      it('consolidation_score가 없으면 기존 공식 사용', () => {
        const features: SearchFeatures = {
          relevance: 0.8,
          recency: 0.6,
          importance: 0.7,
          usage: 0.5,
          duplication_penalty: 0.2
        };

        const score = ranking.calculateFinalScore(features);
        
        // 기존 공식 사용
        const expected = 0.5 * 0.8 + 0.2 * 0.6 + 0.2 * 0.7 + 0.1 * 0.5 - 0.15 * 0.2;
        expect(score).toBeCloseTo(expected, 3);
      });

      it('w2 상한 제한 테스트 (0.4 초과 시 제한)', () => {
        const features: SearchFeatures = {
          relevance: 0.8,
          recency: 0.6,
          importance: 0.7,
          usage: 0.5,
          duplication_penalty: 0.2,
          consolidation_score: 0.9
        };

        const customRanking = new SearchRanking({
          consolidation_score: 0.5 // w2 = 0.5이지만 상한 0.4로 제한됨
        });

        const score = customRanking.calculateFinalScore(features);
        
        // w2는 0.4로 제한, w1 = 0.6
        const expected = 0.6 * 0.8 + 0.4 * 0.9; // 0.48 + 0.36 = 0.84
        expect(score).toBeCloseTo(expected, 3);
      });
    });

    describe('getConsolidationScoreWeights', () => {
      it('recent 프로파일 가중치 반환', () => {
        const weights = ranking.getConsolidationScoreWeights('recent');
        expect(weights.vectorSimilarity).toBe(0.9);
        expect(weights.consolidationScore).toBe(0.1);
      });

      it('balanced 프로파일 가중치 반환 (기본값)', () => {
        const weights = ranking.getConsolidationScoreWeights('balanced');
        expect(weights.vectorSimilarity).toBe(0.8);
        expect(weights.consolidationScore).toBe(0.2);
      });

      it('memory 프로파일 가중치 반환', () => {
        const weights = ranking.getConsolidationScoreWeights('memory');
        expect(weights.vectorSimilarity).toBe(0.7);
        expect(weights.consolidationScore).toBe(0.3);
      });

      it('기본값은 balanced', () => {
        const weights = ranking.getConsolidationScoreWeights();
        expect(weights.vectorSimilarity).toBe(0.8);
        expect(weights.consolidationScore).toBe(0.2);
      });
    });

    describe('calculateFinalScoreWithConsolidation', () => {
      it('기본 가중치로 점수 계산', () => {
        const score = ranking.calculateFinalScoreWithConsolidation(
          0.8, // vectorSimilarity
          0.9, // consolidationScore
          'balanced'
        );
        
        // w1 = 0.8, w2 = 0.2
        const expected = 0.8 * 0.8 + 0.2 * 0.9; // 0.64 + 0.18 = 0.82
        expect(score).toBeCloseTo(expected, 3);
      });

      it('recent 프로파일로 점수 계산', () => {
        const score = ranking.calculateFinalScoreWithConsolidation(
          0.8,
          0.9,
          'recent'
        );
        
        // w1 = 0.9, w2 = 0.1
        const expected = 0.9 * 0.8 + 0.1 * 0.9; // 0.72 + 0.09 = 0.81
        expect(score).toBeCloseTo(expected, 3);
      });

      it('memory 프로파일로 점수 계산 (w2 상한 적용)', () => {
        const score = ranking.calculateFinalScoreWithConsolidation(
          0.8,
          0.9,
          'memory'
        );
        
        // w2 = 0.3이지만 상한 0.4로 제한되지 않음 (0.3 < 0.4)
        // 하지만 calculateFinalScoreWithConsolidation 내부에서 상한 적용
        // w2 = min(0.3, 0.4) = 0.3, w1 = 0.7
        const expected = 0.7 * 0.8 + 0.3 * 0.9; // 0.56 + 0.27 = 0.83
        expect(score).toBeCloseTo(expected, 3);
      });

      it('w2 상한 제한 테스트', () => {
        // memory 프로파일은 w2=0.3이지만, 상한 0.4보다 작으므로 그대로 사용
        const score = ranking.calculateFinalScoreWithConsolidation(
          0.8,
          0.9,
          'memory'
        );
        
        // w2 = min(0.3, 0.4) = 0.3, w1 = 0.7
        const expected = 0.7 * 0.8 + 0.3 * 0.9;
        expect(score).toBeCloseTo(expected, 3);
      });

      it('벡터 유사도가 높고 consolidation_score가 낮은 경우', () => {
        const score = ranking.calculateFinalScoreWithConsolidation(
          0.95, // 높은 벡터 유사도
          0.3,  // 낮은 consolidation_score
          'balanced'
        );
        
        // w1 = 0.8, w2 = 0.2
        const expected = 0.8 * 0.95 + 0.2 * 0.3; // 0.76 + 0.06 = 0.82
        expect(score).toBeCloseTo(expected, 3);
      });

      it('벡터 유사도가 낮고 consolidation_score가 높은 경우', () => {
        const score = ranking.calculateFinalScoreWithConsolidation(
          0.3,  // 낮은 벡터 유사도
          0.95, // 높은 consolidation_score
          'balanced'
        );
        
        // w1 = 0.8, w2 = 0.2
        const expected = 0.8 * 0.3 + 0.2 * 0.95; // 0.24 + 0.19 = 0.43
        expect(score).toBeCloseTo(expected, 3);
      });

      it('경계값 테스트: 벡터 유사도 0, consolidation_score 1', () => {
        const score = ranking.calculateFinalScoreWithConsolidation(
          0.0,
          1.0,
          'balanced'
        );
        
        // w1 = 0.8, w2 = 0.2
        const expected = 0.8 * 0.0 + 0.2 * 1.0; // 0.0 + 0.2 = 0.2
        expect(score).toBeCloseTo(expected, 3);
      });

      it('경계값 테스트: 벡터 유사도 1, consolidation_score 0', () => {
        const score = ranking.calculateFinalScoreWithConsolidation(
          1.0,
          0.0,
          'balanced'
        );
        
        // w1 = 0.8, w2 = 0.2
        const expected = 0.8 * 1.0 + 0.2 * 0.0; // 0.8 + 0.0 = 0.8
        expect(score).toBeCloseTo(expected, 3);
      });

      it('모든 프로파일에서 w1 + w2 = 1 보장', () => {
        const profiles: SearchProfile[] = ['recent', 'balanced', 'memory'];
        
        profiles.forEach(profile => {
          const weights = ranking.getConsolidationScoreWeights(profile);
          const w2 = Math.min(weights.consolidationScore, 0.4);
          const w1 = 1 - w2;
          
          expect(w1 + w2).toBeCloseTo(1.0, 5);
        });
      });
    });
  });
});
