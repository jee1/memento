/**
 * 벡터 검색 품질 검증 헬퍼
 * 벡터 검색 결과 순서 보존 검증 및 품질 지표 비교
 * Consolidation 점수 반영 전/후 비교를 위한 지표 계산
 */

import type { SearchResult } from './search-quality-metrics.js';
import type { HybridSearchResult } from '../../algorithms/hybrid-search-engine.js';
import {
  calculatePrecisionAtK,
  calculateRecallAtK,
  calculateNDCGAtK
} from './search-quality-metrics.js';

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
   * 전체 결과 수
   */
  totalResults: number;
}

/**
 * 순서 보존 검증 결과 리포트
 */
export interface OrderPreservationReport {
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
}

/**
 * Kendall's Tau-b 순서 일치도 계산
 * 두 순서 간의 순위 상관관계를 측정 (-1 ~ 1)
 * 
 * Tau-b는 동점(tie)을 처리하는 버전으로, 검색 결과에서 동일 점수를 가진 항목들을 올바르게 처리합니다.
 * 
 * @param order1 첫 번째 순서 (ID 배열, 점수 순으로 정렬됨)
 * @param order2 두 번째 순서 (ID 배열, 점수 순으로 정렬됨)
 * @returns Kendall's Tau-b 값 (-1 ~ 1)
 *   - 1: 완전히 일치하는 순서
 *   - 0: 무관한 순서
 *   - -1: 완전히 반대인 순서
 * 
 * @example
 * ```typescript
 * const order1 = ['id1', 'id2', 'id3', 'id4'];
 * const order2 = ['id1', 'id3', 'id2', 'id4'];
 * const tau = calculateKendallTau(order1, order2);
 * // tau는 0.67 정도 (부분적으로 일치)
 * ```
 */
export function calculateKendallTau(
  order1: string[],
  order2: string[]
): number {
  // 빈 배열 처리
  if (order1.length === 0 || order2.length === 0) {
    return 0;
  }

  // 두 순서에서 공통 ID만 추출
  const set1 = new Set(order1);
  const set2 = new Set(order2);
  const commonIds = order1.filter(id => set2.has(id));

  if (commonIds.length < 2) {
    // 공통 ID가 2개 미만이면 순서 비교 불가
    return 0;
  }

  // 각 ID의 위치를 매핑
  const position1 = new Map<string, number>();
  const position2 = new Map<string, number>();

  order1.forEach((id, index) => {
    if (set2.has(id)) {
      position1.set(id, index);
    }
  });

  order2.forEach((id, index) => {
    if (set1.has(id)) {
      position2.set(id, index);
    }
  });

  // 공통 ID만 사용하여 순서 비교
  const n = commonIds.length;
  let concordant = 0; // 일치하는 쌍
  let discordant = 0; // 불일치하는 쌍
  let tiedX = 0; // order1에서 동점인 쌍
  let tiedY = 0; // order2에서 동점인 쌍
  let tiedXY = 0; // 양쪽 모두 동점인 쌍

  // 모든 쌍을 비교
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const idI = commonIds[i];
      const idJ = commonIds[j];

      const pos1I = position1.get(idI)!;
      const pos1J = position1.get(idJ)!;
      const pos2I = position2.get(idI)!;
      const pos2J = position2.get(idJ)!;

      // order1에서의 관계
      const sign1 = pos1I < pos1J ? 1 : pos1I > pos1J ? -1 : 0;
      // order2에서의 관계
      const sign2 = pos2I < pos2J ? 1 : pos2I > pos2J ? -1 : 0;

      if (sign1 === 0 && sign2 === 0) {
        // 양쪽 모두 동점
        tiedXY++;
      } else if (sign1 === 0) {
        // order1에서만 동점
        tiedX++;
      } else if (sign2 === 0) {
        // order2에서만 동점
        tiedY++;
      } else if (sign1 === sign2) {
        // 일치하는 쌍 (둘 다 앞서거나 둘 다 뒤)
        concordant++;
      } else {
        // 불일치하는 쌍 (하나는 앞서고 하나는 뒤)
        discordant++;
      }
    }
  }

  // Tau-b 계산
  // Tau-b = (concordant - discordant) / sqrt((concordant + discordant + tied_x) * (concordant + discordant + tied_y))
  const numerator = concordant - discordant;
  const denominatorX = concordant + discordant + tiedX;
  const denominatorY = concordant + discordant + tiedY;
  const denominator = Math.sqrt(denominatorX * denominatorY);

  if (denominator === 0) {
    // 분모가 0이면 모든 쌍이 동점이거나 비교 불가
    return 0;
  }

  return numerator / denominator;
}

/**
 * Spearman's Rho 순서 일치도 계산
 * 두 순서 간의 순위 상관관계를 측정 (-1 ~ 1)
 * 
 * Spearman's Rho는 순위 차이를 기반으로 계산되며, Kendall's Tau와 함께 사용하여
 * 순서 보존 정도를 다각도로 검증할 수 있습니다.
 * 
 * @param order1 첫 번째 순서 (ID 배열, 점수 순으로 정렬됨)
 * @param order2 두 번째 순서 (ID 배열, 점수 순으로 정렬됨)
 * @returns Spearman's Rho 값 (-1 ~ 1)
 *   - 1: 완전히 일치하는 순서
 *   - 0: 무관한 순서
 *   - -1: 완전히 반대인 순서
 * 
 * @example
 * ```typescript
 * const order1 = ['id1', 'id2', 'id3', 'id4'];
 * const order2 = ['id1', 'id3', 'id2', 'id4'];
 * const rho = calculateSpearmanRho(order1, order2);
 * // rho는 0.8 정도 (대체로 일치)
 * ```
 */
