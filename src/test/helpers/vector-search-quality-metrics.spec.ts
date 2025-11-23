/**
 * 벡터 검색 품질 검증 헬퍼 단위 테스트
 * 순서 보존 검증 기능 테스트
 */

import { describe, it, expect } from 'vitest';
import {
  calculateKendallTau,
  calculateSpearmanRho,
  calculateTopKRetention,
  generateVectorOnlySearchResults,
  generateConsolidationSearchResults,
  generateOrderPreservationReport,
  measureVectorOnlyQuality,
  measureConsolidationQuality,
  calculateQualityDegradation,
  validateQualityThresholds,
  compareQualityWithGroundTruth,
  generateQualityComparisonReport,
  visualizeQualityComparison,
  type SearchResultPair,
  type HybridSearchResult
} from './vector-search-quality-metrics.js';
import type { SearchResult } from './search-quality-metrics.js';

describe('벡터 검색 품질 검증 헬퍼', () => {
  describe('calculateKendallTau', () => {
    it('완전히 일치하는 순서는 1을 반환해야 함', () => {
      const order1 = ['id1', 'id2', 'id3', 'id4', 'id5'];
      const order2 = ['id1', 'id2', 'id3', 'id4', 'id5'];
      
      const tau = calculateKendallTau(order1, order2);
      
      expect(tau).toBeCloseTo(1.0, 3);
    });

    it('완전히 반대인 순서는 -1에 가까운 값을 반환해야 함', () => {
      const order1 = ['id1', 'id2', 'id3', 'id4', 'id5'];
      const order2 = ['id5', 'id4', 'id3', 'id2', 'id1'];
      
      const tau = calculateKendallTau(order1, order2);
      
      expect(tau).toBeLessThan(0);
      expect(tau).toBeCloseTo(-1.0, 1);
    });

    it('부분적으로 일치하는 순서는 0과 1 사이 값을 반환해야 함', () => {
      const order1 = ['id1', 'id2', 'id3', 'id4', 'id5'];
      const order2 = ['id1', 'id3', 'id2', 'id4', 'id5'];
      
      const tau = calculateKendallTau(order1, order2);
      
      expect(tau).toBeGreaterThan(0);
      expect(tau).toBeLessThan(1);
    });

    it('빈 배열은 0을 반환해야 함', () => {
      const tau1 = calculateKendallTau([], ['id1', 'id2']);
      const tau2 = calculateKendallTau(['id1', 'id2'], []);
      
      expect(tau1).toBe(0);
      expect(tau2).toBe(0);
    });

    it('공통 ID가 2개 미만이면 0을 반환해야 함', () => {
      const order1 = ['id1', 'id2'];
      const order2 = ['id3', 'id4'];
      
      const tau = calculateKendallTau(order1, order2);
      
      expect(tau).toBe(0);
    });

    it('Kendall\'s Tau가 0.7 이상이어야 함 (Acceptance Criteria)', () => {
      // 대부분 일치하는 순서 (80% 일치)
      const order1 = ['id1', 'id2', 'id3', 'id4', 'id5', 'id6', 'id7', 'id8', 'id9', 'id10'];
      const order2 = ['id1', 'id2', 'id3', 'id4', 'id5', 'id7', 'id6', 'id8', 'id9', 'id10'];
      
      const tau = calculateKendallTau(order1, order2);
      
      expect(tau).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe('calculateSpearmanRho', () => {
    it('완전히 일치하는 순서는 1을 반환해야 함', () => {
      const order1 = ['id1', 'id2', 'id3', 'id4', 'id5'];
      const order2 = ['id1', 'id2', 'id3', 'id4', 'id5'];
      
      const rho = calculateSpearmanRho(order1, order2);
      
      expect(rho).toBeCloseTo(1.0, 3);
    });

    it('부분적으로 일치하는 순서는 0과 1 사이 값을 반환해야 함', () => {
      const order1 = ['id1', 'id2', 'id3', 'id4', 'id5'];
      const order2 = ['id1', 'id3', 'id2', 'id4', 'id5'];
      
      const rho = calculateSpearmanRho(order1, order2);
      
      expect(rho).toBeGreaterThan(0);
      expect(rho).toBeLessThan(1);
    });

    it('빈 배열은 0을 반환해야 함', () => {
      const rho1 = calculateSpearmanRho([], ['id1', 'id2']);
      const rho2 = calculateSpearmanRho(['id1', 'id2'], []);
      
      expect(rho1).toBe(0);
      expect(rho2).toBe(0);
    });
  });

  describe('calculateTopKRetention', () => {
    it('완전히 일치하는 경우 유지율은 1.0이어야 함', () => {
      const pair: SearchResultPair = {
        vectorOnly: [
          { id: 'id1', score: 0.9 },
          { id: 'id2', score: 0.8 },
          { id: 'id3', score: 0.7 },
          { id: 'id4', score: 0.6 },
          { id: 'id5', score: 0.5 }
        ],
        withConsolidation: [
          { id: 'id1', score: 0.9 },
          { id: 'id2', score: 0.8 },
          { id: 'id3', score: 0.7 },
          { id: 'id4', score: 0.6 },
          { id: 'id5', score: 0.5 }
        ]
      };
      
      const retention = calculateTopKRetention(pair, [5]);
      
      expect(retention[5]).toBe(1.0);
    });

    it('부분적으로 일치하는 경우 유지율은 0과 1 사이여야 함', () => {
      const pair: SearchResultPair = {
        vectorOnly: [
          { id: 'id1', score: 0.9 },
          { id: 'id2', score: 0.8 },
          { id: 'id3', score: 0.7 },
          { id: 'id4', score: 0.6 },
          { id: 'id5', score: 0.5 }
        ],
        withConsolidation: [
          { id: 'id1', score: 0.9 },
          { id: 'id3', score: 0.8 },
          { id: 'id2', score: 0.7 },
          { id: 'id4', score: 0.6 },
          { id: 'id6', score: 0.5 }
        ]
      };
      
      const retention = calculateTopKRetention(pair, [5]);
      
      expect(retention[5]).toBeGreaterThan(0);
      expect(retention[5]).toBeLessThan(1);
      // vectorOnly 상위 5개: id1, id2, id3, id4, id5
      // consolidation 상위 5개: id1, id3, id2, id4, id6
      // 교집합: id1, id2, id3, id4 (4개) = 4/5 = 0.8
      expect(retention[5]).toBe(0.8);
    });

    it('Top10 유지율이 80% 이상이어야 함 (Acceptance Criteria)', () => {
      const pair: SearchResultPair = {
        vectorOnly: Array.from({ length: 10 }, (_, i) => ({
          id: `id${i + 1}`,
          score: 1.0 - i * 0.1
        })),
        withConsolidation: [
          // 8개는 유지, 2개는 순서 변경
          { id: 'id1', score: 0.9 },
          { id: 'id2', score: 0.8 },
          { id: 'id3', score: 0.7 },
          { id: 'id4', score: 0.6 },
          { id: 'id5', score: 0.5 },
          { id: 'id6', score: 0.4 },
          { id: 'id7', score: 0.3 },
          { id: 'id8', score: 0.2 },
          { id: 'id10', score: 0.1 }, // id9 대신 id10
          { id: 'id9', score: 0.05 }
        ]
      };
      
      const retention = calculateTopKRetention(pair, [10]);
      
      expect(retention[10]).toBeGreaterThanOrEqual(0.8);
    });

    it('Top5 유지율이 90% 이상이어야 함 (Acceptance Criteria)', () => {
      const pair: SearchResultPair = {
        vectorOnly: Array.from({ length: 5 }, (_, i) => ({
          id: `id${i + 1}`,
          score: 1.0 - i * 0.1
        })),
        withConsolidation: [
          // 5개 모두 유지 (순서만 약간 변경)
          { id: 'id1', score: 0.9 },
          { id: 'id2', score: 0.8 },
          { id: 'id3', score: 0.7 },
          { id: 'id4', score: 0.6 },
          { id: 'id5', score: 0.5 }
        ]
      };
      
      const retention = calculateTopKRetention(pair, [5]);
      
      expect(retention[5]).toBeGreaterThanOrEqual(0.9);
    });
  });

  describe('generateVectorOnlySearchResults', () => {
    it('벡터 유사도만으로 정렬된 결과를 생성해야 함', () => {
      const searchResults: HybridSearchResult[] = [
        {
          id: 'id1',
          content: 'content1',
          type: 'episodic',
          importance: 0.5,
          created_at: '2024-01-01',
          pinned: false,
          textScore: 0.3,
          vectorScore: 0.9,
          finalScore: 0.85,
          recall_reason: 'test'
        },
        {
          id: 'id2',
          content: 'content2',
          type: 'episodic',
          importance: 0.5,
          created_at: '2024-01-01',
          pinned: false,
          textScore: 0.5,
          vectorScore: 0.7,
          finalScore: 0.75,
          recall_reason: 'test'
        },
        {
          id: 'id3',
          content: 'content3',
          type: 'episodic',
          importance: 0.5,
          created_at: '2024-01-01',
          pinned: false,
          textScore: 0.4,
          vectorScore: 0.8,
          finalScore: 0.78,
          recall_reason: 'test'
        }
      ];
      
      const results = generateVectorOnlySearchResults(searchResults);
      
      expect(results).toHaveLength(3);
      expect(results[0].id).toBe('id1'); // vectorScore 0.9가 가장 높음
      expect(results[1].id).toBe('id3'); // vectorScore 0.8
      expect(results[2].id).toBe('id2'); // vectorScore 0.7
      expect(results[0].score).toBe(0.9);
    });

    it('limit이 지정된 경우 상위 N개만 반환해야 함', () => {
      const searchResults: HybridSearchResult[] = Array.from({ length: 10 }, (_, i) => ({
        id: `id${i + 1}`,
        content: `content${i + 1}`,
        type: 'episodic',
        importance: 0.5,
        created_at: '2024-01-01',
        pinned: false,
        textScore: 0.5,
        vectorScore: 1.0 - i * 0.1,
        finalScore: 0.9 - i * 0.1,
        recall_reason: 'test'
      }));
      
      const results = generateVectorOnlySearchResults(searchResults, 5);
      
      expect(results).toHaveLength(5);
      expect(results[0].id).toBe('id1');
      expect(results[4].id).toBe('id5');
    });
  });

  describe('generateConsolidationSearchResults', () => {
    it('finalScore로 정렬된 결과를 생성해야 함', () => {
      const searchResults: HybridSearchResult[] = [
        {
          id: 'id1',
          content: 'content1',
          type: 'episodic',
          importance: 0.5,
          created_at: '2024-01-01',
          pinned: false,
          textScore: 0.3,
          vectorScore: 0.7,
          finalScore: 0.85, // 가장 높음
          recall_reason: 'test'
        },
        {
          id: 'id2',
          content: 'content2',
          type: 'episodic',
          importance: 0.5,
          created_at: '2024-01-01',
          pinned: false,
          textScore: 0.5,
          vectorScore: 0.9, // vectorScore는 높지만
          finalScore: 0.75, // finalScore는 낮음
          recall_reason: 'test'
        },
        {
          id: 'id3',
          content: 'content3',
          type: 'episodic',
          importance: 0.5,
          created_at: '2024-01-01',
          pinned: false,
          textScore: 0.4,
          vectorScore: 0.8,
          finalScore: 0.78,
          recall_reason: 'test'
        }
      ];
      
      const results = generateConsolidationSearchResults(searchResults);
      
      expect(results).toHaveLength(3);
      expect(results[0].id).toBe('id1'); // finalScore 0.85가 가장 높음
      expect(results[1].id).toBe('id3'); // finalScore 0.78
      expect(results[2].id).toBe('id2'); // finalScore 0.75
      expect(results[0].score).toBe(0.85);
    });
  });

  describe('generateOrderPreservationReport', () => {
    it('모든 검증을 통과하는 경우 passed가 true여야 함', () => {
      const pair: SearchResultPair = {
        vectorOnly: Array.from({ length: 10 }, (_, i) => ({
          id: `id${i + 1}`,
          score: 1.0 - i * 0.1
        })),
        withConsolidation: Array.from({ length: 10 }, (_, i) => ({
          id: `id${i + 1}`,
          score: 1.0 - i * 0.1
        }))
      };
      
      const report = generateOrderPreservationReport(pair);
      
      expect(report.passed).toBe(true);
      expect(report.failureReasons).toBeUndefined();
      expect(report.validation.kendallTauValid).toBe(true);
      expect(report.validation.top10RetentionValid).toBe(true);
      expect(report.validation.top5RetentionValid).toBe(true);
    });

    it('Kendall\'s Tau가 임계값 미만이면 실패해야 함', () => {
      const pair: SearchResultPair = {
        vectorOnly: ['id1', 'id2', 'id3', 'id4', 'id5'].map(id => ({ id, score: 0.9 })),
        withConsolidation: ['id5', 'id4', 'id3', 'id2', 'id1'].map(id => ({ id, score: 0.9 }))
      };
      
      const report = generateOrderPreservationReport(pair, {
        kendallTauThreshold: 0.7
      });
      
      expect(report.passed).toBe(false);
      expect(report.failureReasons).toBeDefined();
      expect(report.failureReasons?.some(reason => reason.includes("Kendall's Tau"))).toBe(true);
      expect(report.validation.kendallTauValid).toBe(false);
    });

    it('Top10 유지율이 임계값 미만이면 실패해야 함', () => {
      const pair: SearchResultPair = {
        vectorOnly: Array.from({ length: 10 }, (_, i) => ({
          id: `id${i + 1}`,
          score: 1.0 - i * 0.1
        })),
        withConsolidation: [
          // 상위 10개 중 5개만 유지 (50%)
          ...Array.from({ length: 5 }, (_, i) => ({
            id: `id${i + 1}`,
            score: 1.0 - i * 0.1
          })),
          ...Array.from({ length: 5 }, (_, i) => ({
            id: `id${i + 11}`,
            score: 0.5 - i * 0.1
          }))
        ]
      };
      
      const report = generateOrderPreservationReport(pair, {
        top10RetentionThreshold: 0.8
      });
      
      expect(report.passed).toBe(false);
      expect(report.failureReasons).toBeDefined();
      expect(report.failureReasons?.some(reason => reason.includes('Top10 유지율'))).toBe(true);
      expect(report.validation.top10RetentionValid).toBe(false);
    });

    it('Top5 유지율이 임계값 미만이면 실패해야 함', () => {
      const pair: SearchResultPair = {
        vectorOnly: Array.from({ length: 5 }, (_, i) => ({
          id: `id${i + 1}`,
          score: 1.0 - i * 0.1
        })),
        withConsolidation: [
          // 상위 5개 중 3개만 유지 (60%)
          { id: 'id1', score: 0.9 },
          { id: 'id2', score: 0.8 },
          { id: 'id3', score: 0.7 },
          { id: 'id6', score: 0.6 },
          { id: 'id7', score: 0.5 }
        ]
      };
      
      const report = generateOrderPreservationReport(pair, {
        top5RetentionThreshold: 0.9
      });
      
      expect(report.passed).toBe(false);
      expect(report.failureReasons).toBeDefined();
      expect(report.failureReasons?.some(reason => reason.includes('Top5 유지율'))).toBe(true);
      expect(report.validation.top5RetentionValid).toBe(false);
    });

    it('Acceptance Criteria를 모두 통과해야 함', () => {
      // 대부분 일치하는 순서 (Kendall's Tau >= 0.7, Top10 >= 80%, Top5 >= 90%)
      const pair: SearchResultPair = {
        vectorOnly: Array.from({ length: 10 }, (_, i) => ({
          id: `id${i + 1}`,
          score: 1.0 - i * 0.1
        })),
        withConsolidation: [
          // 9개 유지 (90%)
          { id: 'id1', score: 0.9 },
          { id: 'id2', score: 0.8 },
          { id: 'id3', score: 0.7 },
          { id: 'id4', score: 0.6 },
          { id: 'id5', score: 0.5 },
          { id: 'id6', score: 0.4 },
          { id: 'id7', score: 0.3 },
          { id: 'id8', score: 0.2 },
          { id: 'id9', score: 0.1 },
          { id: 'id10', score: 0.05 }
        ]
      };
      
      const report = generateOrderPreservationReport(pair);
      
      expect(report.passed).toBe(true);
      expect(report.metrics.kendallTau).toBeGreaterThanOrEqual(0.7);
      expect(report.metrics.topKRetention[10]).toBeGreaterThanOrEqual(0.8);
      expect(report.metrics.topKRetention[5]).toBeGreaterThanOrEqual(0.9);
    });

    it('Spearman\'s Rho를 포함할 수 있어야 함', () => {
      const pair: SearchResultPair = {
        vectorOnly: Array.from({ length: 5 }, (_, i) => ({
          id: `id${i + 1}`,
          score: 1.0 - i * 0.1
        })),
        withConsolidation: Array.from({ length: 5 }, (_, i) => ({
          id: `id${i + 1}`,
          score: 1.0 - i * 0.1
        }))
      };
      
      const report = generateOrderPreservationReport(pair, {
        includeSpearmanRho: true
      });
      
      expect(report.metrics.spearmanRho).toBeDefined();
      expect(report.metrics.spearmanRho).toBeCloseTo(1.0, 3);
    });
  });

  describe('품질 지표 비교', () => {
    const groundTruth = {
      queryId: 'test-query',
      relevantIds: ['id1', 'id2', 'id3', 'id4', 'id5']
    };

    describe('measureVectorOnlyQuality', () => {
      it('벡터-only 품질 지표를 측정해야 함', () => {
        const results: SearchResult[] = [
          { id: 'id1', score: 0.9, relevance: 0.9 },
          { id: 'id2', score: 0.8, relevance: 0.8 },
          { id: 'id3', score: 0.7, relevance: 0.7 },
          { id: 'id4', score: 0.6, relevance: 0.6 },
          { id: 'id5', score: 0.5, relevance: 0.5 }
        ];

        const metrics = measureVectorOnlyQuality(results, groundTruth, [5]);

        expect(metrics.precision[5]).toBeGreaterThan(0);
        expect(metrics.recall[5]).toBeGreaterThan(0);
        expect(metrics.ndcg[5]).toBeGreaterThan(0);
      });

      it('관련 결과가 모두 포함된 경우 높은 지표를 반환해야 함', () => {
        const results: SearchResult[] = groundTruth.relevantIds.map(id => ({
          id,
          score: 0.9,
          relevance: 0.9
        }));

        const metrics = measureVectorOnlyQuality(results, groundTruth, [5]);

        expect(metrics.precision[5]).toBe(1.0);
        expect(metrics.recall[5]).toBe(1.0);
        expect(metrics.ndcg[5]).toBeCloseTo(1.0, 2);
      });
    });

    describe('measureConsolidationQuality', () => {
      it('Consolidation 반영 후 품질 지표를 측정해야 함', () => {
        const results: SearchResult[] = [
          { id: 'id1', score: 0.9, relevance: 0.9 },
          { id: 'id2', score: 0.8, relevance: 0.8 },
          { id: 'id3', score: 0.7, relevance: 0.7 },
          { id: 'id4', score: 0.6, relevance: 0.6 },
          { id: 'id5', score: 0.5, relevance: 0.5 }
        ];

        const metrics = measureConsolidationQuality(results, groundTruth, [5]);

        expect(metrics.precision[5]).toBeGreaterThan(0);
        expect(metrics.recall[5]).toBeGreaterThan(0);
        expect(metrics.ndcg[5]).toBeGreaterThan(0);
      });
    });

    describe('calculateQualityDegradation', () => {
      it('품질 저하율을 계산해야 함', () => {
        const vectorOnlyMetrics = {
          precision: { 5: 0.9 },
          recall: { 5: 0.8 },
          ndcg: { 5: 0.85 }
        };
        const consolidationMetrics = {
          precision: { 5: 0.85 },
          recall: { 5: 0.75 },
          ndcg: { 5: 0.82 }
        };

        const degradation = calculateQualityDegradation(
          vectorOnlyMetrics,
          consolidationMetrics,
          [5]
        );

        // 저하율 = (0.9 - 0.85) / 0.9 = 0.0556
        expect(degradation.precision[5]).toBeCloseTo(0.0556, 3);
        expect(degradation.ndcg[5]).toBeGreaterThan(0);
      });

      it('품질이 개선된 경우 음수 저하율을 반환해야 함', () => {
        const vectorOnlyMetrics = {
          precision: { 5: 0.8 },
          recall: { 5: 0.7 },
          ndcg: { 5: 0.75 }
        };
        const consolidationMetrics = {
          precision: { 5: 0.85 },
          recall: { 5: 0.75 },
          ndcg: { 5: 0.80 }
        };

        const degradation = calculateQualityDegradation(
          vectorOnlyMetrics,
          consolidationMetrics,
          [5]
        );

        // 개선율 = (0.8 - 0.85) / 0.8 = -0.0625 (음수 = 개선)
        expect(degradation.precision[5]).toBeLessThan(0);
      });
    });

    describe('validateQualityThresholds', () => {
      it('모든 임계값을 통과하는 경우 passed가 true여야 함', () => {
        const degradation = {
          precision: { 5: 0.03 }, // 3% < 10%
          recall: { 5: 0.05 }, // 5% < 10%
          ndcg: { 5: 0.02 } // 2% < 5%
        };

        const validation = validateQualityThresholds(degradation);

        expect(validation.passed).toBe(true);
        expect(validation.failureReasons).toBeUndefined();
        expect(validation.validation.ndcg5Valid).toBe(true);
        expect(validation.validation.precision5Valid).toBe(true);
        expect(validation.validation.recall5Valid).toBe(true);
      });

      it('NDCG@5 저하율이 임계값을 초과하면 실패해야 함', () => {
        const degradation = {
          precision: { 5: 0.03 },
          recall: { 5: 0.05 },
          ndcg: { 5: 0.06 } // 6% >= 5%
        };

        const validation = validateQualityThresholds(degradation, {
          ndcg5Threshold: 0.05
        });

        expect(validation.passed).toBe(false);
        expect(validation.failureReasons).toBeDefined();
        expect(validation.failureReasons?.some(reason => reason.includes('NDCG@5'))).toBe(true);
        expect(validation.validation.ndcg5Valid).toBe(false);
      });

      it('Precision@5 저하율이 임계값을 초과하면 실패해야 함', () => {
        const degradation = {
          precision: { 5: 0.12 }, // 12% >= 10%
          recall: { 5: 0.05 },
          ndcg: { 5: 0.02 }
        };

        const validation = validateQualityThresholds(degradation, {
          precision5Threshold: 0.10
        });

        expect(validation.passed).toBe(false);
        expect(validation.failureReasons).toBeDefined();
        expect(validation.failureReasons?.some(reason => reason.includes('Precision@5'))).toBe(true);
        expect(validation.validation.precision5Valid).toBe(false);
      });

      it('Recall@5 저하율이 임계값을 초과하면 실패해야 함', () => {
        const degradation = {
          precision: { 5: 0.03 },
          recall: { 5: 0.15 }, // 15% >= 10%
          ndcg: { 5: 0.02 }
        };

        const validation = validateQualityThresholds(degradation, {
          recall5Threshold: 0.10
        });

        expect(validation.passed).toBe(false);
        expect(validation.failureReasons).toBeDefined();
        expect(validation.failureReasons?.some(reason => reason.includes('Recall@5'))).toBe(true);
        expect(validation.validation.recall5Valid).toBe(false);
      });

      it('Acceptance Criteria를 모두 통과해야 함', () => {
        const degradation = {
          precision: { 5: 0.05 }, // 5% < 10%
          recall: { 5: 0.08 }, // 8% < 10%
          ndcg: { 5: 0.03 } // 3% < 5%
        };

        const validation = validateQualityThresholds(degradation);

        expect(validation.passed).toBe(true);
        expect(validation.validation.ndcg5Valid).toBe(true);
        expect(validation.validation.precision5Valid).toBe(true);
        expect(validation.validation.recall5Valid).toBe(true);
      });
    });

    describe('compareQualityWithGroundTruth', () => {
      it('벡터-only와 Consolidation 품질을 비교해야 함', () => {
        const vectorOnlyResults: SearchResult[] = [
          { id: 'id1', score: 0.9 },
          { id: 'id2', score: 0.8 },
          { id: 'id3', score: 0.7 },
          { id: 'id4', score: 0.6 },
          { id: 'id5', score: 0.5 }
        ];
        const consolidationResults: SearchResult[] = [
          { id: 'id1', score: 0.9 },
          { id: 'id2', score: 0.8 },
          { id: 'id3', score: 0.7 },
          { id: 'id4', score: 0.6 },
          { id: 'id5', score: 0.5 }
        ];

        const comparison = compareQualityWithGroundTruth(
          vectorOnlyResults,
          consolidationResults,
          groundTruth
        );

        expect(comparison.vectorOnly).toBeDefined();
        expect(comparison.consolidation).toBeDefined();
        expect(comparison.degradation).toBeDefined();
        expect(comparison.thresholdValidation).toBeDefined();
      });
    });

    describe('generateQualityComparisonReport', () => {
      it('품질 비교 결과 리포트를 생성해야 함', () => {
        const vectorOnlyResults: SearchResult[] = [
          { id: 'id1', score: 0.9 },
          { id: 'id2', score: 0.8 },
          { id: 'id3', score: 0.7 }
        ];
        const consolidationResults: SearchResult[] = [
          { id: 'id1', score: 0.9 },
          { id: 'id2', score: 0.8 },
          { id: 'id3', score: 0.7 }
        ];

        const comparison = compareQualityWithGroundTruth(
          vectorOnlyResults,
          consolidationResults,
          groundTruth
        );
        const report = generateQualityComparisonReport(comparison, groundTruth);

        expect(report.timestamp).toBeDefined();
        expect(report.groundTruth.queryId).toBe(groundTruth.queryId);
        expect(report.vectorOnly).toBeDefined();
        expect(report.consolidation).toBeDefined();
        expect(report.summary.passed).toBeDefined();
        expect(report.summary.keyMetrics).toBeDefined();
      });
    });

    describe('visualizeQualityComparison', () => {
      it('Markdown 형식의 시각화 리포트를 생성해야 함', () => {
        const vectorOnlyResults: SearchResult[] = [
          { id: 'id1', score: 0.9 },
          { id: 'id2', score: 0.8 },
          { id: 'id3', score: 0.7 }
        ];
        const consolidationResults: SearchResult[] = [
          { id: 'id1', score: 0.9 },
          { id: 'id2', score: 0.8 },
          { id: 'id3', score: 0.7 }
        ];

        const comparison = compareQualityWithGroundTruth(
          vectorOnlyResults,
          consolidationResults,
          groundTruth
        );
        const report = generateQualityComparisonReport(comparison, groundTruth);
        const visualization = visualizeQualityComparison(report);

        expect(visualization).toContain('# 품질 비교 결과 리포트');
        expect(visualization).toContain('## 주요 지표 요약');
        expect(visualization).toContain('## 상세 품질 지표');
        expect(visualization).toContain('## 검증 결과');
        expect(visualization).toContain('| K |');
        expect(visualization).toContain('Precision@K');
        expect(visualization).toContain('Recall@K');
        expect(visualization).toContain('NDCG@K');
      });

      it('저하율을 포함할 수 있어야 함', () => {
        const vectorOnlyResults: SearchResult[] = [
          { id: 'id1', score: 0.9 },
          { id: 'id2', score: 0.8 }
        ];
        const consolidationResults: SearchResult[] = [
          { id: 'id1', score: 0.85 },
          { id: 'id2', score: 0.75 }
        ];

        const comparison = compareQualityWithGroundTruth(
          vectorOnlyResults,
          consolidationResults,
          groundTruth
        );
        const report = generateQualityComparisonReport(comparison, groundTruth);
        const visualization = visualizeQualityComparison(report, {
          includeDegradation: true
        });

        expect(visualization).toContain('저하율');
      });

      it('저하율을 제외할 수 있어야 함', () => {
        const vectorOnlyResults: SearchResult[] = [
          { id: 'id1', score: 0.9 },
          { id: 'id2', score: 0.8 }
        ];
        const consolidationResults: SearchResult[] = [
          { id: 'id1', score: 0.9 },
          { id: 'id2', score: 0.8 }
        ];

        const comparison = compareQualityWithGroundTruth(
          vectorOnlyResults,
          consolidationResults,
          groundTruth
        );
        const report = generateQualityComparisonReport(comparison, groundTruth);
        const visualization = visualizeQualityComparison(report, {
          includeDegradation: false
        });

        // 저하율 컬럼이 없어야 함
        const lines = visualization.split('\n');
        const headerLine = lines.find(line => line.includes('| K |'));
        expect(headerLine).not.toContain('저하율');
      });
    });
  });
});
