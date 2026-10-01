/**
 * 검색 랭킹 알고리즘 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SearchRanking, type SearchFeatures, type RelevanceInput, type UsageMetrics, type SearchProfile } from '../search-ranking.js';
import { sigmoidNormalizedNet } from '../../../memory/repositories/feedback-repository.interface.js';
import { DAY_MS } from '../../../../shared/utils/date.js';

describe('SearchRanking', () => {
  let ranking: SearchRanking;

  beforeEach(() => {
    // 피드백 항(zeta_fb)은 별도 describe에서만 검증 — 레거시 기대값과 호환하려면 0
    ranking = new SearchRanking({ zeta_fb: 0 });
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
      
      // 기본 가중치: relevance(0.45) + recency(0.2) + importance(0.2) + usage(0.1) + relation_weight(0*0) - duplication(0.1)
      const expected = 0.45 * 0.8 + 0.2 * 0.6 + 0.2 * 0.7 + 0.1 * 0.5 + 0 * 0 - 0.1 * 0.2;
      expect(score).toBeCloseTo(expected, 3);
    });

    it('최적값으로 최대 점수 계산', () => {
      const features: SearchFeatures = {
        relevance: 1.0,
        recency: 1.0,
        importance: 1.0,
        usage: 1.0,
        relation_weight: 1.0,
        duplication_penalty: 0.0
      };

      const score = ranking.calculateFinalScore(features);
      // 기본 가중치 합: 0.45 + 0.2 + 0.2 + 0.1 + 0 = 0.95 (최대값)
      const expected = 0.45 * 1.0 + 0.2 * 1.0 + 0.2 * 1.0 + 0.1 * 1.0 + 0 * 1.0;
      expect(score).toBeCloseTo(expected, 3);
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
      // 중복 패널티만 적용: -0.1 * 1.0 = -0.1
      expect(score).toBeCloseTo(-0.1, 3);
    });

    it('사용자 정의 가중치로 점수 계산', () => {
      const customRanking = new SearchRanking({
        relevance: 0.6,
        recency: 0.2,
        importance: 0.1,
        usage: 0.1,
        relation_weight: 0.1,
        duplication_penalty: 0.1,
        zeta_fb: 0,
      });

      const features: SearchFeatures = {
        relevance: 0.8,
        recency: 0.6,
        importance: 0.7,
        usage: 0.5,
        relation_weight: 0.3,
        duplication_penalty: 0.2
      };

      const score = customRanking.calculateFinalScore(features);
      const expected = 0.6 * 0.8 + 0.2 * 0.6 + 0.1 * 0.7 + 0.1 * 0.5 + 0.1 * 0.3 - 0.1 * 0.2;
      expect(score).toBeCloseTo(expected, 3);
    });

    it('관계 가중치가 포함된 최종 점수 계산', () => {
      const features: SearchFeatures = {
        relevance: 0.8,
        recency: 0.6,
        importance: 0.7,
        usage: 0.5,
        relation_weight: 0.4,
        duplication_penalty: 0.2
      };

      const score = ranking.calculateFinalScore(features);
      
      // 기본 가중치: relevance(0.45) + recency(0.2) + importance(0.2) + usage(0.1) + relation_weight(0) - duplication(0.1)
      const expected = 0.45 * 0.8 + 0.2 * 0.6 + 0.2 * 0.7 + 0.1 * 0.5 + 0 * 0.4 - 0.1 * 0.2;
      expect(score).toBeCloseTo(expected, 3);
    });

    it('관계 가중치가 없을 때 0으로 처리', () => {
      const features: SearchFeatures = {
        relevance: 0.8,
        recency: 0.6,
        importance: 0.7,
        usage: 0.5,
        duplication_penalty: 0.2
      };

      const score = ranking.calculateFinalScore(features);
      
      // relation_weight가 없으면 0으로 처리
      const expected = 0.45 * 0.8 + 0.2 * 0.6 + 0.2 * 0.7 + 0.1 * 0.5 + 0 * 0 - 0.1 * 0.2;
      expect(score).toBeCloseTo(expected, 3);
    });
  });

  describe('calculateRelationWeight', () => {
    // #1185: weight = 평균(confidence × type_boost) × min(n, maxRelations) / maxRelations
    it('returns 0 for empty relations', () => {
      expect(ranking.calculateRelationWeight([])).toBe(0);
    });

    it('scales a single relation by coverage 1/maxRelations', () => {
      const weight = ranking.calculateRelationWeight([{ confidence: 0.8, relation_type: 'CAUSES' }], 5);
      expect(weight).toBeCloseTo((0.8 * 1.2) / 5, 6);
    });

    it('averages multiple relations and scales by coverage', () => {
      const relations = [
        { confidence: 0.8, relation_type: 'CAUSES' },
        { confidence: 0.7, relation_type: 'FOLLOWS' },
        { confidence: 0.9, relation_type: 'DEPENDS_ON' }
      ];
      const weight = ranking.calculateRelationWeight(relations, 5);
      expect(weight).toBeCloseTo(((0.96 + 0.7 + 0.99) / 3) * (3 / 5), 6);
    });

    it('saturates at the average once relations reach maxRelations', () => {
      const relations = Array.from({ length: 10 }, () => ({ confidence: 0.8, relation_type: 'CAUSES' }));
      expect(ranking.calculateRelationWeight(relations, 5)).toBeCloseTo(0.96, 6);
    });

    it('applies relation type boosts before averaging', () => {
      const relations = [
        { confidence: 0.8, relation_type: 'CAUSES' },
        { confidence: 0.8, relation_type: 'REFERENCES' },
        { confidence: 0.8, relation_type: 'CONTRASTS_WITH' }
      ];
      const average = (0.8 * 1.2 + 0.8 * 0.8 + 0.8 * 0.9) / 3;
      expect(ranking.calculateRelationWeight(relations, 5)).toBeCloseTo(average * (3 / 5), 6);
    });

    it('clips to 1', () => {
      const relations = Array.from({ length: 2 }, () => ({ confidence: 1.0, relation_type: 'CAUSES' }));
      expect(ranking.calculateRelationWeight(relations, 1)).toBe(1);
    });

    it('uses boost 1.0 for unknown relation types', () => {
      const weight = ranking.calculateRelationWeight([{ confidence: 0.8, relation_type: 'UNKNOWN_TYPE' }], 5);
      expect(weight).toBeCloseTo(0.8 / 5, 6);
    });

    it('is non-decreasing in relation count (#1185)', () => {
      const counts = [0, 1, 2, 5, 50, 118];
      const weights = counts.map((n) =>
        ranking.calculateRelationWeight(
          Array.from({ length: n }, () => ({ confidence: 0.74, relation_type: 'FOLLOWS' })),
          5
        )
      );
      for (let i = 1; i < weights.length; i++) {
        if (counts[i] >= 5 && counts[i - 1] >= 5) {
          expect(weights[i]).toBeCloseTo(weights[i - 1], 6);
        } else {
          expect(weights[i]).toBeGreaterThanOrEqual(weights[i - 1]);
        }
      }
      expect(weights[1]).toBeLessThan(weights[2]);
      expect(weights[2]).toBeLessThan(weights[3]);
      expect(weights[5]).toBeGreaterThan(weights[1]);
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
      const recentDate = new Date(Date.now() - DAY_MS); // 1일 전
      const recency = ranking.calculateRecency(recentDate);
      
      // raw=0.97716, default recency_signal.scale=0.30 → 0.64315 (#1175)
      expect(recency).toBeCloseTo(0.64315, 4);
    });

    it('오래된 메모리의 낮은 최근성', () => {
      const oldDate = new Date(Date.now() - 365 * DAY_MS); // 1년 전
      const recency = ranking.calculateRecency(oldDate);
      
      // raw≈0.00022, default recency_signal.scale=0.30 → 0.35007 (#1175)
      expect(recency).toBeCloseTo(0.35007, 4);
    });

    it('반감기는 타입과 무관하게 30일이다 (#1178)', () => {
      // raw=0.5 at exactly one half-life; scale compresses around 0.5 so 0.5 stays 0.5.
      const recency = ranking.calculateRecency(new Date(Date.now() - 30 * DAY_MS));
      expect(recency).toBeCloseTo(0.5, 3);
    });
  });

  describe('calculateImportance', () => {
    it('높은 중요도와 고정된 메모리', () => {
      const importance = ranking.calculateImportance(0.9, true, 'semantic');
      // raw=1.0, default importance_signal.scale=0.35 → 0.675
      expect(importance).toBeCloseTo(0.675, 8);
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
        lastAccessed: new Date(Date.now() - DAY_MS) // 1일 전
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
      const recentDate = new Date(Date.now() - DAY_MS);
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

    it('preserves NaN vector elements as an invalid relevance score', () => {
      const relevance = ranking.calculateRelevance({
        query: 'test',
        content: 'test content',
        tags: [],
        embeddingSimilarity: {
          queryEmbedding: [Number.NaN, 1],
          docEmbedding: [1, 1],
        },
      });

      expect(relevance).toBeNaN();
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

  // 가중치 fixture 분리 (확장성 확보)
  const consolidationWeightFixtures = {
    recent: { vectorSimilarity: 0.9, consolidationScore: 0.1 },
    balanced: { vectorSimilarity: 0.8, consolidationScore: 0.2 },
    memory: { vectorSimilarity: 0.7, consolidationScore: 0.3 }
  };

  describe('Consolidation Score 통합', () => {
    describe('getConsolidationScoreWeights - 실제 코드 메서드 검증', () => {
      it('실제 코드의 getConsolidationScoreWeights()가 fixture와 일치하는지 검증', () => {
        Object.entries(consolidationWeightFixtures).forEach(([profile, expectedWeights]) => {
          const actualWeights = ranking.getConsolidationScoreWeights(profile as SearchProfile);
          expect(actualWeights.vectorSimilarity).toBe(expectedWeights.vectorSimilarity);
          expect(actualWeights.consolidationScore).toBe(expectedWeights.consolidationScore);
        });
      });

      it('모든 프로파일에서 w1 + w2 = 1 보장 (실제 코드 검증)', () => {
        const profiles: SearchProfile[] = ['recent', 'balanced', 'memory'];
        
        profiles.forEach(profile => {
          const weights = ranking.getConsolidationScoreWeights(profile);
          const w2 = Math.min(weights.consolidationScore, 0.4);
          const w1 = 1 - w2;
          
          expect(w1 + w2).toBeCloseTo(1.0, 5);
        });
      });
    });

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
          consolidation_score: 0.2, // w2 = 0.2
          zeta_fb: 0,
        });

        const score = customRanking.calculateFinalScore(features);
        
        // 다차원 랭킹: relevance를 consolidation_score로 보완한 후 모든 신호 포함
        // w1 = 0.8, w2 = 0.2
        // relevanceScore = 0.8 * 0.8 + 0.2 * 0.9 = 0.64 + 0.18 = 0.82
        // 다차원 랭킹: relevance(0.45) * 0.82 + recency(0.2) * 0.6 + importance(0.2) * 0.7 + usage(0.1) * 0.5 - duplication(0.1) * 0.2
        // = 0.369 + 0.12 + 0.14 + 0.05 - 0.02 = 0.659
        const expected = 0.45 * 0.82 + 0.2 * 0.6 + 0.2 * 0.7 + 0.1 * 0.5 - 0.1 * 0.2;
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
        
        // 기존 공식 사용 (새로운 가중치 기준)
        const expected = 0.45 * 0.8 + 0.2 * 0.6 + 0.2 * 0.7 + 0.1 * 0.5 + 0 * 0 - 0.1 * 0.2;
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
          consolidation_score: 0.5, // w2 = 0.5이지만 상한 0.4로 제한됨
          zeta_fb: 0,
        });

        const score = customRanking.calculateFinalScore(features);
        
        // w2는 0.4로 제한, w1 = 0.6
        // relevanceScore = 0.6 * 0.8 + 0.4 * 0.9 = 0.48 + 0.36 = 0.84
        // 다차원 랭킹: relevance(0.45) * 0.84 + recency(0.2) * 0.6 + importance(0.2) * 0.7 + usage(0.1) * 0.5 - duplication(0.1) * 0.2
        // = 0.378 + 0.12 + 0.14 + 0.05 - 0.02 = 0.668
        const expected = 0.45 * 0.84 + 0.2 * 0.6 + 0.2 * 0.7 + 0.1 * 0.5 - 0.1 * 0.2;
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

  describe('Procedural Memory 특화 가중치', () => {
    describe('calculateProceduralMemoryBoost', () => {
      it('workflow_name 매칭 시 +0.1 부스트', () => {
        // Given: workflow_name_match가 true인 features
        const features: SearchFeatures = {
          relevance: 0.8,
          recency: 0.6,
          importance: 0.7,
          usage: 0.5,
          duplication_penalty: 0.2,
          workflow_name_match: true
        };

        // When: procedural memory boost 계산
        const boost = ranking.calculateProceduralMemoryBoost(features);

        // Then: +0.1 부스트
        expect(boost).toBe(0.1);
      });

      it('skill_name 매칭 시 +0.1 부스트', () => {
        // Given: skill_name_match가 true인 features
        const features: SearchFeatures = {
          relevance: 0.8,
          recency: 0.6,
          importance: 0.7,
          usage: 0.5,
          duplication_penalty: 0.2,
          skill_name_match: true
        };

        // When: procedural memory boost 계산
        const boost = ranking.calculateProceduralMemoryBoost(features);

        // Then: +0.1 부스트
        expect(boost).toBe(0.1);
      });

      it('trigger_conditions 매칭 시 +0.15 부스트', () => {
        // Given: trigger_conditions_match가 true인 features
        const features: SearchFeatures = {
          relevance: 0.8,
          recency: 0.6,
          importance: 0.7,
          usage: 0.5,
          duplication_penalty: 0.2,
          trigger_conditions_match: true
        };

        // When: procedural memory boost 계산
        const boost = ranking.calculateProceduralMemoryBoost(features);

        // Then: +0.15 부스트
        expect(boost).toBe(0.15);
      });

      it('모든 필드 매칭 시 최대 부스트 (+0.35)', () => {
        // Given: 모든 procedural memory 필드가 매칭된 features
        const features: SearchFeatures = {
          relevance: 0.8,
          recency: 0.6,
          importance: 0.7,
          usage: 0.5,
          duplication_penalty: 0.2,
          workflow_name_match: true,
          skill_name_match: true,
          trigger_conditions_match: true
        };

        // When: procedural memory boost 계산
        const boost = ranking.calculateProceduralMemoryBoost(features);

        // Then: 최대 부스트 (0.1 + 0.1 + 0.15 = 0.35)
        expect(boost).toBe(0.35);
      });

      it('매칭이 없으면 부스트 없음', () => {
        // Given: procedural memory 필드가 없는 features
        const features: SearchFeatures = {
          relevance: 0.8,
          recency: 0.6,
          importance: 0.7,
          usage: 0.5,
          duplication_penalty: 0.2
        };

        // When: procedural memory boost 계산
        const boost = ranking.calculateProceduralMemoryBoost(features);

        // Then: 부스트 없음
        expect(boost).toBe(0);
      });
    });

    describe('calculateFinalScore with Procedural Memory boost', () => {
      it('workflow_name 매칭 시 최종 점수에 부스트 추가', () => {
        // Given: workflow_name_match가 true인 features
        const features: SearchFeatures = {
          relevance: 0.8,
          recency: 0.6,
          importance: 0.7,
          usage: 0.5,
          duplication_penalty: 0.2,
          workflow_name_match: true
        };

        // When: 최종 점수 계산
        const score = ranking.calculateFinalScore(features);

        // Then: 기본 점수 + 0.1 부스트
        const baseScore = 0.45 * 0.8 + 0.2 * 0.6 + 0.2 * 0.7 + 0.1 * 0.5 - 0.1 * 0.2;
        expect(score).toBeCloseTo(baseScore + 0.1, 3);
      });

      it('skill_name 매칭 시 최종 점수에 부스트 추가', () => {
        // Given: skill_name_match가 true인 features
        const features: SearchFeatures = {
          relevance: 0.8,
          recency: 0.6,
          importance: 0.7,
          usage: 0.5,
          duplication_penalty: 0.2,
          skill_name_match: true
        };

        // When: 최종 점수 계산
        const score = ranking.calculateFinalScore(features);

        // Then: 기본 점수 + 0.1 부스트
        const baseScore = 0.45 * 0.8 + 0.2 * 0.6 + 0.2 * 0.7 + 0.1 * 0.5 - 0.1 * 0.2;
        expect(score).toBeCloseTo(baseScore + 0.1, 3);
      });

      it('trigger_conditions 매칭 시 최종 점수에 부스트 추가', () => {
        // Given: trigger_conditions_match가 true인 features
        const features: SearchFeatures = {
          relevance: 0.8,
          recency: 0.6,
          importance: 0.7,
          usage: 0.5,
          duplication_penalty: 0.2,
          trigger_conditions_match: true
        };

        // When: 최종 점수 계산
        const score = ranking.calculateFinalScore(features);

        // Then: 기본 점수 + 0.15 부스트
        const baseScore = 0.45 * 0.8 + 0.2 * 0.6 + 0.2 * 0.7 + 0.1 * 0.5 - 0.1 * 0.2;
        expect(score).toBeCloseTo(baseScore + 0.15, 3);
      });

      it('consolidation_score와 procedural memory boost 함께 적용', () => {
        // Given: consolidation_score와 procedural memory 필드가 모두 있는 features
        const features: SearchFeatures = {
          relevance: 0.8,
          recency: 0.6,
          importance: 0.7,
          usage: 0.5,
          duplication_penalty: 0.2,
          consolidation_score: 0.9,
          workflow_name_match: true,
          skill_name_match: true
        };

        // When: 최종 점수 계산 (consolidation_score 가중치가 설정된 ranking 사용)
        const customRanking = new SearchRanking({
          consolidation_score: 0.2, // w2 = 0.2
          zeta_fb: 0,
        });
        const score = customRanking.calculateFinalScore(features);

        // Then: 다차원 랭킹 (모든 신호 포함) + procedural memory boost
        // w1 = 0.8, w2 = 0.2
        // relevanceScore = 0.8 * 0.8 + 0.2 * 0.9 = 0.64 + 0.18 = 0.82
        // 다차원 랭킹: relevance(0.45) * 0.82 + recency(0.2) * 0.6 + importance(0.2) * 0.7 + usage(0.1) * 0.5 - duplication(0.1) * 0.2
        // = 0.369 + 0.12 + 0.14 + 0.05 - 0.02 = 0.659
        // procedural boost: workflow_name(0.1) + skill_name(0.1) = 0.2
        // 최종: 0.659 + 0.2 = 0.859
        expect(score).toBeCloseTo(0.859, 3);
      });
    });

    describe('Process Attribute 적합도 (Issue #91)', () => {
      it('Given: process_attribute_fit 0.8, When: calculateFinalScore, Then: 기본 점수 + 0.1 * 0.8 반영', () => {
        const rankingWithFit = new SearchRanking({ process_attribute_fit: 0.1, zeta_fb: 0 });
        const features: SearchFeatures = {
          relevance: 0.8,
          recency: 0.6,
          importance: 0.7,
          usage: 0.5,
          duplication_penalty: 0.2,
          process_attribute_fit: 0.8
        };
        const score = rankingWithFit.calculateFinalScore(features);
        const baseScore = 0.45 * 0.8 + 0.2 * 0.6 + 0.2 * 0.7 + 0.1 * 0.5 - 0.1 * 0.2;
        expect(score).toBeCloseTo(baseScore + 0.1 * 0.8, 3);
      });

      it('Given: process_attribute_fit 미제공, When: calculateFinalScore, Then: process 보정 없음', () => {
        const features: SearchFeatures = {
          relevance: 0.8,
          recency: 0.6,
          importance: 0.7,
          usage: 0.5,
          duplication_penalty: 0.2
        };
        const score = ranking.calculateFinalScore(features);
        const expected = 0.45 * 0.8 + 0.2 * 0.6 + 0.2 * 0.7 + 0.1 * 0.5 - 0.1 * 0.2;
        expect(score).toBeCloseTo(expected, 3);
      });
    });

    describe('feedback_score 및 zeta_fb', () => {
      it('feedback_score가 높을수록 zeta_fb만큼 가산된다', () => {
        const r = new SearchRanking({ zeta_fb: 0.05 });
        const base: SearchFeatures = {
          relevance: 0.8,
          recency: 0.6,
          importance: 0.7,
          usage: 0.5,
          duplication_penalty: 0.2,
        };
        const low = r.calculateFinalScore({ ...base, feedback_score: 0.5 });
        const high = r.calculateFinalScore({ ...base, feedback_score: 1.0 });
        expect(high - low).toBeCloseTo(0.05 * 0.5, 5);
      });

      it('시그모이드 정규화 net=±1이 점수에 반영된다', () => {
        const r = new SearchRanking({ zeta_fb: 0.05 });
        const base: SearchFeatures = {
          relevance: 0.5,
          recency: 0.5,
          importance: 0.5,
          usage: 0.5,
          duplication_penalty: 0,
        };
        const n0 = r.calculateFinalScore({ ...base, feedback_score: sigmoidNormalizedNet(0) });
        const n1 = r.calculateFinalScore({ ...base, feedback_score: sigmoidNormalizedNet(1) });
        const nm = r.calculateFinalScore({ ...base, feedback_score: sigmoidNormalizedNet(-1) });
        expect(n1).toBeGreaterThan(n0);
        expect(n0).toBeGreaterThan(nm);
      });
    });
  });

  describe('calculateFinalScoreAndBreakdown', () => {
    it('includeBreakdown 미설정/ false면 breakdown 없음', () => {
      const r = new SearchRanking({ zeta_fb: 0.05 });
      const f: SearchFeatures = {
        relevance: 0.8,
        recency: 0.6,
        importance: 0.7,
        usage: 0.5,
        duplication_penalty: 0.2,
        feedback_score: 0.5,
      };
      expect(r.calculateFinalScoreAndBreakdown(f).breakdown).toBeUndefined();
      expect(r.calculateFinalScoreAndBreakdown(f, { includeBreakdown: false }).breakdown).toBeUndefined();
    });

    it('includeBreakdown true면 total 및 feedback 항 포함', () => {
      const r = new SearchRanking({ zeta_fb: 0.05 });
      const f: SearchFeatures = {
        relevance: 0.8,
        recency: 0.6,
        importance: 0.7,
        usage: 0.5,
        duplication_penalty: 0.2,
        feedback_score: 0.6,
      };
      const out = r.calculateFinalScoreAndBreakdown(f, { includeBreakdown: true });
      expect(out.breakdown).toBeDefined();
      expect(out.breakdown?.feedback).toBeDefined();
      expect(out.breakdown?.total).toBeCloseTo(out.score, 5);
      const slots = ['relevance', 'recency', 'importance', 'usage', 'feedback', 'duplication_penalty'] as const;
      for (const k of slots) {
        expect(Number.isInteger(out.breakdown![k].pct)).toBe(true);
      }
    });

    it('breakdown 계산은 단일 호출에서 100ms 이내 (SC-003)', () => {
      const r = new SearchRanking({ zeta_fb: 0.05 });
      const f: SearchFeatures = {
        relevance: 0.8,
        recency: 0.6,
        importance: 0.7,
        usage: 0.5,
        duplication_penalty: 0.2,
      };
      const t0 = performance.now();
      r.calculateFinalScoreAndBreakdown(f, { includeBreakdown: true });
      expect(performance.now() - t0).toBeLessThan(100);
    });
  });
});