export function calculateSpearmanRho(
  order1: string[],
  order2: string[]
): number {
  // 빈 배열 처리
  if (order1.length === 0 || order2.length === 0) {
    return 0;
  }

  // 두 순서에서 공통 ID만 추출
  const set1 = new Set(order1);
  const set2 = new Set(order2);
  const commonIds = order1.filter(id => set2.has(id));

  if (commonIds.length < 2) {
    // 공통 ID가 2개 미만이면 순서 비교 불가
    return 0;
  }

  // 각 ID의 순위를 계산 (동점 처리 포함)
  const rank1 = calculateRanks(order1, commonIds);
  const rank2 = calculateRanks(order2, commonIds);

  // 순위 차이의 제곱합 계산
  let sumSquaredDiff = 0;
  for (const id of commonIds) {
    const diff = rank1.get(id)! - rank2.get(id)!;
    sumSquaredDiff += diff * diff;
  }

  // Spearman's Rho 계산
  // Rho = 1 - (6 * sum(d^2)) / (n * (n^2 - 1))
  const n = commonIds.length;
  const denominator = n * (n * n - 1);

  if (denominator === 0) {
    return 0;
  }

  return 1 - (6 * sumSquaredDiff) / denominator;
}

/**
 * 순위 계산 헬퍼 함수
 * 각 ID의 위치를 순위로 사용 (1-based)
 * 
 * 동점 처리는 실제 점수를 비교해야 하지만, 여기서는 위치 기반으로 순위를 계산합니다.
 * 실제 점수 정보가 필요한 경우, SearchResult의 score 필드를 사용하여
 * 동점인 항목들에 평균 순위를 할당할 수 있습니다.
 * 
 * @param order 순서 (ID 배열, 점수 순으로 정렬됨)
 * @param targetIds 순위를 계산할 ID 목록 (공통 ID)
 * @returns ID별 순위 맵 (1-based)
 */
function calculateRanks(
  order: string[],
  targetIds: string[]
): Map<string, number> {
  const ranks = new Map<string, number>();
  const targetSet = new Set(targetIds);

  // 각 ID의 위치를 순위로 사용 (1-based)
  order.forEach((id, index) => {
    if (targetSet.has(id)) {
      ranks.set(id, index + 1); // 1-based 순위
    }
  });

  // targetIds에 있지만 order에 없는 ID는 마지막 순위로 처리
  for (const id of targetIds) {
    if (!ranks.has(id)) {
      ranks.set(id, order.length + 1);
    }
  }

  return ranks;
}

/**
 * 상위 K개 결과 유지율 계산
 * 벡터-only 상위 K개가 Consolidation 반영 후에도 상위에 유지되는 비율
 * 
 * Acceptance Criteria:
 * - Top10 유지율 >= 80%
 * - Top5 유지율 >= 90%
 * 
 * @param pair 벡터-only와 Consolidation 반영 후 검색 결과 쌍
 * @param kValues 계산할 K 값 배열 (예: [5, 10])
 * @returns K 값별 유지율 (0 ~ 1)
 * 
 * @example
 * ```typescript
 * const pair = {
 *   vectorOnly: [{ id: 'id1' }, { id: 'id2' }, { id: 'id3' }, ...],
 *   withConsolidation: [{ id: 'id1' }, { id: 'id3' }, { id: 'id2' }, ...]
 * };
 * const retention = calculateTopKRetention(pair, [5, 10]);
 * // retention = { 5: 0.8, 10: 0.7 }
 * ```
 */
export function calculateTopKRetention(
  pair: SearchResultPair,
  kValues: number[] = [5, 10]
): Record<number, number> {
  const retention: Record<number, number> = {};

  for (const k of kValues) {
    // 벡터-only 상위 K개 ID 추출
    const vectorTopK = pair.vectorOnly.slice(0, k).map(r => r.id);
    const vectorTopKSet = new Set(vectorTopK);

    // Consolidation 반영 후 상위 K개 ID 추출
    const consolidationTopK = pair.withConsolidation.slice(0, k).map(r => r.id);
    const consolidationTopKSet = new Set(consolidationTopK);

    // 교집합 계산: 벡터-only 상위 K개가 Consolidation 상위 K개에도 포함된 개수
    let intersectionCount = 0;
    for (const id of vectorTopK) {
      if (consolidationTopKSet.has(id)) {
        intersectionCount++;
      }
    }

    // 유지율 계산
    // 유지율 = (벡터-only 상위 K개 중 Consolidation 상위 K개에도 포함된 개수) / K
    if (k === 0) {
      retention[k] = 0;
    } else {
      retention[k] = intersectionCount / k;
    }
  }

  return retention;
}

