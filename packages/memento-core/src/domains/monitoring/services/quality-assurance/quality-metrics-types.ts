import type { SearchResult, GroundTruth } from './search-quality-metrics.js';
import type { SearchResultPair } from './vector-search-quality-metrics.js';
import type { ExpectedRelation, ExtractedRelation } from '../../../relation/services/relation-quality-validator.js';

export interface CollectedMetrics {
  /**
   * 네임스페이스 (예: 'search', 'relation', 'storage')
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
