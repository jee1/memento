import type { SearchResult, GroundTruth } from './search-quality-metrics.js';
import type { SearchResultPair } from './vector-search-quality-metrics.js';
import type { ExpectedRelation, ExtractedRelation } from '../../../relation/services/relation-quality-validator.js';

export interface CollectedMetrics {
  /**
   * 네임스페이스 (예: 'search', 'relation', 'consolidation', 'storage')
   */
  namespace: string;

  /**
   * 컨텍스트 (예: 'default', 'ci', 'nightly')
   */
  context: string;

  /**
   * 측정 시간
   */
  measured_at: string;

  /**
   * 지표 데이터 (키-값 쌍)
   * 예: { 'precision_at_5': 0.85, 'recall_at_5': 0.72, ... }
   */
  metrics: Record<string, number>;

  /**
   * 메타데이터 (선택적)
   */
  metadata?: Record<string, unknown>;
}

export interface SearchQualityMetrics {
  // Precision@K
  precision_at_5?: number;
  precision_at_10?: number;

  // Recall@K
  recall_at_5?: number;
  recall_at_10?: number;

  // NDCG@K
  ndcg_at_5?: number;
  ndcg_at_10?: number;

  // MRR
  mrr?: number;

  // Kendall's Tau
  kendalls_tau?: number;

  // 상위 K개 결과 유지율
  top_5_retention?: number;
  top_10_retention?: number;

  // 벡터 유사도 분포 (평균, 표준편차)
  vector_similarity_mean?: number;
  vector_similarity_std?: number;

  // Consolidation 점수 분포 (평균, 표준편차)
  consolidation_score_mean?: number;
  consolidation_score_std?: number;
}

export interface RelationQualityMetrics {
  // 전체 메트릭
  precision?: number;
  recall?: number;
  f1_score?: number;

  // 카운트
  true_positives?: number;
  false_positives?: number;
  false_negatives?: number;

  // 신뢰도 범위 준수율
  confidence_compliance_rate?: number;

  // 관계 유형별 정확도 (선택적)
  type_precision?: Record<string, number>;
  type_recall?: Record<string, number>;
  type_f1_score?: Record<string, number>;
}

export interface ConsolidationQualityMetrics {
  // 점수 안정성 (분산의 역수 또는 일관성 지표)
  score_stability?: number;

  // 순서 보존율
  order_preservation?: number;

  // 점수 분포 (평균, 표준편차)
  score_mean?: number;
  score_std?: number;

  // Kendall's Tau (Consolidation 반영 전/후 순서 일치도)
  kendalls_tau?: number;
}

export interface StorageQualityMetrics {
  // 중복 비율
  duplication_rate?: number;

  // 데이터 무결성 (0-1, 1이 완벽)
  data_integrity?: number;

  // 스키마 준수율 (0-1, 1이 완벽)
  schema_compliance?: number;

  // 데이터 손실률 (0-1, 0이 완벽)
  data_loss_rate?: number;
}

export interface SearchMetricsOptions {
  groundTruths?: GroundTruth[];
  queryResults?: Map<string, SearchResult[]>;
  searchResultPairs?: SearchResultPair[];
  benchmarkDir?: string;
  strictBenchmark?: boolean;
}

export interface RelationMetricsOptions {
  expectedRelations?: ExpectedRelation[];
  extractedRelations?: ExtractedRelation[];
}

export interface ConsolidationMetricsOptions {
  searchResultPairs?: SearchResultPair[];
  consolidationScores?: number[];
}