/**
 * 벡터 유사도만 사용한 검색 결과 생성
 * Consolidation 점수를 제외하고 벡터 유사도만으로 정렬한 결과를 생성합니다.
 * 
 * 이 함수는 실제 검색 결과를 받아서 벡터 유사도만으로 재정렬합니다.
 * 벡터 유사도가 없는 경우 textScore를 사용하거나, 해당 결과를 제외할 수 있습니다.
 * 
 * @param searchResults 실제 검색 결과 (HybridSearchResult 배열)
 * @param limit 반환할 결과 수 (기본값: 전체)
 * @returns 벡터 유사도만으로 정렬된 SearchResult 배열
 * 
 * @example
 * ```typescript
 * const results = await hybridSearchEngine.search(query, options);
 * const vectorOnlyResults = generateVectorOnlySearchResults(results);
 * ```
 */
export function generateVectorOnlySearchResults(
  searchResults: HybridSearchResult[],
  limit?: number
): SearchResult[] {
  // 벡터 유사도가 있는 결과만 필터링하고, vectorScore로 정렬
  const vectorOnlyResults = searchResults
    .filter(result => result.vectorScore !== undefined && result.vectorScore !== null)
    .map(result => ({
      id: result.id,
      score: result.vectorScore, // 벡터 유사도를 score로 사용
      finalScore: result.vectorScore, // 벡터 유사도만 사용하므로 finalScore도 동일
      relevance: result.vectorScore // 관련성 점수로도 사용
    }))
    .sort((a, b) => (b.score || 0) - (a.score || 0)); // 내림차순 정렬

  // limit이 지정된 경우 상위 N개만 반환
  if (limit !== undefined && limit > 0) {
    return vectorOnlyResults.slice(0, limit);
  }

  return vectorOnlyResults;
}

/**
 * Consolidation 점수 반영 후 검색 결과 생성
 * 벡터 유사도와 Consolidation 점수가 모두 반영된 최종 점수로 정렬한 결과를 생성합니다.
 * 
 * 이 함수는 실제 검색 결과를 받아서 finalScore(벡터 유사도 + Consolidation 점수)로 정렬합니다.
 * finalScore는 이미 검색 엔진에서 계산된 최종 점수입니다.
 * 
 * @param searchResults 실제 검색 결과 (HybridSearchResult 배열)
 * @param limit 반환할 결과 수 (기본값: 전체)
 * @returns Consolidation 점수 반영 후 정렬된 SearchResult 배열
 * 
 * @example
 * ```typescript
 * const results = await hybridSearchEngine.search(query, options);
 * const consolidationResults = generateConsolidationSearchResults(results);
 * ```
 */
export function generateConsolidationSearchResults(
  searchResults: HybridSearchResult[],
  limit?: number
): SearchResult[] {
  // finalScore를 사용하여 정렬 (벡터 유사도 + Consolidation 점수 반영)
  const consolidationResults = searchResults
    .filter(result => result.finalScore !== undefined && result.finalScore !== null)
    .map(result => ({
      id: result.id,
      score: result.finalScore, // 최종 점수를 score로 사용
      finalScore: result.finalScore, // finalScore 그대로 사용
      relevance: result.vectorScore || result.textScore || 0 // 관련성 점수는 벡터 유사도 또는 텍스트 점수 사용
    }))
    .sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0)); // 내림차순 정렬

  // limit이 지정된 경우 상위 N개만 반환
  if (limit !== undefined && limit > 0) {
    return consolidationResults.slice(0, limit);
  }

  return consolidationResults;
}

/**
 * 순서 보존 검증 결과 리포트 생성
 * 벡터-only 결과와 Consolidation 반영 후 결과 간의 순서 보존 정도를 검증하고 리포트를 생성합니다.
 * 
 * Acceptance Criteria:
 * - Kendall's Tau >= 0.7
 * - Top10 유지율 >= 80%
 * - Top5 유지율 >= 90%
 * 
 * @param pair 벡터-only와 Consolidation 반영 후 검색 결과 쌍
 * @param options 리포트 생성 옵션
 * @param options.includeSpearmanRho Spearman's Rho 계산 포함 여부 (기본값: false)
 * @param options.kValues TopK 유지율 계산할 K 값 배열 (기본값: [5, 10])
 * @param options.kendallTauThreshold Kendall's Tau 임계값 (기본값: 0.7)
 * @param options.top10RetentionThreshold Top10 유지율 임계값 (기본값: 0.8)
 * @param options.top5RetentionThreshold Top5 유지율 임계값 (기본값: 0.9)
 * @returns 순서 보존 검증 결과 리포트
 * 
 * @example
 * ```typescript
 * const pair = {
 *   vectorOnly: vectorOnlyResults,
 *   withConsolidation: consolidationResults
 * };
 * const report = generateOrderPreservationReport(pair);
 * console.log(`검증 통과: ${report.passed}`);
 * ```
 */
