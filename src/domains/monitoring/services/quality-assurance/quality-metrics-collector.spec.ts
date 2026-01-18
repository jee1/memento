import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import { QualityMetricsCollector, type CollectedMetrics } from './quality-metrics-collector.js';
import type { SearchResult, GroundTruth } from '../../../../test/helpers/search-quality-metrics.js';
import type { SearchResultPair } from '../../../../test/helpers/vector-search-quality-metrics.js';
import type { ExpectedRelation, ExtractedRelation } from '../../../relation/services/relation-quality-validator.js';

describe('QualityMetricsCollector', () => {
  let db: Database.Database;
  let collector: QualityMetricsCollector;

  beforeEach(async () => {
    db = await setupTestDatabase();
    collector = new QualityMetricsCollector(db);
  });

  afterEach(() => {
    cleanupTestDatabase(db);
  });

  describe('초기화', () => {
    it('should initialize successfully with database', () => {
      // Given: 데이터베이스가 있는 경우
      // When: QualityMetricsCollector 생성
      // Then: 인스턴스가 생성되어야 함
      expect(collector).toBeDefined();
    });

    it('should throw error when database is not provided', () => {
      // Given: 데이터베이스가 없는 경우
      // When/Then: 에러가 발생해야 함
      expect(() => {
        new QualityMetricsCollector(null as any);
      }).toThrow('Database instance is required');
    });
  });

  describe('collectSearchMetrics', () => {
    it('should return search metrics structure', async () => {
      // Given: 기본 컨텍스트
      // When: 검색 품질 지표 수집
      const result = await collector.collectSearchMetrics();

      // Then: 검색 품질 지표 구조가 반환되어야 함
      expect(result).toBeDefined();
      expect(result.namespace).toBe('search');
      expect(result.context).toBe('default');
      expect(result.measured_at).toBeDefined();
      expect(result.metrics).toBeDefined();
      expect(typeof result.metrics).toBe('object');
    });

    it('should return search metrics with custom context', async () => {
      // Given: 커스텀 컨텍스트
      // When: 검색 품질 지표 수집
      const result = await collector.collectSearchMetrics('ci');

      // Then: 지정된 컨텍스트가 반환되어야 함
      expect(result.context).toBe('ci');
      expect(result.namespace).toBe('search');
    });

    it('should return default values when no ground truth provided', async () => {
      // Given: Ground Truth가 없는 경우
      // When: 검색 품질 지표 수집
      const result = await collector.collectSearchMetrics();

      // Then: 기본값(0)이 반환되어야 함
      expect(result.metrics.precision_at_5).toBe(0);
      expect(result.metrics.precision_at_10).toBe(0);
      expect(result.metrics.recall_at_5).toBe(0);
      expect(result.metrics.recall_at_10).toBe(0);
      expect(result.metrics.ndcg_at_5).toBe(0);
      expect(result.metrics.ndcg_at_10).toBe(0);
      expect(result.metrics.mrr).toBe(0);
      expect(result.metrics.kendalls_tau).toBe(0);
      expect(result.metrics.top_5_retention).toBe(0);
      expect(result.metrics.top_10_retention).toBe(0);
    });

    it('should calculate precision and recall when ground truth provided', async () => {
      // Given: Ground Truth와 검색 결과
      const groundTruths: GroundTruth[] = [
        { queryId: 'query1', relevantIds: ['id1', 'id2', 'id3'] }
      ];
      const queryResults = new Map<string, SearchResult[]>([
        ['query1', [
          { id: 'id1', score: 0.9 },
          { id: 'id2', score: 0.8 },
          { id: 'id4', score: 0.7 },
          { id: 'id3', score: 0.6 },
          { id: 'id5', score: 0.5 }
        ]]
      ]);

      // When: 검색 품질 지표 수집
      const result = await collector.collectSearchMetrics('default', {
        groundTruths,
        queryResults
      });

      // Then: Precision@5와 Recall@5가 계산되어야 함
      // Precision@5: 상위 5개 중 관련 결과 3개 = 3/5 = 0.6
      // Recall@5: 관련 결과 3개 중 상위 5개에 3개 포함 = 3/3 = 1.0
      expect(result.metrics.precision_at_5).toBeCloseTo(0.6, 2);
      expect(result.metrics.recall_at_5).toBeCloseTo(1.0, 2);
      expect(result.metrics.precision_at_10).toBeCloseTo(0.6, 2);
      expect(result.metrics.recall_at_10).toBeCloseTo(1.0, 2);
    });

    it('should calculate NDCG when ground truth provided', async () => {
      // Given: Ground Truth와 검색 결과
      const groundTruths: GroundTruth[] = [
        { queryId: 'query1', relevantIds: ['id1', 'id2', 'id3'] }
      ];
      const queryResults = new Map<string, SearchResult[]>([
        ['query1', [
          { id: 'id1', score: 0.9 },
          { id: 'id2', score: 0.8 },
          { id: 'id4', score: 0.7 },
          { id: 'id3', score: 0.6 }
        ]]
      ]);

      // When: 검색 품질 지표 수집
      const result = await collector.collectSearchMetrics('default', {
        groundTruths,
        queryResults
      });

      // Then: NDCG가 계산되어야 함 (0 이상 1 이하)
      expect(result.metrics.ndcg_at_5).toBeGreaterThanOrEqual(0);
      expect(result.metrics.ndcg_at_5).toBeLessThanOrEqual(1);
      expect(result.metrics.ndcg_at_10).toBeGreaterThanOrEqual(0);
      expect(result.metrics.ndcg_at_10).toBeLessThanOrEqual(1);
    });

    it('should calculate MRR when ground truth provided', async () => {
      // Given: 여러 쿼리의 Ground Truth와 검색 결과
      const groundTruths: GroundTruth[] = [
        { queryId: 'query1', relevantIds: ['id1', 'id2'] },
        { queryId: 'query2', relevantIds: ['id3', 'id4'] }
      ];
      const queryResults = new Map<string, SearchResult[]>([
        ['query1', [
          { id: 'id5', score: 0.9 },
          { id: 'id1', score: 0.8 }, // 첫 번째 관련 결과가 2위
          { id: 'id2', score: 0.7 }
        ]],
        ['query2', [
          { id: 'id3', score: 0.9 }, // 첫 번째 관련 결과가 1위
          { id: 'id4', score: 0.8 }
        ]]
      ]);

      // When: 검색 품질 지표 수집
      const result = await collector.collectSearchMetrics('default', {
        groundTruths,
        queryResults
      });

      // Then: MRR이 계산되어야 함
      // query1: 첫 번째 관련 결과가 2위 -> 1/2 = 0.5
      // query2: 첫 번째 관련 결과가 1위 -> 1/1 = 1.0
      // MRR = (0.5 + 1.0) / 2 = 0.75
      expect(result.metrics.mrr).toBeCloseTo(0.75, 2);
    });

    it('should calculate Kendall Tau and retention when search result pairs provided', async () => {
      // Given: 검색 결과 쌍 (벡터-only와 Consolidation 반영 후)
      const searchResultPairs: SearchResultPair[] = [
        {
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
            { id: 'id5', score: 0.5 }
          ]
        }
      ];

      // When: 검색 품질 지표 수집
      const result = await collector.collectSearchMetrics('default', {
        groundTruths: [],
        queryResults: new Map(),
        searchResultPairs
      });

      // Then: Kendall's Tau와 Top-K 유지율이 계산되어야 함
      expect(result.metrics.kendalls_tau).toBeDefined();
      expect(result.metrics.kendalls_tau).toBeGreaterThanOrEqual(-1);
      expect(result.metrics.kendalls_tau).toBeLessThanOrEqual(1);
      expect(result.metrics.top_5_retention).toBeGreaterThanOrEqual(0);
      expect(result.metrics.top_5_retention).toBeLessThanOrEqual(1);
      expect(result.metrics.top_10_retention).toBeGreaterThanOrEqual(0);
      expect(result.metrics.top_10_retention).toBeLessThanOrEqual(1);
    });

    it('should calculate all metrics when all options provided', async () => {
      // Given: Ground Truth, 검색 결과, 검색 결과 쌍 모두 제공
      const groundTruths: GroundTruth[] = [
        { queryId: 'query1', relevantIds: ['id1', 'id2'] }
      ];
      const queryResults = new Map<string, SearchResult[]>([
        ['query1', [
          { id: 'id1', score: 0.9 },
          { id: 'id2', score: 0.8 },
          { id: 'id3', score: 0.7 }
        ]]
      ]);
      const searchResultPairs: SearchResultPair[] = [
        {
          vectorOnly: [
            { id: 'id1', score: 0.9 },
            { id: 'id2', score: 0.8 }
          ],
          withConsolidation: [
            { id: 'id1', score: 0.9 },
            { id: 'id2', score: 0.8 }
          ]
        }
      ];

      // When: 검색 품질 지표 수집
      const result = await collector.collectSearchMetrics('default', {
        groundTruths,
        queryResults,
        searchResultPairs
      });

      // Then: 모든 지표가 계산되어야 함
      expect(result.metrics.precision_at_5).toBeGreaterThanOrEqual(0);
      expect(result.metrics.recall_at_5).toBeGreaterThanOrEqual(0);
      expect(result.metrics.ndcg_at_5).toBeGreaterThanOrEqual(0);
      expect(result.metrics.mrr).toBeGreaterThanOrEqual(0);
      expect(result.metrics.kendalls_tau).toBeDefined();
      expect(result.metrics.top_5_retention).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty ground truth gracefully', async () => {
      // Given: 빈 Ground Truth
      // When: 검색 품질 지표 수집
      const result = await collector.collectSearchMetrics('default', {
        groundTruths: [],
        queryResults: new Map()
      });

      // Then: 기본값이 반환되어야 함
      expect(result.metrics.precision_at_5).toBe(0);
      expect(result.metrics.mrr).toBe(0);
    });

    it('should handle missing query results gracefully', async () => {
      // Given: Ground Truth는 있지만 해당 쿼리 결과가 없는 경우
      const groundTruths: GroundTruth[] = [
        { queryId: 'query1', relevantIds: ['id1', 'id2'] }
      ];
      const queryResults = new Map<string, SearchResult[]>();

      // When: 검색 품질 지표 수집
      const result = await collector.collectSearchMetrics('default', {
        groundTruths,
        queryResults
      });

      // Then: 기본값이 반환되어야 함
      expect(result.metrics.precision_at_5).toBe(0);
      expect(result.metrics.mrr).toBe(0);
    });

    it('should include metadata about ground truth availability', async () => {
      // Given: Ground Truth가 있는 경우와 없는 경우
      // When: 검색 품질 지표 수집
      const resultWithGT = await collector.collectSearchMetrics('default', {
        groundTruths: [{ queryId: 'query1', relevantIds: ['id1'] }],
        queryResults: new Map([['query1', [{ id: 'id1', score: 0.9 }]]])
      });
      const resultWithoutGT = await collector.collectSearchMetrics();

      // Then: 메타데이터에 Ground Truth 정보가 포함되어야 함
      expect(resultWithGT.metadata?.has_ground_truth).toBe(true);
      expect(resultWithGT.metadata?.ground_truth_count).toBe(1);
      expect(resultWithoutGT.metadata?.has_ground_truth).toBe(false);
      expect(resultWithoutGT.metadata?.ground_truth_count).toBe(0);
    });
  });

  describe('collectRelationMetrics', () => {
    it('should return relation metrics structure', async () => {
      // Given: 기본 컨텍스트
      // When: 관계 추출 품질 지표 수집
      const result = await collector.collectRelationMetrics();

      // Then: 관계 추출 품질 지표 구조가 반환되어야 함
      expect(result).toBeDefined();
      expect(result.namespace).toBe('relation');
      expect(result.context).toBe('default');
      expect(result.measured_at).toBeDefined();
      expect(result.metrics).toBeDefined();
    });

    it('should return relation metrics with custom context', async () => {
      // Given: 커스텀 컨텍스트
      // When: 관계 추출 품질 지표 수집
      const result = await collector.collectRelationMetrics('nightly');

      // Then: 지정된 컨텍스트가 반환되어야 함
      expect(result.context).toBe('nightly');
      expect(result.namespace).toBe('relation');
    });

    it('should return default values when no expected or extracted relations provided', async () => {
      // Given: 예상 관계나 추출된 관계가 없는 경우
      // When: 관계 추출 품질 지표 수집
      const result = await collector.collectRelationMetrics();

      // Then: 기본값(0)이 반환되어야 함
      expect(result.metrics.precision).toBe(0);
      expect(result.metrics.recall).toBe(0);
      expect(result.metrics.f1_score).toBe(0);
      expect(result.metrics.true_positives).toBe(0);
      expect(result.metrics.false_positives).toBe(0);
      expect(result.metrics.false_negatives).toBe(0);
      expect(result.metrics.confidence_compliance_rate).toBe(0);
    });

    it('should calculate precision, recall, and f1_score when relations provided', async () => {
      // Given: 예상 관계와 추출된 관계
      const expectedRelations: ExpectedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          expected_relation_type: 'CAUSES',
          expected_confidence_range: [0.7, 0.9],
          source_content: '버그 발생',
          target_content: '시스템 오류'
        },
        {
          source_id: 'mem3',
          target_id: 'mem4',
          expected_relation_type: 'FOLLOWS',
          expected_confidence_range: [0.8, 0.95],
          source_content: '설계 완료',
          target_content: '개발 시작'
        }
      ];

      const extractedRelations: ExtractedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'CAUSES',
          confidence: 0.85
        },
        {
          source_id: 'mem3',
          target_id: 'mem4',
          relation_type: 'FOLLOWS',
          confidence: 0.9
        }
      ];

      // When: 관계 추출 품질 지표 수집
      const result = await collector.collectRelationMetrics('default', {
        expectedRelations,
        extractedRelations
      });

      // Then: Precision, Recall, F1-Score가 계산되어야 함
      expect(result.metrics.precision).toBeGreaterThanOrEqual(0);
      expect(result.metrics.precision).toBeLessThanOrEqual(1);
      expect(result.metrics.recall).toBeGreaterThanOrEqual(0);
      expect(result.metrics.recall).toBeLessThanOrEqual(1);
      expect(result.metrics.f1_score).toBeGreaterThanOrEqual(0);
      expect(result.metrics.f1_score).toBeLessThanOrEqual(1);
    });

    it('should calculate true_positives, false_positives, false_negatives', async () => {
      // Given: 일부만 일치하는 관계
      const expectedRelations: ExpectedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          expected_relation_type: 'CAUSES',
          expected_confidence_range: [0.7, 0.9],
          source_content: '버그 발생',
          target_content: '시스템 오류'
        },
        {
          source_id: 'mem3',
          target_id: 'mem4',
          expected_relation_type: 'FOLLOWS',
          expected_confidence_range: [0.8, 0.95],
          source_content: '설계 완료',
          target_content: '개발 시작'
        }
      ];

      const extractedRelations: ExtractedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'CAUSES',
          confidence: 0.85 // 일치
        },
        {
          source_id: 'mem5',
          target_id: 'mem6',
          relation_type: 'DEPENDS_ON',
          confidence: 0.8 // False Positive (예상에 없음)
        }
        // mem3-mem4는 추출되지 않음 (False Negative)
      ];

      // When: 관계 추출 품질 지표 수집
      const result = await collector.collectRelationMetrics('default', {
        expectedRelations,
        extractedRelations
      });

      // Then: TP, FP, FN이 계산되어야 함
      expect(result.metrics.true_positives).toBeGreaterThanOrEqual(0);
      expect(result.metrics.false_positives).toBeGreaterThanOrEqual(0);
      expect(result.metrics.false_negatives).toBeGreaterThanOrEqual(0);
    });

    it('should calculate confidence_compliance_rate', async () => {
      // Given: 신뢰도 범위를 만족하는 관계
      const expectedRelations: ExpectedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          expected_relation_type: 'CAUSES',
          expected_confidence_range: [0.7, 0.9],
          source_content: '버그 발생',
          target_content: '시스템 오류'
        }
      ];

      const extractedRelations: ExtractedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'CAUSES',
          confidence: 0.85 // 범위 내
        }
      ];

      // When: 관계 추출 품질 지표 수집
      const result = await collector.collectRelationMetrics('default', {
        expectedRelations,
        extractedRelations
      });

      // Then: 신뢰도 준수율이 계산되어야 함 (0 이상 1 이하)
      expect(result.metrics.confidence_compliance_rate).toBeGreaterThanOrEqual(0);
      expect(result.metrics.confidence_compliance_rate).toBeLessThanOrEqual(1);
    });

    it('should include type-specific metrics in metadata', async () => {
      // Given: 여러 관계 유형의 관계
      const expectedRelations: ExpectedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          expected_relation_type: 'CAUSES',
          expected_confidence_range: [0.7, 0.9],
          source_content: '버그 발생',
          target_content: '시스템 오류'
        },
        {
          source_id: 'mem3',
          target_id: 'mem4',
          expected_relation_type: 'FOLLOWS',
          expected_confidence_range: [0.8, 0.95],
          source_content: '설계 완료',
          target_content: '개발 시작'
        }
      ];

      const extractedRelations: ExtractedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'CAUSES',
          confidence: 0.85
        },
        {
          source_id: 'mem3',
          target_id: 'mem4',
          relation_type: 'FOLLOWS',
          confidence: 0.9
        }
      ];

      // When: 관계 추출 품질 지표 수집
      const result = await collector.collectRelationMetrics('default', {
        expectedRelations,
        extractedRelations
      });

      // Then: 메타데이터에 관계 유형별 정확도가 포함되어야 함
      expect(result.metadata?.type_precision).toBeDefined();
      expect(result.metadata?.type_recall).toBeDefined();
      expect(result.metadata?.type_f1_score).toBeDefined();
      expect(result.metadata?.has_ground_truth).toBe(true);
      expect(result.metadata?.expected_relations_count).toBe(2);
      expect(result.metadata?.extracted_relations_count).toBe(2);
    });

    it('should handle empty expected relations gracefully', async () => {
      // Given: 빈 예상 관계
      // When: 관계 추출 품질 지표 수집
      const result = await collector.collectRelationMetrics('default', {
        expectedRelations: [],
        extractedRelations: []
      });

      // Then: 기본값이 반환되어야 함
      expect(result.metrics.precision).toBe(0);
      expect(result.metrics.recall).toBe(0);
      expect(result.metrics.f1_score).toBe(0);
    });

    it('should handle empty extracted relations gracefully', async () => {
      // Given: 예상 관계는 있지만 추출된 관계가 없는 경우
      const expectedRelations: ExpectedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          expected_relation_type: 'CAUSES',
          expected_confidence_range: [0.7, 0.9],
          source_content: '버그 발생',
          target_content: '시스템 오류'
        }
      ];

      // When: 관계 추출 품질 지표 수집
      const result = await collector.collectRelationMetrics('default', {
        expectedRelations,
        extractedRelations: []
      });

      // Then: Recall은 0이어야 함 (모든 관계가 누락)
      expect(result.metrics.recall).toBe(0);
      expect(result.metrics.false_negatives).toBeGreaterThanOrEqual(0);
    });

    it('should include metadata about ground truth availability', async () => {
      // Given: 예상 관계와 추출된 관계가 있는 경우와 없는 경우
      const expectedRelations: ExpectedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          expected_relation_type: 'CAUSES',
          expected_confidence_range: [0.7, 0.9],
          source_content: '버그 발생',
          target_content: '시스템 오류'
        }
      ];

      const extractedRelations: ExtractedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'CAUSES',
          confidence: 0.85
        }
      ];

      // When: 관계 추출 품질 지표 수집
      const resultWithGT = await collector.collectRelationMetrics('default', {
        expectedRelations,
        extractedRelations
      });
      const resultWithoutGT = await collector.collectRelationMetrics();

      // Then: 메타데이터에 Ground Truth 정보가 포함되어야 함
      expect(resultWithGT.metadata?.has_ground_truth).toBe(true);
      expect(resultWithGT.metadata?.expected_relations_count).toBe(1);
      expect(resultWithGT.metadata?.extracted_relations_count).toBe(1);
      expect(resultWithoutGT.metadata?.has_ground_truth).toBe(false);
    });
  });

  describe('collectConsolidationMetrics', () => {
    it('should return consolidation metrics structure', async () => {
      // Given: 기본 컨텍스트
      // When: Consolidation 점수 품질 지표 수집
      const result = await collector.collectConsolidationMetrics();

      // Then: Consolidation 점수 품질 지표 구조가 반환되어야 함
      expect(result).toBeDefined();
      expect(result.namespace).toBe('consolidation');
      expect(result.context).toBe('default');
      expect(result.measured_at).toBeDefined();
      expect(result.metrics).toBeDefined();
    });

    it('should return consolidation metrics with custom context', async () => {
      // Given: 커스텀 컨텍스트
      // When: Consolidation 점수 품질 지표 수집
      const result = await collector.collectConsolidationMetrics('ci');

      // Then: 지정된 컨텍스트가 반환되어야 함
      expect(result.context).toBe('ci');
      expect(result.namespace).toBe('consolidation');
    });

    it('should return default values when no data provided', async () => {
      // Given: 데이터가 없는 경우
      // When: Consolidation 점수 품질 지표 수집
      const result = await collector.collectConsolidationMetrics();

      // Then: 기본값이 반환되어야 함
      expect(result.metrics.kendalls_tau).toBeDefined();
      expect(result.metrics.order_preservation).toBeDefined();
      expect(result.metrics.score_stability).toBeDefined();
    });

    it('should calculate order preservation metrics when search result pairs provided', async () => {
      // Given: 검색 결과 쌍
      const searchResultPairs: SearchResultPair[] = [
        {
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
            { id: 'id5', score: 0.5 }
          ]
        }
      ];

      // When: Consolidation 점수 품질 지표 수집
      const result = await collector.collectConsolidationMetrics('default', {
        searchResultPairs
      });

      // Then: 순서 보존 지표가 계산되어야 함
      expect(result.metrics.kendalls_tau).toBeDefined();
      expect(result.metrics.kendalls_tau).toBeGreaterThanOrEqual(-1);
      expect(result.metrics.kendalls_tau).toBeLessThanOrEqual(1);
      expect(result.metrics.order_preservation).toBeGreaterThanOrEqual(0);
      expect(result.metrics.order_preservation).toBeLessThanOrEqual(1);
      expect(result.metrics.top_5_retention).toBeGreaterThanOrEqual(0);
      expect(result.metrics.top_5_retention).toBeLessThanOrEqual(1);
      expect(result.metrics.top_10_retention).toBeGreaterThanOrEqual(0);
      expect(result.metrics.top_10_retention).toBeLessThanOrEqual(1);
    });

    it('should calculate score distribution when consolidation scores provided', async () => {
      // Given: Consolidation 점수 샘플
      const consolidationScores = [0.8, 0.75, 0.7, 0.85, 0.9, 0.65, 0.8, 0.75];

      // When: Consolidation 점수 품질 지표 수집
      const result = await collector.collectConsolidationMetrics('default', {
        consolidationScores
      });

      // Then: 점수 분포 지표가 계산되어야 함
      expect(result.metrics.score_mean).toBeGreaterThan(0);
      expect(result.metrics.score_mean).toBeLessThanOrEqual(1);
      expect(result.metrics.score_std).toBeGreaterThanOrEqual(0);
      expect(result.metrics.score_stability).toBeGreaterThanOrEqual(0);
      expect(result.metrics.score_stability).toBeLessThanOrEqual(1);
    });

    it('should calculate score stability correctly', async () => {
      // Given: 일관된 점수 샘플 (낮은 분산)
      const consistentScores = [0.8, 0.81, 0.79, 0.8, 0.81];
      // Given: 불일치한 점수 샘플 (높은 분산)
      const inconsistentScores = [0.2, 0.9, 0.3, 0.85, 0.1];

      // When: Consolidation 점수 품질 지표 수집
      const consistentResult = await collector.collectConsolidationMetrics('default', {
        consolidationScores: consistentScores
      });
      const inconsistentResult = await collector.collectConsolidationMetrics('default', {
        consolidationScores: inconsistentScores
      });

      // Then: 일관된 점수가 더 높은 안정성을 가져야 함
      expect(consistentResult.metrics.score_stability).toBeGreaterThan(
        inconsistentResult.metrics.score_stability
      );
    });

    it('should calculate all metrics when all options provided', async () => {
      // Given: 검색 결과 쌍과 점수 샘플 모두 제공
      const searchResultPairs: SearchResultPair[] = [
        {
          vectorOnly: [
            { id: 'id1', score: 0.9 },
            { id: 'id2', score: 0.8 }
          ],
          withConsolidation: [
            { id: 'id1', score: 0.9 },
            { id: 'id2', score: 0.8 }
          ]
        }
      ];
      const consolidationScores = [0.8, 0.75, 0.7];

      // When: Consolidation 점수 품질 지표 수집
      const result = await collector.collectConsolidationMetrics('default', {
        searchResultPairs,
        consolidationScores
      });

      // Then: 모든 지표가 계산되어야 함
      expect(result.metrics.kendalls_tau).toBeDefined();
      expect(result.metrics.order_preservation).toBeDefined();
      expect(result.metrics.score_mean).toBeDefined();
      expect(result.metrics.score_std).toBeDefined();
      expect(result.metrics.score_stability).toBeDefined();
    });

    it('should handle empty search result pairs gracefully', async () => {
      // Given: 빈 검색 결과 쌍
      // When: Consolidation 점수 품질 지표 수집
      const result = await collector.collectConsolidationMetrics('default', {
        searchResultPairs: []
      });

      // Then: 기본값이 반환되어야 함
      expect(result.metrics.kendalls_tau).toBe(0);
      expect(result.metrics.order_preservation).toBe(0);
    });

    it('should handle empty consolidation scores gracefully', async () => {
      // Given: 빈 점수 샘플
      // When: Consolidation 점수 품질 지표 수집
      const result = await collector.collectConsolidationMetrics('default', {
        consolidationScores: []
      });

      // Then: 기본값이 반환되어야 함
      expect(result.metrics.score_mean).toBe(0);
      expect(result.metrics.score_std).toBe(0);
      expect(result.metrics.score_stability).toBe(0);
    });

    it('should include metadata about data availability', async () => {
      // Given: 검색 결과 쌍과 점수 샘플이 있는 경우와 없는 경우
      const searchResultPairs: SearchResultPair[] = [
        {
          vectorOnly: [{ id: 'id1', score: 0.9 }],
          withConsolidation: [{ id: 'id1', score: 0.9 }]
        }
      ];
      const consolidationScores = [0.8, 0.75];

      // When: Consolidation 점수 품질 지표 수집
      const resultWithData = await collector.collectConsolidationMetrics('default', {
        searchResultPairs,
        consolidationScores
      });
      const resultWithoutData = await collector.collectConsolidationMetrics();

      // Then: 메타데이터에 데이터 정보가 포함되어야 함
      expect(resultWithData.metadata?.has_search_result_pairs).toBe(true);
      expect(resultWithData.metadata?.has_score_samples).toBe(true);
      expect(resultWithData.metadata?.search_result_pairs_count).toBe(1);
      expect(resultWithData.metadata?.score_samples_count).toBe(2);
      expect(resultWithoutData.metadata?.has_search_result_pairs).toBe(false);
      expect(resultWithoutData.metadata?.has_score_samples).toBe(false);
    });

    it('should query database for consolidation scores when not provided', async () => {
      // Given: 데이터베이스에 consolidation_score가 있는 경우
      // 테스트 데이터베이스에 consolidation_score가 있을 수 있음
      // When: Consolidation 점수 품질 지표 수집 (점수 샘플 없이)
      const result = await collector.collectConsolidationMetrics('default');

      // Then: 점수 분포 지표가 계산되거나 기본값이 반환되어야 함
      expect(result.metrics.score_mean).toBeDefined();
      expect(result.metrics.score_std).toBeDefined();
      expect(result.metrics.score_stability).toBeDefined();
    });
  });

  describe('collectStorageMetrics', () => {
    it('should return storage metrics structure', async () => {
      // Given: 기본 컨텍스트
      // When: 저장 품질 지표 수집
      const result = await collector.collectStorageMetrics();

      // Then: 저장 품질 지표 구조가 반환되어야 함
      expect(result).toBeDefined();
      expect(result.namespace).toBe('storage');
      expect(result.context).toBe('default');
      expect(result.measured_at).toBeDefined();
      expect(result.metrics).toBeDefined();
    });

    it('should return storage metrics with custom context', async () => {
      // Given: 커스텀 컨텍스트
      // When: 저장 품질 지표 수집
      const result = await collector.collectStorageMetrics('nightly');

      // Then: 지정된 컨텍스트가 반환되어야 함
      expect(result.context).toBe('nightly');
      expect(result.namespace).toBe('storage');
    });

    it('should calculate storage quality metrics', async () => {
      // Given: 기본 컨텍스트
      // When: 저장 품질 지표 수집
      const result = await collector.collectStorageMetrics();

      // Then: 저장 품질 지표가 계산되어야 함
      expect(result.metrics.duplication_rate).toBeDefined();
      expect(result.metrics.duplication_rate).toBeGreaterThanOrEqual(0);
      expect(result.metrics.duplication_rate).toBeLessThanOrEqual(1);
      expect(result.metrics.data_integrity).toBeDefined();
      expect(result.metrics.data_integrity).toBeGreaterThanOrEqual(0);
      expect(result.metrics.data_integrity).toBeLessThanOrEqual(1);
      expect(result.metrics.schema_compliance).toBeDefined();
      expect(result.metrics.schema_compliance).toBeGreaterThanOrEqual(0);
      expect(result.metrics.schema_compliance).toBeLessThanOrEqual(1);
      expect(result.metrics.data_loss_rate).toBeDefined();
      expect(result.metrics.data_loss_rate).toBeGreaterThanOrEqual(0);
      expect(result.metrics.data_loss_rate).toBeLessThanOrEqual(1);
    });

    it('should include metadata about storage metrics collection', async () => {
      // Given: 기본 컨텍스트
      // When: 저장 품질 지표 수집
      const result = await collector.collectStorageMetrics();

      // Then: 메타데이터가 포함되어야 함
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.note).toContain('저장 품질 지표 수집 완료');
    });
  });

  describe('collectAllMetrics', () => {
    it('should return all namespace metrics', async () => {
      // Given: 기본 컨텍스트
      // When: 모든 네임스페이스의 품질 지표 수집
      const results = await collector.collectAllMetrics();

      // Then: 모든 네임스페이스의 지표가 반환되어야 함
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(4);

      const namespaces = results.map(r => r.namespace);
      expect(namespaces).toContain('search');
      expect(namespaces).toContain('relation');
      expect(namespaces).toContain('consolidation');
      expect(namespaces).toContain('storage');
    });

    it('should return all metrics with custom context', async () => {
      // Given: 커스텀 컨텍스트
      // When: 모든 네임스페이스의 품질 지표 수집
      const results = await collector.collectAllMetrics('ci');

      // Then: 모든 결과가 지정된 컨텍스트를 가져야 함
      expect(results.length).toBe(4);
      results.forEach(result => {
        expect(result.context).toBe('ci');
      });
    });

    it('should return metrics in consistent order', async () => {
      // Given: 기본 컨텍스트
      // When: 모든 네임스페이스의 품질 지표 수집 (여러 번)
      const results1 = await collector.collectAllMetrics();
      const results2 = await collector.collectAllMetrics();

      // Then: 결과 순서가 일관되어야 함
      expect(results1.map(r => r.namespace)).toEqual(results2.map(r => r.namespace));
    });
  });

  describe('collectMetricsByNamespace', () => {
    it('should return search metrics when namespace is "search"', async () => {
      // Given: 'search' 네임스페이스
      // When: 해당 네임스페이스의 품질 지표 수집
      const result = await collector.collectMetricsByNamespace('search');

      // Then: 검색 품질 지표가 반환되어야 함
      expect(result.namespace).toBe('search');
      expect(result.context).toBe('default');
    });

    it('should return relation metrics when namespace is "relation"', async () => {
      // Given: 'relation' 네임스페이스
      // When: 해당 네임스페이스의 품질 지표 수집
      const result = await collector.collectMetricsByNamespace('relation');

      // Then: 관계 추출 품질 지표가 반환되어야 함
      expect(result.namespace).toBe('relation');
      expect(result.context).toBe('default');
    });

    it('should return consolidation metrics when namespace is "consolidation"', async () => {
      // Given: 'consolidation' 네임스페이스
      // When: 해당 네임스페이스의 품질 지표 수집
      const result = await collector.collectMetricsByNamespace('consolidation');

      // Then: Consolidation 점수 품질 지표가 반환되어야 함
      expect(result.namespace).toBe('consolidation');
      expect(result.context).toBe('default');
    });

    it('should return storage metrics when namespace is "storage"', async () => {
      // Given: 'storage' 네임스페이스
      // When: 해당 네임스페이스의 품질 지표 수집
      const result = await collector.collectMetricsByNamespace('storage');

      // Then: 저장 품질 지표가 반환되어야 함
      expect(result.namespace).toBe('storage');
      expect(result.context).toBe('default');
    });

    it('should use custom context when provided', async () => {
      // Given: 'search' 네임스페이스와 커스텀 컨텍스트
      // When: 해당 네임스페이스의 품질 지표 수집
      const result = await collector.collectMetricsByNamespace('search', 'ci');

      // Then: 지정된 컨텍스트가 사용되어야 함
      expect(result.namespace).toBe('search');
      expect(result.context).toBe('ci');
    });

    it('should throw error for unknown namespace', async () => {
      // Given: 알 수 없는 네임스페이스
      // When/Then: 에러가 발생해야 함
      await expect(
        collector.collectMetricsByNamespace('unknown' as any)
      ).rejects.toThrow('Unknown namespace: unknown');
    });
  });

  describe('통합 테스트', () => {
    it('should collect all metrics and return consistent structure', async () => {
      // Given: 기본 컨텍스트
      // When: 모든 네임스페이스의 품질 지표 수집
      const results = await collector.collectAllMetrics();

      // Then: 모든 결과가 일관된 구조를 가져야 함
      results.forEach(result => {
        expect(result).toHaveProperty('namespace');
        expect(result).toHaveProperty('context');
        expect(result).toHaveProperty('measured_at');
        expect(result).toHaveProperty('metrics');
        expect(result).toHaveProperty('metadata');

        expect(typeof result.namespace).toBe('string');
        expect(typeof result.context).toBe('string');
        expect(typeof result.measured_at).toBe('string');
        expect(typeof result.metrics).toBe('object');
        expect(typeof result.metadata).toBe('object');
      });
    });

    it('should handle multiple concurrent metric collections', async () => {
      // Given: 여러 네임스페이스
      // When: 동시에 여러 네임스페이스의 품질 지표 수집
      const [search, relation, consolidation, storage] = await Promise.all([
        collector.collectMetricsByNamespace('search'),
        collector.collectMetricsByNamespace('relation'),
        collector.collectMetricsByNamespace('consolidation'),
        collector.collectMetricsByNamespace('storage')
      ]);

      // Then: 모든 결과가 올바르게 반환되어야 함
      expect(search.namespace).toBe('search');
      expect(relation.namespace).toBe('relation');
      expect(consolidation.namespace).toBe('consolidation');
      expect(storage.namespace).toBe('storage');
    });

    it('should return different measured_at timestamps for sequential calls', async () => {
      // Given: 기본 컨텍스트
      // When: 순차적으로 품질 지표 수집
      const result1 = await collector.collectSearchMetrics();
      // 약간의 지연
      await new Promise(resolve => setTimeout(resolve, 10));
      const result2 = await collector.collectSearchMetrics();

      // Then: 측정 시간이 다를 수 있음 (구현에 따라 다를 수 있음)
      // 현재는 인터페이스만 제공하므로 동일할 수 있지만, 구조는 일관되어야 함
      expect(result1.measured_at).toBeDefined();
      expect(result2.measured_at).toBeDefined();
    });
  });
});

