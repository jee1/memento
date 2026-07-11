/**
 * 벡터 검색 품질 검증 공유 타입
 */

import type { SearchResult } from '../search-quality-metrics.js';

/**
 * 벡터-only 검색 결과와 Consolidation 반영 후 검색 결과 쌍
 */
export interface SearchResultPair {
  /**
   * 벡터 유사도만 사용한 검색 결과 (점수 순으로 정렬됨)
   */
  vectorOnly: SearchResult[];
  
  /**
   * Consolidation 점수 반영 후 검색 결과 (점수 순으로 정렬됨)
   */
  withConsolidation: SearchResult[];
}

/**
 * 순서 보존 지표
 * 벡터-only 결과와 Consolidation 반영 후 결과 간의 순서 일치도를 측정
 */
export interface OrderPreservationMetrics {
  /**
   * Kendall's Tau 순서 일치도 (-1 ~ 1)
   * 1에 가까울수록 순서가 일치함
   */
  kendallTau: number;
  
  /**
   * Spearman's Rho 순서 일치도 (-1 ~ 1)
   * 1에 가까울수록 순서가 일치함 (선택적)
   */
  spearmanRho?: number;
  
  /**
   * 상위 K개 결과 유지율 (0 ~ 1)
   * 벡터-only 상위 K개가 Consolidation 반영 후에도 상위에 유지되는 비율
   */
  topKRetention: Record<number, number>;
  
  /**
   * Top10 유지율 (0 ~ 1)
   * 벡터-only 상위 10개가 Consolidation 반영 후에도 상위에 유지되는 비율
   */
  top10Retention: number;
  
  /**
   * Top5 유지율 (0 ~ 1)
   * 벡터-only 상위 5개가 Consolidation 반영 후에도 상위에 유지되는 비율
   */
  top5Retention: number;
  
  /**
   * 전체 결과 수
   */
  totalResults: number;
}

/**
 * 순서 보존 검증 결과 리포트
 */
export interface OrderPreservationReport {
  /**
   * 리포트 생성 시간 (ISO 8601 형식)
   */
  timestamp?: string;
  
  /**
   * 순서 보존 지표
   */
  metrics: OrderPreservationMetrics;
  
  /**
   * 검증 통과 여부
   */
  passed: boolean;
  
  /**
   * 검증 실패 사유 (통과 시 undefined)
   */
  failureReasons?: string[];
  
  /**
   * 상세 검증 결과
   */
  validation: {
    /**
     * Kendall's Tau >= 0.7 검증
     */
    kendallTauValid: boolean;
    
    /**
     * Top10 유지율 >= 80% 검증
     */
    top10RetentionValid: boolean;
    
    /**
     * Top5 유지율 >= 90% 검증
     */
    top5RetentionValid: boolean;
  };
  
  /**
   * 검증 임계값 (선택적)
   */
  thresholds?: {
    kendallTauThreshold?: number;
    top10RetentionThreshold?: number;
    top5RetentionThreshold?: number;
  };
}