export function generateOrderPreservationReport(
  pair: SearchResultPair,
  options: {
    includeSpearmanRho?: boolean;
    kValues?: number[];
    kendallTauThreshold?: number;
    top10RetentionThreshold?: number;
    top5RetentionThreshold?: number;
  } = {}
): OrderPreservationReport {
  const {
    includeSpearmanRho = false,
    kValues = [5, 10],
    kendallTauThreshold = 0.7,
    top10RetentionThreshold = 0.8,
    top5RetentionThreshold = 0.9
  } = options;

  // ID 배열 추출
  const vectorOnlyIds = pair.vectorOnly.map(r => r.id);
  const consolidationIds = pair.withConsolidation.map(r => r.id);

  // Kendall's Tau 계산
  const kendallTau = calculateKendallTau(vectorOnlyIds, consolidationIds);

  // Spearman's Rho 계산 (선택적)
  const spearmanRho = includeSpearmanRho
    ? calculateSpearmanRho(vectorOnlyIds, consolidationIds)
    : undefined;

  // TopK 유지율 계산
  const topKRetention = calculateTopKRetention(pair, kValues);

  // 검증 수행
  const kendallTauValid = kendallTau >= kendallTauThreshold;
  const top10Retention = topKRetention[10] || 0;
  const top5Retention = topKRetention[5] || 0;
  const top10RetentionValid = top10Retention >= top10RetentionThreshold;
  const top5RetentionValid = top5Retention >= top5RetentionThreshold;

  // 전체 검증 통과 여부
  const passed = kendallTauValid && top10RetentionValid && top5RetentionValid;

  // 실패 사유 수집
  const failureReasons: string[] = [];
  if (!kendallTauValid) {
    failureReasons.push(
      `Kendall's Tau (${kendallTau.toFixed(3)}) < 임계값 (${kendallTauThreshold})`
    );
  }
  if (!top10RetentionValid) {
    failureReasons.push(
      `Top10 유지율 (${(top10Retention * 100).toFixed(1)}%) < 임계값 (${(top10RetentionThreshold * 100).toFixed(1)}%)`
    );
  }
  if (!top5RetentionValid) {
    failureReasons.push(
      `Top5 유지율 (${(top5Retention * 100).toFixed(1)}%) < 임계값 (${(top5RetentionThreshold * 100).toFixed(1)}%)`
    );
  }

  // 순서 보존 지표 생성
  const metrics: OrderPreservationMetrics = {
    kendallTau,
    spearmanRho,
    topKRetention,
    totalResults: Math.max(pair.vectorOnly.length, pair.withConsolidation.length)
  };

  // 리포트 생성
  const report: OrderPreservationReport = {
    metrics,
    passed,
    failureReasons: passed ? undefined : failureReasons,
    validation: {
      kendallTauValid,
      top10RetentionValid,
      top5RetentionValid
    }
  };

  return report;
}

/**
 * 품질 지표 인터페이스
 */
export interface QualityMetrics {
  /**
   * Precision@K 값들 (K 값별)
   */
  precision: Record<number, number>;
  
  /**
   * Recall@K 값들 (K 값별)
   */
  recall: Record<number, number>;
  
  /**
   * NDCG@K 값들 (K 값별)
   */
  ndcg: Record<number, number>;
}

/**
 * 벡터 유사도만 사용한 검색 결과에서 품질 지표 측정
 * Ground Truth를 기반으로 Precision/Recall/NDCG를 계산합니다.
 * 
 * @param results 벡터 유사도만으로 정렬된 검색 결과
 * @param groundTruth Ground Truth (관련 결과 ID 목록)
 * @param kValues 계산할 K 값 배열 (기본값: [1, 5, 10])
 * @returns 품질 지표 (Precision/Recall/NDCG)
 * 
 * @example
 * ```typescript
 * const vectorOnlyResults = generateVectorOnlySearchResults(searchResults);
 * const groundTruth = { queryId: 'query1', relevantIds: ['id1', 'id2', 'id3'] };
 * const metrics = measureVectorOnlyQuality(vectorOnlyResults, groundTruth);
 * console.log(`NDCG@5: ${metrics.ndcg[5]}`);
 * ```
 */
export function measureVectorOnlyQuality(
  results: SearchResult[],
  groundTruth: { queryId: string; relevantIds: string[] },
  kValues: number[] = [1, 5, 10]
): QualityMetrics {
  const metrics: QualityMetrics = {
    precision: {},
    recall: {},
    ndcg: {}
  };

  kValues.forEach(k => {
    metrics.precision[k] = calculatePrecisionAtK(results, groundTruth.relevantIds, k);
    metrics.recall[k] = calculateRecallAtK(results, groundTruth.relevantIds, k);
    metrics.ndcg[k] = calculateNDCGAtK(results, groundTruth.relevantIds, k);
  });

  return metrics;
}

/**
 * Consolidation 점수 반영 후 검색 결과에서 품질 지표 측정
 * Ground Truth를 기반으로 Precision/Recall/NDCG를 계산합니다.
 * 
 * @param results Consolidation 점수 반영 후 정렬된 검색 결과
 * @param groundTruth Ground Truth (관련 결과 ID 목록)
 * @param kValues 계산할 K 값 배열 (기본값: [1, 5, 10])
 * @returns 품질 지표 (Precision/Recall/NDCG)
 * 
 * @example
 * ```typescript
 * const consolidationResults = generateConsolidationSearchResults(searchResults);
 * const groundTruth = { queryId: 'query1', relevantIds: ['id1', 'id2', 'id3'] };
 * const metrics = measureConsolidationQuality(consolidationResults, groundTruth);
 * console.log(`NDCG@5: ${metrics.ndcg[5]}`);
 * ```
 */
