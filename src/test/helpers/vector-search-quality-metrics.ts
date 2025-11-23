/**
 * 벡터 검색 품질 검증 헬퍼
 * 벡터 검색 결과 순서 보존 검증 및 품질 지표 비교
 * Consolidation 점수 반영 전/후 비교를 위한 지표 계산
 */

import type { SearchResult } from './search-quality-metrics.js';
import type { HybridSearchResult } from '../../algorithms/hybrid-search-engine.js';

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