export function measureConsolidationQuality(
  results: SearchResult[],
  groundTruth: { queryId: string; relevantIds: string[] },
  kValues: number[] = [1, 5, 10]
): QualityMetrics {
  const metrics: QualityMetrics = {
    precision: {},
    recall: {},
    ndcg: {}
  };

  kValues.forEach(k => {
    metrics.precision[k] = calculatePrecisionAtK(results, groundTruth.relevantIds, k);
    metrics.recall[k] = calculateRecallAtK(results, groundTruth.relevantIds, k);
    metrics.ndcg[k] = calculateNDCGAtK(results, groundTruth.relevantIds, k);
  });

  return metrics;
}

/**
 * 품질 저하율 인터페이스
 */
export interface QualityDegradation {
  /**
   * Precision@K 저하율 (K 값별, 0-1)
   * 양수면 저하, 음수면 개선
   */
  precision: Record<number, number>;
  
  /**
   * Recall@K 저하율 (K 값별, 0-1)
   * 양수면 저하, 음수면 개선
   */
  recall: Record<number, number>;
  
  /**
   * NDCG@K 저하율 (K 값별, 0-1)
   * 양수면 저하, 음수면 개선
   */
  ndcg: Record<number, number>;
}

/**
 * 품질 저하율 계산
 * 벡터-only 품질과 Consolidation 반영 후 품질을 비교하여 저하율을 계산합니다.
 * 
 * 저하율 공식: (vectorOnly - consolidation) / vectorOnly
 * - 양수: 품질 저하
 * - 음수: 품질 개선
 * - 0: 변화 없음
 * 
 * @param vectorOnlyMetrics 벡터-only 품질 지표
 * @param consolidationMetrics Consolidation 반영 후 품질 지표
 * @param kValues 계산할 K 값 배열 (기본값: [1, 5, 10])
 * @returns 품질 저하율 (K 값별)
 * 
 * @example
 * ```typescript
 * const vectorOnlyMetrics = measureVectorOnlyQuality(vectorOnlyResults, groundTruth);
 * const consolidationMetrics = measureConsolidationQuality(consolidationResults, groundTruth);
 * const degradation = calculateQualityDegradation(vectorOnlyMetrics, consolidationMetrics);
 * console.log(`NDCG@5 저하율: ${(degradation.ndcg[5] * 100).toFixed(2)}%`);
 * ```
 */
export function calculateQualityDegradation(
  vectorOnlyMetrics: QualityMetrics,
  consolidationMetrics: QualityMetrics,
  kValues: number[] = [1, 5, 10]
): QualityDegradation {
  const degradation: QualityDegradation = {
    precision: {},
    recall: {},
    ndcg: {}
  };

  kValues.forEach(k => {
    const vectorPrecision = vectorOnlyMetrics.precision[k] || 0;
    const consolidationPrecision = consolidationMetrics.precision[k] || 0;
    
    const vectorRecall = vectorOnlyMetrics.recall[k] || 0;
    const consolidationRecall = consolidationMetrics.recall[k] || 0;
    
    const vectorNDCG = vectorOnlyMetrics.ndcg[k] || 0;
    const consolidationNDCG = consolidationMetrics.ndcg[k] || 0;

    // 저하율 계산: (vectorOnly - consolidation) / vectorOnly
    // vectorOnly가 0이면 저하율을 0으로 처리 (나눗셈 방지)
    degradation.precision[k] = vectorPrecision > 0
      ? (vectorPrecision - consolidationPrecision) / vectorPrecision
      : 0;
    
    degradation.recall[k] = vectorRecall > 0
      ? (vectorRecall - consolidationRecall) / vectorRecall
      : 0;
    
    degradation.ndcg[k] = vectorNDCG > 0
      ? (vectorNDCG - consolidationNDCG) / vectorNDCG
      : 0;
  });

  return degradation;
}

/**
 * 품질 저하 임계값 검증 결과
 */
export interface QualityThresholdValidation {
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
     * NDCG@5 저하율 < 5% 검증
     */
    ndcg5Valid: boolean;
    
    /**
     * Precision@5 저하율 < 10% 검증
     */
    precision5Valid: boolean;
    
    /**
     * Recall@5 저하율 < 10% 검증
     */
    recall5Valid: boolean;
  };
  
  /**
   * 실제 저하율 값
   */
  degradation: {
    ndcg5: number;
    precision5: number;
    recall5: number;
  };
}

/**
 * 품질 저하 임계값 검증
 * 품질 저하율이 임계값을 초과하지 않는지 검증합니다.
 * 
 * Acceptance Criteria:
 * - NDCG@5 저하율 < 5%
 * - Precision@5 저하율 < 10%
 * - Recall@5 저하율 < 10%
 * 
 * @param degradation 품질 저하율
 * @param options 검증 옵션
 * @param options.ndcg5Threshold NDCG@5 저하율 임계값 (기본값: 0.05 = 5%)
 * @param options.precision5Threshold Precision@5 저하율 임계값 (기본값: 0.10 = 10%)
 * @param options.recall5Threshold Recall@5 저하율 임계값 (기본값: 0.10 = 10%)
 * @returns 검증 결과
 * 
 * @example
 * ```typescript
 * const degradation = calculateQualityDegradation(vectorOnlyMetrics, consolidationMetrics);
 * const validation = validateQualityThresholds(degradation);
 * if (!validation.passed) {
 *   console.error('품질 저하 임계값 초과:', validation.failureReasons);
 * }
 * ```
 */
export function validateQualityThresholds(
  degradation: QualityDegradation,
  options: {
    ndcg5Threshold?: number;
    precision5Threshold?: number;
    recall5Threshold?: number;
  } = {}
): QualityThresholdValidation {
  const {
    ndcg5Threshold = 0.05, // 5%
    precision5Threshold = 0.10, // 10%
    recall5Threshold = 0.10 // 10%
  } = options;

  // 저하율은 양수일 때 저하를 의미하므로, 절댓값을 사용하여 비교
  const ndcg5Degradation = Math.abs(degradation.ndcg[5] || 0);
  const precision5Degradation = Math.abs(degradation.precision[5] || 0);
  const recall5Degradation = Math.abs(degradation.recall[5] || 0);

  // 검증 수행
  const ndcg5Valid = ndcg5Degradation < ndcg5Threshold;
  const precision5Valid = precision5Degradation < precision5Threshold;
  const recall5Valid = recall5Degradation < recall5Threshold;

  // 전체 검증 통과 여부
  const passed = ndcg5Valid && precision5Valid && recall5Valid;

  // 실패 사유 수집
  const failureReasons: string[] = [];
  if (!ndcg5Valid) {
    failureReasons.push(
      `NDCG@5 저하율 (${(ndcg5Degradation * 100).toFixed(2)}%) >= 임계값 (${(ndcg5Threshold * 100).toFixed(1)}%)`
    );
  }
  if (!precision5Valid) {
    failureReasons.push(
      `Precision@5 저하율 (${(precision5Degradation * 100).toFixed(2)}%) >= 임계값 (${(precision5Threshold * 100).toFixed(1)}%)`
    );
  }
  if (!recall5Valid) {
    failureReasons.push(
      `Recall@5 저하율 (${(recall5Degradation * 100).toFixed(2)}%) >= 임계값 (${(recall5Threshold * 100).toFixed(1)}%)`
    );
  }

  return {
    passed,
    failureReasons: passed ? undefined : failureReasons,
    validation: {
      ndcg5Valid,
      precision5Valid,
      recall5Valid
    },
    degradation: {
      ndcg5: degradation.ndcg[5] || 0,
      precision5: degradation.precision[5] || 0,
      recall5: degradation.recall[5] || 0
    }
  };
}

/**
 * Ground Truth 기반 품질 비교 결과
 */
export interface QualityComparison {
  /**
   * 벡터-only 품질 지표
   */
  vectorOnly: QualityMetrics;
  
  /**
   * Consolidation 반영 후 품질 지표
   */
  consolidation: QualityMetrics;
  
  /**
   * 품질 저하율
   */
  degradation: QualityDegradation;
  
  /**
   * 품질 저하 임계값 검증 결과
   */
  thresholdValidation: QualityThresholdValidation;
}

/**
 * Ground Truth 기반 품질 비교
 * 벡터-only 결과와 Consolidation 반영 후 결과를 Ground Truth와 비교하여 품질을 측정하고 비교합니다.
 * 
 * @param vectorOnlyResults 벡터 유사도만으로 정렬된 검색 결과
 * @param consolidationResults Consolidation 점수 반영 후 정렬된 검색 결과
 * @param groundTruth Ground Truth (관련 결과 ID 목록)
 * @param kValues 계산할 K 값 배열 (기본값: [1, 5, 10])
 * @param thresholdOptions 품질 저하 임계값 검증 옵션
 * @returns 품질 비교 결과
 * 
 * @example
 * ```typescript
 * const vectorOnlyResults = generateVectorOnlySearchResults(searchResults);
 * const consolidationResults = generateConsolidationSearchResults(searchResults);
 * const groundTruth = { queryId: 'query1', relevantIds: ['id1', 'id2', 'id3'] };
 * const comparison = compareQualityWithGroundTruth(
 *   vectorOnlyResults,
 *   consolidationResults,
 *   groundTruth
 * );
 * console.log(`벡터-only NDCG@5: ${comparison.vectorOnly.ndcg[5]}`);
 * console.log(`Consolidation NDCG@5: ${comparison.consolidation.ndcg[5]}`);
 * console.log(`검증 통과: ${comparison.thresholdValidation.passed}`);
 * ```
 */
export function compareQualityWithGroundTruth(
  vectorOnlyResults: SearchResult[],
  consolidationResults: SearchResult[],
  groundTruth: { queryId: string; relevantIds: string[] },
  kValues: number[] = [1, 5, 10],
  thresholdOptions: {
    ndcg5Threshold?: number;
    precision5Threshold?: number;
    recall5Threshold?: number;
  } = {}
): QualityComparison {
  // 벡터-only 품질 측정
  const vectorOnlyMetrics = measureVectorOnlyQuality(
    vectorOnlyResults,
    groundTruth,
    kValues
  );

  // Consolidation 반영 후 품질 측정
  const consolidationMetrics = measureConsolidationQuality(
    consolidationResults,
    groundTruth,
    kValues
  );

  // 품질 저하율 계산
  const degradation = calculateQualityDegradation(
    vectorOnlyMetrics,
    consolidationMetrics,
    kValues
  );

  // 품질 저하 임계값 검증
  const thresholdValidation = validateQualityThresholds(
    degradation,
    thresholdOptions
  );

  return {
    vectorOnly: vectorOnlyMetrics,
    consolidation: consolidationMetrics,
    degradation,
    thresholdValidation
  };
}

/**
 * 품질 비교 결과 리포트
 */
export interface QualityComparisonReport {
  /**
   * 리포트 생성 시간
   */
  timestamp: string;
  
  /**
   * Ground Truth 정보
   */
  groundTruth: {
    queryId: string;
    relevantIdsCount: number;
  };
  
  /**
   * 벡터-only 품질 지표
   */
  vectorOnly: QualityMetrics;
  
  /**
   * Consolidation 반영 후 품질 지표
   */
  consolidation: QualityMetrics;
  
  /**
   * 품질 저하율
   */
  degradation: QualityDegradation;
  
  /**
   * 품질 저하 임계값 검증 결과
   */
  thresholdValidation: QualityThresholdValidation;
  
  /**
   * 요약 정보
   */
  summary: {
    /**
     * 검증 통과 여부
     */
    passed: boolean;
    
    /**
     * 주요 지표 요약 (K=5 기준)
     */
    keyMetrics: {
      vectorOnlyNDCG5: number;
      consolidationNDCG5: number;
      ndcg5Degradation: number;
    };
  };
}

/**
 * 품질 비교 결과 리포트 생성
 * Ground Truth 기반 품질 비교 결과를 구조화된 리포트 형식으로 생성합니다.
 * 
 * @param comparison 품질 비교 결과
 * @param groundTruth Ground Truth 정보
 * @returns 품질 비교 결과 리포트
 * 
 * @example
 * ```typescript
 * const comparison = compareQualityWithGroundTruth(
 *   vectorOnlyResults,
 *   consolidationResults,
 *   groundTruth
 * );
 * const report = generateQualityComparisonReport(comparison, groundTruth);
 * console.log(JSON.stringify(report, null, 2));
 * ```
 */
export function generateQualityComparisonReport(
  comparison: QualityComparison,
  groundTruth: { queryId: string; relevantIds: string[] }
): QualityComparisonReport {
  const report: QualityComparisonReport = {
    timestamp: new Date().toISOString(),
    groundTruth: {
      queryId: groundTruth.queryId,
      relevantIdsCount: groundTruth.relevantIds.length
    },
    vectorOnly: comparison.vectorOnly,
    consolidation: comparison.consolidation,
    degradation: comparison.degradation,
    thresholdValidation: comparison.thresholdValidation,
    summary: {
      passed: comparison.thresholdValidation.passed,
      keyMetrics: {
        vectorOnlyNDCG5: comparison.vectorOnly.ndcg[5] || 0,
        consolidationNDCG5: comparison.consolidation.ndcg[5] || 0,
        ndcg5Degradation: Math.abs(comparison.degradation.ndcg[5] || 0)
      }
    }
  };

  return report;
}

/**
 * 품질 비교 결과 시각화
 * 품질 비교 결과를 Markdown 표 형식으로 시각화합니다.
 * 
 * @param report 품질 비교 결과 리포트
 * @param options 시각화 옵션
 * @param options.kValues 표시할 K 값 배열 (기본값: [1, 5, 10])
 * @param options.includeDegradation 저하율 포함 여부 (기본값: true)
 * @returns Markdown 형식의 시각화된 리포트
 * 
 * @example
 * ```typescript
 * const report = generateQualityComparisonReport(comparison, groundTruth);
 * const visualization = visualizeQualityComparison(report);
 * console.log(visualization);
 * ```
 */
export function visualizeQualityComparison(
  report: QualityComparisonReport,
  options: {
    kValues?: number[];
    includeDegradation?: boolean;
  } = {}
): string {
  const {
    kValues = [1, 5, 10],
    includeDegradation = true
  } = options;

  const lines: string[] = [];
  
  // 헤더
  lines.push('# 품질 비교 결과 리포트');
  lines.push('');
  lines.push(`**생성 시간**: ${report.timestamp}`);
  lines.push(`**쿼리 ID**: ${report.groundTruth.queryId}`);
  lines.push(`**관련 결과 수**: ${report.groundTruth.relevantIdsCount}`);
  lines.push(`**검증 통과**: ${report.summary.passed ? '[PASS] 통과' : '[FAIL] 실패'}`);
  lines.push('');

  // 주요 지표 요약
  lines.push('## 주요 지표 요약 (K=5)');
  lines.push('');
  lines.push('| 지표 | 벡터-only | Consolidation | 저하율 |');
  lines.push('|------|-----------|---------------|--------|');
  const ndcg5 = report.summary.keyMetrics;
  const ndcg5DegradationPercent = (ndcg5.ndcg5Degradation * 100).toFixed(2);
  lines.push(`| NDCG@5 | ${ndcg5.vectorOnlyNDCG5.toFixed(3)} | ${ndcg5.consolidationNDCG5.toFixed(3)} | ${ndcg5DegradationPercent}% |`);
  lines.push('');

  // 상세 품질 지표 표
  lines.push('## 상세 품질 지표');
  lines.push('');
  
  // Precision 표
  lines.push('### Precision@K');
  lines.push('');
  lines.push('| K | 벡터-only | Consolidation |' + (includeDegradation ? ' 저하율 |' : ''));
  lines.push('|---|-----------|---------------|' + (includeDegradation ? '--------|' : ''));
  kValues.forEach(k => {
    const vectorPrecision = report.vectorOnly.precision[k] || 0;
    const consolidationPrecision = report.consolidation.precision[k] || 0;
    const degradation = report.degradation.precision[k] || 0;
    const degradationPercent = (Math.abs(degradation) * 100).toFixed(2);
    const degradationSign = degradation >= 0 ? '' : '+';
    
    if (includeDegradation) {
      lines.push(`| ${k} | ${vectorPrecision.toFixed(3)} | ${consolidationPrecision.toFixed(3)} | ${degradationSign}${degradationPercent}% |`);
    } else {
      lines.push(`| ${k} | ${vectorPrecision.toFixed(3)} | ${consolidationPrecision.toFixed(3)} |`);
    }
  });
  lines.push('');

  // Recall 표
  lines.push('### Recall@K');
  lines.push('');
  lines.push('| K | 벡터-only | Consolidation |' + (includeDegradation ? ' 저하율 |' : ''));
  lines.push('|---|-----------|---------------|' + (includeDegradation ? '--------|' : ''));
  kValues.forEach(k => {
    const vectorRecall = report.vectorOnly.recall[k] || 0;
    const consolidationRecall = report.consolidation.recall[k] || 0;
    const degradation = report.degradation.recall[k] || 0;
    const degradationPercent = (Math.abs(degradation) * 100).toFixed(2);
    const degradationSign = degradation >= 0 ? '' : '+';
    
    if (includeDegradation) {
      lines.push(`| ${k} | ${vectorRecall.toFixed(3)} | ${consolidationRecall.toFixed(3)} | ${degradationSign}${degradationPercent}% |`);
    } else {
      lines.push(`| ${k} | ${vectorRecall.toFixed(3)} | ${consolidationRecall.toFixed(3)} |`);
    }
  });
  lines.push('');

  // NDCG 표
  lines.push('### NDCG@K');
  lines.push('');
  lines.push('| K | 벡터-only | Consolidation |' + (includeDegradation ? ' 저하율 |' : ''));
  lines.push('|---|-----------|---------------|' + (includeDegradation ? '--------|' : ''));
  kValues.forEach(k => {
    const vectorNDCG = report.vectorOnly.ndcg[k] || 0;
    const consolidationNDCG = report.consolidation.ndcg[k] || 0;
    const degradation = report.degradation.ndcg[k] || 0;
    const degradationPercent = (Math.abs(degradation) * 100).toFixed(2);
    const degradationSign = degradation >= 0 ? '' : '+';
    
    if (includeDegradation) {
      lines.push(`| ${k} | ${vectorNDCG.toFixed(3)} | ${consolidationNDCG.toFixed(3)} | ${degradationSign}${degradationPercent}% |`);
    } else {
      lines.push(`| ${k} | ${vectorNDCG.toFixed(3)} | ${consolidationNDCG.toFixed(3)} |`);
    }
  });
  lines.push('');

  // 검증 결과
  lines.push('## 검증 결과');
  lines.push('');
  const validation = report.thresholdValidation;
  lines.push('| 지표 | 임계값 | 실제 값 | 상태 |');
  lines.push('|------|--------|---------|------|');
  
  const ndcg5Deg = Math.abs(validation.degradation.ndcg5);
  const precision5Deg = Math.abs(validation.degradation.precision5);
  const recall5Deg = Math.abs(validation.degradation.recall5);
  
  const ndcg5Status = validation.validation.ndcg5Valid ? '[PASS] 통과' : '[FAIL] 실패';
  const precision5Status = validation.validation.precision5Valid ? '[PASS] 통과' : '[FAIL] 실패';
  const recall5Status = validation.validation.recall5Valid ? '[PASS] 통과' : '[FAIL] 실패';
  
  lines.push(`| NDCG@5 저하율 | < 5% | ${(ndcg5Deg * 100).toFixed(2)}% | ${ndcg5Status} |`);
  lines.push(`| Precision@5 저하율 | < 10% | ${(precision5Deg * 100).toFixed(2)}% | ${precision5Status} |`);
  lines.push(`| Recall@5 저하율 | < 10% | ${(recall5Deg * 100).toFixed(2)}% | ${recall5Status} |`);
  lines.push('');

  // 실패 사유
  if (validation.failureReasons && validation.failureReasons.length > 0) {
    lines.push('### 실패 사유');
    lines.push('');
    validation.failureReasons.forEach(reason => {
      lines.push(`- [FAIL] ${reason}`);
    });
    lines.push('');
  }

  return lines.join('\n');
}
