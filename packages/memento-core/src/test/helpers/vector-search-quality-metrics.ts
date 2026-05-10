/**
 * 벡터 검색 품질 검증 헬퍼
 * 벡터 검색 결과 순서 보존 검증 및 품질 지표 비교
 * Consolidation 점수 반영 전/후 비교를 위한 지표 계산
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { SearchResult, GroundTruth } from './search-quality-metrics.js';
import {
  assertStrictBenchmark,
  DEFAULT_SEARCH_BENCHMARK_DIR,
  loadBenchmarkGroundTruth,
  loadBenchmarkManifest,
} from './search-quality-benchmark-fixtures.js';
import type { HybridSearchResult } from '@memento/core/domains/search/algorithms/hybrid-search-engine.js';
import {
  calculatePrecisionAtK,
  calculateRecallAtK,
  calculateNDCGAtK
} from './search-quality-metrics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

function buildKendallPositionMaps(
  order1: string[],
  order2: string[]
): { position1: Map<string, number>; position2: Map<string, number> } {
  const set1 = new Set(order1);
  const set2 = new Set(order2);
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

  return { position1, position2 };
}

type KendallPairBucket = 'concordant' | 'discordant' | 'tiedX' | 'tiedY' | 'tiedXY';

function tallyKendallPairBucket(sign1: number, sign2: number): KendallPairBucket {
  if (sign1 === 0 && sign2 === 0) {
    return 'tiedXY';
  }
  if (sign1 === 0) {
    return 'tiedX';
  }
  if (sign2 === 0) {
    return 'tiedY';
  }
  if (sign1 === sign2) {
    return 'concordant';
  }
  return 'discordant';
}

function countKendallTauBPairCategories(
  commonIds: string[],
  position1: Map<string, number>,
  position2: Map<string, number>
): { concordant: number; discordant: number; tiedX: number; tiedY: number; tiedXY: number } {
  const tallies = { concordant: 0, discordant: 0, tiedX: 0, tiedY: 0, tiedXY: 0 };
  const n = commonIds.length;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const idI = commonIds[i];
      const idJ = commonIds[j];
      if (idI === undefined || idJ === undefined) {
        continue;
      }

      const pos1I = position1.get(idI);
      const pos1J = position1.get(idJ);
      const pos2I = position2.get(idI);
      const pos2J = position2.get(idJ);
      if (pos1I === undefined || pos1J === undefined || pos2I === undefined || pos2J === undefined) {
        continue;
      }

      const sign1 = pos1I < pos1J ? 1 : pos1I > pos1J ? -1 : 0;
      const sign2 = pos2I < pos2J ? 1 : pos2I > pos2J ? -1 : 0;
      const bucket = tallyKendallPairBucket(sign1, sign2);
      tallies[bucket]++;
    }
  }

  return tallies;
}

function computeKendallTauBFromPairCounts(counts: {
  concordant: number;
  discordant: number;
  tiedX: number;
  tiedY: number;
}): number {
  const { concordant, discordant, tiedX, tiedY } = counts;
  const numerator = concordant - discordant;
  const denominatorX = concordant + discordant + tiedX;
  const denominatorY = concordant + discordant + tiedY;
  const denominator = Math.sqrt(denominatorX * denominatorY);

  if (denominator === 0) {
    return 0;
  }

  return numerator / denominator;
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
  if (order1.length === 0 || order2.length === 0) {
    return 0;
  }

  const set2 = new Set(order2);
  const commonIds = order1.filter((id) => set2.has(id));

  if (commonIds.length < 2) {
    return 0;
  }

  const { position1, position2 } = buildKendallPositionMaps(order1, order2);
  const counts = countKendallTauBPairCategories(commonIds, position1, position2);
  return computeKendallTauBFromPairCounts(counts);
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

function firstFiniteNumber(...values: Array<number | undefined | null>): number {
  for (const v of values) {
    if (v !== undefined && v !== null && !isNaN(v)) {
      return v;
    }
  }
  return 0;
}

function pickVectorOnlyComparableScore(result: HybridSearchResult): number {
  return firstFiniteNumber(result.vectorScore, result.finalScore, result.textScore);
}

function pickConsolidationComparableScore(result: HybridSearchResult): number {
  return firstFiniteNumber(result.finalScore, result.vectorScore, result.textScore);
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
  const vectorOnlyResults = searchResults
    .map((result) => {
      const vectorScore = pickVectorOnlyComparableScore(result);
      return {
        id: result.id,
        score: vectorScore,
        finalScore: vectorScore,
        relevance: vectorScore
      };
    })
    .filter((result) => result.score !== undefined && result.score !== null && !isNaN(result.score))
    .sort((a, b) => (b.score || 0) - (a.score || 0));

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
  const consolidationResults = searchResults
    .map((result) => {
      const finalScore = pickConsolidationComparableScore(result);
      return {
        id: result.id,
        score: finalScore,
        finalScore,
        relevance: result.vectorScore || result.textScore || 0
      };
    })
    .filter((result) => result.score !== undefined && result.score !== null && !isNaN(result.score))
    .sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));

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
    top10Retention,
    top5Retention,
    totalResults: Math.max(pair.vectorOnly.length, pair.withConsolidation.length)
  };

  // 리포트 생성
  const report: OrderPreservationReport = {
    timestamp: new Date().toISOString(),
    metrics,
    passed,
    failureReasons: passed ? undefined : failureReasons,
    validation: {
      kendallTauValid,
      top10RetentionValid,
      top5RetentionValid
    },
    thresholds: {
      kendallTauThreshold,
      top10RetentionThreshold,
      top5RetentionThreshold
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
  withConsolidation: QualityMetrics;
  
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
    withConsolidation: comparison.consolidation,
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
    const consolidationPrecision = report.withConsolidation.precision[k] || 0;
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
    const consolidationRecall = report.withConsolidation.recall[k] || 0;
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
    const consolidationNDCG = report.withConsolidation.ndcg[k] || 0;
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

/**
 * 극단적 시나리오 검증 결과
 */
export interface ExtremeScenarioValidation {
  /**
   * 검증 통과 여부
   */
  passed: boolean;
  
  /**
   * 검증 실패 사유 (통과 시 undefined)
   */
  failureReasons?: string[];
  
  /**
   * 최종 점수 범위
   */
  finalScoreRange: {
    min: number;
    max: number;
    average: number;
  };
  
  /**
   * 벡터 유사도 통계
   */
  vectorSimilarityStats: {
    min: number;
    max: number;
    average: number;
  };
  
  /**
   * Consolidation 점수 통계
   */
  consolidationScoreStats: {
    min: number;
    max: number;
    average: number;
  };
}

/**
 * 저벡터 유사도 + 고 consolidation 점수 시나리오 검증
 * 벡터 유사도는 낮지만 consolidation 점수가 매우 높은 경우의 랭킹을 검증합니다.
 * 
 * 예: 벡터 유사도 0.3, consolidation 0.9
 * 최종 점수가 합리적인 범위 내인지 검증합니다.
 * 
 * @param results 검색 결과 (HybridSearchResult 배열)
 * @param options 검증 옵션
 * @param options.lowVectorThreshold 저벡터 유사도 임계값 (기본값: 0.4)
 * @param options.highConsolidationThreshold 고 consolidation 점수 임계값 (기본값: 0.7)
 * @param options.minFinalScore 최종 점수 최소값 (기본값: 0.0)
 * @param options.maxFinalScore 최종 점수 최대값 (기본값: 1.0)
 * @returns 검증 결과
 * 
 * @example
 * ```typescript
 * const results = await hybridSearchEngine.search(query, options);
 * const validation = validateLowVectorHighConsolidation(results);
 * if (!validation.passed) {
 *   console.error('극단적 시나리오 검증 실패:', validation.failureReasons);
 * }
 * ```
 */
export function validateLowVectorHighConsolidation(
  results: HybridSearchResult[],
  options: {
    lowVectorThreshold?: number;
    highConsolidationThreshold?: number;
    minFinalScore?: number;
    maxFinalScore?: number;
  } = {}
): ExtremeScenarioValidation {
  const {
    lowVectorThreshold = 0.4,
    highConsolidationThreshold = 0.7,
    minFinalScore = 0.0,
    maxFinalScore = 1.0
  } = options;

  // 저벡터 유사도 + 고 consolidation 점수 조합 필터링
  const extremeResults = results.filter(result => {
    const vectorScore = result.vectorScore || 0;
    const consolidationScore = result.consolidation_score || 0;
    return vectorScore < lowVectorThreshold && consolidationScore >= highConsolidationThreshold;
  });

  if (extremeResults.length === 0) {
    return {
      passed: true,
      finalScoreRange: { min: 0, max: 0, average: 0 },
      vectorSimilarityStats: { min: 0, max: 0, average: 0 },
      consolidationScoreStats: { min: 0, max: 0, average: 0 }
    };
  }

  // 통계 계산
  const finalScores = extremeResults.map(r => r.finalScore || 0);
  const vectorScores = extremeResults.map(r => r.vectorScore || 0);
  const consolidationScores = extremeResults.map(r => r.consolidation_score || 0);

  const finalScoreRange = {
    min: Math.min(...finalScores),
    max: Math.max(...finalScores),
    average: finalScores.reduce((sum, score) => sum + score, 0) / finalScores.length
  };

  const vectorSimilarityStats = {
    min: Math.min(...vectorScores),
    max: Math.max(...vectorScores),
    average: vectorScores.reduce((sum, score) => sum + score, 0) / vectorScores.length
  };

  const consolidationScoreStats = {
    min: Math.min(...consolidationScores),
    max: Math.max(...consolidationScores),
    average: consolidationScores.reduce((sum, score) => sum + score, 0) / consolidationScores.length
  };

  // 검증 수행: 최종 점수가 합리적인 범위 내인지 확인
  const passed = finalScoreRange.min >= minFinalScore && finalScoreRange.max <= maxFinalScore;

  const failureReasons: string[] = [];
  if (finalScoreRange.min < minFinalScore) {
    failureReasons.push(
      `최종 점수 최소값 (${finalScoreRange.min.toFixed(3)}) < 임계값 (${minFinalScore})`
    );
  }
  if (finalScoreRange.max > maxFinalScore) {
    failureReasons.push(
      `최종 점수 최대값 (${finalScoreRange.max.toFixed(3)}) > 임계값 (${maxFinalScore})`
    );
  }

  return {
    passed,
    failureReasons: passed ? undefined : failureReasons,
    finalScoreRange,
    vectorSimilarityStats,
    consolidationScoreStats
  };
}

/**
 * 고벡터 유사도 + 저 consolidation 점수 시나리오 검증
 * 벡터 유사도는 높지만 consolidation 점수가 낮은 경우의 랭킹을 검증합니다.
 * 
 * 예: 벡터 유사도 0.9, consolidation 0.1
 * 벡터 유사도가 우선 반영되는지 검증합니다.
 * 
 * @param results 검색 결과 (HybridSearchResult 배열)
 * @param options 검증 옵션
 * @param options.highVectorThreshold 고벡터 유사도 임계값 (기본값: 0.7)
 * @param options.lowConsolidationThreshold 저 consolidation 점수 임계값 (기본값: 0.3)
 * @param options.vectorPriorityRatio 벡터 유사도가 최종 점수에 미치는 최소 영향 비율 (기본값: 0.6)
 * @returns 검증 결과
 * 
 * @example
 * ```typescript
 * const results = await hybridSearchEngine.search(query, options);
 * const validation = validateHighVectorLowConsolidation(results);
 * if (!validation.passed) {
 *   console.error('극단적 시나리오 검증 실패:', validation.failureReasons);
 * }
 * ```
 */
export function validateHighVectorLowConsolidation(
  results: HybridSearchResult[],
  options: {
    highVectorThreshold?: number;
    lowConsolidationThreshold?: number;
    vectorPriorityRatio?: number;
  } = {}
): ExtremeScenarioValidation {
  const {
    highVectorThreshold = 0.7,
    lowConsolidationThreshold = 0.3,
    vectorPriorityRatio = 0.6 // 벡터 유사도가 최종 점수의 최소 60%를 차지해야 함
  } = options;

  // 고벡터 유사도 + 저 consolidation 점수 조합 필터링
  const extremeResults = results.filter(result => {
    const vectorScore = result.vectorScore || 0;
    const consolidationScore = result.consolidation_score || 0;
    return vectorScore >= highVectorThreshold && consolidationScore < lowConsolidationThreshold;
  });

  if (extremeResults.length === 0) {
    return {
      passed: true,
      finalScoreRange: { min: 0, max: 0, average: 0 },
      vectorSimilarityStats: { min: 0, max: 0, average: 0 },
      consolidationScoreStats: { min: 0, max: 0, average: 0 }
    };
  }

  // 통계 계산
  const finalScores = extremeResults.map(r => r.finalScore || 0);
  const vectorScores = extremeResults.map(r => r.vectorScore || 0);
  const consolidationScores = extremeResults.map(r => r.consolidation_score || 0);

  const finalScoreRange = {
    min: Math.min(...finalScores),
    max: Math.max(...finalScores),
    average: finalScores.reduce((sum, score) => sum + score, 0) / finalScores.length
  };

  const vectorSimilarityStats = {
    min: Math.min(...vectorScores),
    max: Math.max(...vectorScores),
    average: vectorScores.reduce((sum, score) => sum + score, 0) / vectorScores.length
  };

  const consolidationScoreStats = {
    min: Math.min(...consolidationScores),
    max: Math.max(...consolidationScores),
    average: consolidationScores.reduce((sum, score) => sum + score, 0) / consolidationScores.length
  };

  // 검증 수행: 벡터 유사도가 최종 점수에 충분히 반영되는지 확인
  // 최종 점수는 벡터 유사도에 비례해야 함 (w1 >= vectorPriorityRatio)
  // 실제로는 finalScore = w1 * vectorScore + w2 * consolidationScore
  // 벡터 유사도가 우선 반영되려면 finalScore가 vectorScore에 가까워야 함
  const passed = extremeResults.every(result => {
    const vectorScore = result.vectorScore || 0;
    const finalScore = result.finalScore || 0;
    
    // 벡터 유사도가 높은 경우, 최종 점수도 상대적으로 높아야 함
    // 벡터 유사도가 최종 점수의 최소 vectorPriorityRatio 비율을 차지해야 함
    if (vectorScore === 0) return true; // 벡터 점수가 0이면 검증 불가
    
    // 최종 점수가 벡터 유사도의 vectorPriorityRatio 이상이어야 함
    // (최종 점수 / 벡터 유사도) >= vectorPriorityRatio
    const scoreRatio = finalScore / vectorScore;
    return scoreRatio >= vectorPriorityRatio;
  });

  const failureReasons: string[] = [];
  if (!passed) {
    const failedResults = extremeResults.filter(result => {
      const vectorScore = result.vectorScore || 0;
      const finalScore = result.finalScore || 0;
      if (vectorScore === 0) return false;
      const scoreRatio = finalScore / vectorScore;
      return scoreRatio < vectorPriorityRatio;
    });
    
    failureReasons.push(
      `${failedResults.length}개 결과에서 벡터 유사도가 최종 점수에 충분히 반영되지 않음 (최소 비율: ${(vectorPriorityRatio * 100).toFixed(0)}%)`
    );
  }

  return {
    passed,
    failureReasons: passed ? undefined : failureReasons,
    finalScoreRange,
    vectorSimilarityStats,
    consolidationScoreStats
  };
}

/**
 * w2 상한 검증 결과
 */
export interface W2UpperBoundValidation {
  /**
   * 검증 통과 여부
   */
  passed: boolean;
  
  /**
   * 검증 실패 사유 (통과 시 undefined)
   */
  failureReasons?: string[];
  
  /**
   * w2=0.4일 때 품질 지표
   */
  w2_04: QualityMetrics;
  
  /**
   * w2=0.6일 때 품질 지표
   */
  w2_06: QualityMetrics;
  
  /**
   * 품질 저하율 (w2=0.4 대비 w2=0.6)
   */
  degradation: QualityDegradation;
  
  /**
   * w2 상한이 품질을 보호하는지 여부
   */
  w2UpperBoundProtects: boolean;
}

/**
 * w2 상한(0.4) 검증
 * w2=0.4일 때와 w2=0.6일 때의 품질을 비교하여 w2 상한이 벡터 검색 품질을 보호하는지 검증합니다.
 * 
 * w2가 높을수록 consolidation 점수의 영향이 커지므로, w2=0.6일 때 품질이 저하되는지 확인합니다.
 * 
 * @param originalResults 원본 검색 결과 (HybridSearchResult 배열, vectorScore와 consolidation_score 포함)
 * @param groundTruth Ground Truth
 * @param kValues 계산할 K 값 배열 (기본값: [1, 5, 10])
 * @returns 검증 결과
 * 
 * @example
 * ```typescript
 * const results = await hybridSearchEngine.search(query, options);
 * const validation = validateW2UpperBound(results, groundTruth);
 * console.log(`w2 상한 보호: ${validation.w2UpperBoundProtects}`);
 * ```
 */
export function validateW2UpperBound(
  originalResults: HybridSearchResult[],
  groundTruth: { queryId: string; relevantIds: string[] },
  kValues: number[] = [1, 5, 10]
): W2UpperBoundValidation {
  // w2=0.4일 때 최종 점수 재계산
  // finalScore = w1 * vectorScore + w2 * consolidationScore
  // w2=0.4일 때: w1=0.6, w2=0.4
  const w2_04_results: SearchResult[] = originalResults
    .filter(r => r.vectorScore !== undefined && r.consolidation_score !== undefined)
    .map(r => {
      const w1 = 0.6;
      const w2 = 0.4;
      const finalScore = w1 * (r.vectorScore || 0) + w2 * (r.consolidation_score || 0);
      return {
        id: r.id,
        score: finalScore,
        finalScore: finalScore,
        relevance: r.vectorScore || 0
      };
    })
    .sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));

  // w2=0.6일 때 최종 점수 재계산
  // w2=0.6일 때: w1=0.4, w2=0.6
  const w2_06_results: SearchResult[] = originalResults
    .filter(r => r.vectorScore !== undefined && r.consolidation_score !== undefined)
    .map(r => {
      const w1 = 0.4;
      const w2 = 0.6;
      const finalScore = w1 * (r.vectorScore || 0) + w2 * (r.consolidation_score || 0);
      return {
        id: r.id,
        score: finalScore,
        finalScore: finalScore,
        relevance: r.vectorScore || 0
      };
    })
    .sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));

  // w2=0.4일 때 품질 측정
  const w2_04_metrics = measureConsolidationQuality(
    w2_04_results,
    groundTruth,
    kValues
  );

  // w2=0.6일 때 품질 측정
  const w2_06_metrics = measureConsolidationQuality(
    w2_06_results,
    groundTruth,
    kValues
  );

  // w2=0.4 대비 w2=0.6의 품질 저하율 계산
  const degradation_w2_06_vs_04 = calculateQualityDegradation(
    w2_04_metrics,
    w2_06_metrics,
    kValues
  );

  // w2 상한이 품질을 보호하는지 검증
  // w2=0.6일 때 w2=0.4 대비 실제 품질 저하가 발생하는지 확인
  // NDCG@5 저하율이 5% 이상이면 w2 상한이 필요함
  // 주의: degradation 값이 양수면 저하, 음수면 개선이므로 실제 저하만 확인
  const ndcg5Degradation = degradation_w2_06_vs_04.ndcg[5] || 0;
  const w2UpperBoundProtects = ndcg5Degradation >= 0.05;

  const passed = w2UpperBoundProtects;

  const failureReasons: string[] = [];
  if (!w2UpperBoundProtects) {
    const degradationPercent = ndcg5Degradation >= 0 
      ? `${(ndcg5Degradation * 100).toFixed(2)}%`
      : `개선 ${(Math.abs(ndcg5Degradation) * 100).toFixed(2)}%`;
    failureReasons.push(
      `w2=0.6일 때 w2=0.4 대비 NDCG@5 변화 (${degradationPercent}) < 5% 저하 - w2 상한의 필요성이 낮음`
    );
  }

  return {
    passed,
    failureReasons: passed ? undefined : failureReasons,
    w2_04: w2_04_metrics,
    w2_06: w2_06_metrics,
    degradation: degradation_w2_06_vs_04,
    w2UpperBoundProtects
  };
}

/**
 * 극단적 시나리오 검증 결과 리포트
 */
export interface ExtremeScenarioReport {
  /**
   * 리포트 생성 시간
   */
  timestamp: string;
  
  /**
   * 저벡터 유사도 + 고 consolidation 점수 검증 결과
   */
  lowVectorHighConsolidation: ExtremeScenarioValidation;
  
  /**
   * 고벡터 유사도 + 저 consolidation 점수 검증 결과
   */
  highVectorLowConsolidation: ExtremeScenarioValidation;
  
  /**
   * w2 상한 검증 결과
   */
  w2UpperBound: W2UpperBoundValidation;
  
  /**
   * 전체 검증 통과 여부
   */
  overallPassed: boolean;
  
  /**
   * 요약 정보
   */
  summary: {
    /**
     * 검증 통과한 시나리오 수
     */
    passedCount: number;
    
    /**
     * 전체 시나리오 수
     */
    totalCount: number;
    
    /**
     * 실패한 시나리오 목록
     */
    failedScenarios: string[];
  };
}

/**
 * 극단적 시나리오 검증 결과 리포트 생성
 * 저벡터+고 consolidation, 고벡터+저 consolidation, w2 상한 검증 결과를 종합하여 리포트를 생성합니다.
 * 
 * @param lowVectorHighConsolidation 저벡터 유사도 + 고 consolidation 점수 검증 결과
 * @param highVectorLowConsolidation 고벡터 유사도 + 저 consolidation 점수 검증 결과
 * @param w2UpperBound w2 상한 검증 결과
 * @returns 극단적 시나리오 검증 결과 리포트
 * 
 * @example
 * ```typescript
 * const lowVectorHigh = validateLowVectorHighConsolidation(results);
 * const highVectorLow = validateHighVectorLowConsolidation(results);
 * const w2Validation = validateW2UpperBound(results, groundTruth);
 * const report = generateExtremeScenarioReport(
 *   lowVectorHigh,
 *   highVectorLow,
 *   w2Validation
 * );
 * console.log(`전체 검증 통과: ${report.overallPassed}`);
 * ```
 */
export function generateExtremeScenarioReport(
  lowVectorHighConsolidation: ExtremeScenarioValidation,
  highVectorLowConsolidation: ExtremeScenarioValidation,
  w2UpperBound: W2UpperBoundValidation
): ExtremeScenarioReport {
  const passedScenarios: string[] = [];
  const failedScenarios: string[] = [];

  if (lowVectorHighConsolidation.passed) {
    passedScenarios.push('저벡터 유사도 + 고 consolidation 점수');
  } else {
    failedScenarios.push('저벡터 유사도 + 고 consolidation 점수');
  }

  if (highVectorLowConsolidation.passed) {
    passedScenarios.push('고벡터 유사도 + 저 consolidation 점수');
  } else {
    failedScenarios.push('고벡터 유사도 + 저 consolidation 점수');
  }

  if (w2UpperBound.passed) {
    passedScenarios.push('w2 상한 검증');
  } else {
    failedScenarios.push('w2 상한 검증');
  }

  const overallPassed = 
    lowVectorHighConsolidation.passed &&
    highVectorLowConsolidation.passed &&
    w2UpperBound.passed;

  return {
    timestamp: new Date().toISOString(),
    lowVectorHighConsolidation,
    highVectorLowConsolidation,
    w2UpperBound,
    overallPassed,
    summary: {
      passedCount: passedScenarios.length,
      totalCount: 3,
      failedScenarios
    }
  };
}

/**
 * Baseline 스냅샷 인터페이스
 * 벡터 검색 품질의 baseline을 저장하고 비교하기 위한 구조
 */
export interface BaselineSnapshot {
  /**
   * 스냅샷 버전
   */
  version: string;
  
  /**
   * 스냅샷 생성 시간 (ISO 8601 형식)
   */
  timestamp: string;
  
  /**
   * 테스트 설정 정보
   */
  testConfiguration: {
    /**
     * 테스트 데이터 크기
     */
    dataSize: number;
    
    /**
     * 가중치 설정
     */
    weights: {
      /**
       * 벡터 유사도 가중치 (w1)
       */
      vectorSimilarity: number;
      
      /**
       * Consolidation 점수 가중치 (w2)
       */
      consolidationScore: number;
    };
  };
  
  /**
   * 품질 지표
   */
  metrics: {
    /**
     * 순서 보존 지표
     */
    orderPreservation: {
      /**
       * Kendall's Tau 순서 일치도
       */
      kendallTau: number;
      
      /**
       * 상위 10개 결과 유지율
       */
      top10Retention: number;
      
      /**
       * 상위 5개 결과 유지율
       */
      top5Retention: number;
    };
    
    /**
     * 품질 지표 (Precision, Recall, NDCG)
     */
    quality: {
      /**
       * Precision@K (K 값별 Precision)
       */
      precision: Record<number, number>;
      
      /**
       * Recall@K (K 값별 Recall)
       */
      recall: Record<number, number>;
      
      /**
       * NDCG@K (K 값별 NDCG)
       */
      ndcg: Record<number, number>;
    };
    
    /**
     * 극단적 시나리오 검증 결과
     */
    extremeScenarios: {
      /**
       * 저벡터 유사도 + 고 consolidation 점수 검증 통과 여부 (1: 통과, 0: 실패)
       */
      lowVectorHighConsolidation: number;
      
      /**
       * 고벡터 유사도 + 저 consolidation 점수 검증 통과 여부 (1: 통과, 0: 실패)
       */
      highVectorLowConsolidation: number;
    };
  };
}

/**
 * Baseline 스냅샷 저장
 * Baseline 스냅샷을 JSON 형식으로 파일에 저장합니다.
 * 
 * @param snapshot 저장할 Baseline 스냅샷
 * @param filePath 저장할 파일 경로 (기본값: `data/vector-search-quality-baseline.json`)
 * @throws 파일 저장 실패 시 에러 발생
 * 
 * @example
 * ```typescript
 * const snapshot: BaselineSnapshot = {
 *   version: '1.0.0',
 *   timestamp: new Date().toISOString(),
 *   testConfiguration: { dataSize: 100, weights: { vectorSimilarity: 0.6, consolidationScore: 0.4 } },
 *   metrics: {
 *     orderPreservation: { kendallTau: 0.85, top10Retention: 0.9, top5Retention: 0.95 },
 *     quality: { precision: {}, recall: {}, ndcg: {} },
 *     extremeScenarios: { lowVectorHighConsolidation: 1, highVectorLowConsolidation: 1 }
 *   }
 * };
 * saveBaselineSnapshot(snapshot);
 * ```
 */
export function saveBaselineSnapshot(
  snapshot: BaselineSnapshot,
  filePath?: string
): void {
  // 기본 파일 경로 설정
  const defaultPath = join(__dirname, '../../../data/vector-search-quality-baseline.json');
  const targetPath = filePath || defaultPath;
  
  // 디렉토리 생성 (없는 경우)
  const dir = dirname(targetPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  
  try {
    // JSON 형식으로 직렬화하여 저장
    const jsonContent = JSON.stringify(snapshot, null, 2);
    writeFileSync(targetPath, jsonContent, 'utf-8');
  } catch (error) {
    throw new Error(
      `Baseline 스냅샷 저장 실패: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Baseline 스냅샷 로드
 * 저장된 Baseline 스냅샷을 파일에서 로드합니다.
 * 
 * @param filePath 로드할 파일 경로 (기본값: `data/vector-search-quality-baseline.json`)
 * @returns 로드된 Baseline 스냅샷 또는 null (파일이 없거나 로드 실패 시)
 * 
 * @example
 * ```typescript
 * const snapshot = loadBaselineSnapshot();
 * if (snapshot) {
 *   console.log(`Baseline 버전: ${snapshot.version}`);
 *   console.log(`Baseline 생성 시간: ${snapshot.timestamp}`);
 * } else {
 *   console.log('Baseline 스냅샷이 없습니다.');
 * }
 * ```
 */
export function loadBaselineSnapshot(
  filePath?: string
): BaselineSnapshot | null {
  // 기본 파일 경로 설정
  const defaultPath = join(__dirname, '../../../data/vector-search-quality-baseline.json');
  const targetPath = filePath || defaultPath;
  
  // 파일 존재 여부 확인
  if (!existsSync(targetPath)) {
    return null;
  }
  
  try {
    // 파일 읽기
    const content = readFileSync(targetPath, 'utf-8');
    
    // JSON 파싱
    const snapshot = JSON.parse(content) as BaselineSnapshot;
    
    // 기본 검증 (필수 필드 존재 여부)
    if (!snapshot.version || !snapshot.timestamp || !snapshot.metrics) {
      throw new Error('Baseline 스냅샷 형식이 올바르지 않습니다.');
    }
    
    return snapshot;
  } catch (error) {
    // 로드 실패 시 null 반환 (에러 로깅은 호출자가 처리)
    return null;
  }
}

/**
 * Baseline 비교 결과
 */
export interface BaselineComparisonResult {
  /**
   * Baseline 스냅샷 정보
   */
  baseline: {
    version: string;
    timestamp: string;
  };
  
  /**
   * 순서 보존 지표 비교 결과
   */
  orderPreservation: {
    /**
     * Kendall's Tau 변화 (현재 - baseline)
     */
    kendallTauChange: number;
    
    /**
     * Top10 유지율 변화 (현재 - baseline)
     */
    top10RetentionChange: number;
    
    /**
     * Top5 유지율 변화 (현재 - baseline)
     */
    top5RetentionChange: number;
  };
  
  /**
   * 품질 지표 비교 결과
   */
  quality: {
    /**
     * Precision@K 변화율 (K 값별)
     */
    precisionChange: Record<number, number>;
    
    /**
     * Recall@K 변화율 (K 값별)
     */
    recallChange: Record<number, number>;
    
    /**
     * NDCG@K 변화율 (K 값별)
     */
    ndcgChange: Record<number, number>;
  };
  
  /**
   * 극단적 시나리오 검증 비교 결과
   */
  extremeScenarios: {
    /**
     * 저벡터 유사도 + 고 consolidation 점수 검증 변화 (현재 - baseline)
     */
    lowVectorHighConsolidationChange: number;
    
    /**
     * 고벡터 유사도 + 저 consolidation 점수 검증 변화 (현재 - baseline)
     */
    highVectorLowConsolidationChange: number;
  };
  
  /**
   * 전체 품질 저하 여부
   */
  hasDegradation: boolean;
  
  /**
   * 품질 저하 세부 사항
   */
  degradationDetails: string[];
}

/**
 * Baseline과 현재 결과 비교
 * Baseline 스냅샷과 현재 검증 결과를 비교하여 품질 저하를 감지합니다.
 * 
 * @param baseline Baseline 스냅샷
 * @param currentOrderPreservation 현재 순서 보존 검증 결과
 * @param currentQuality 현재 품질 지표 (QualityMetrics)
 * @param currentExtremeScenarios 현재 극단적 시나리오 검증 결과
 * @param kValues 비교할 K 값 배열 (기본값: [1, 5, 10])
 * @returns Baseline 비교 결과
 * 
 * @example
 * ```typescript
 * const baseline = loadBaselineSnapshot();
 * if (baseline) {
 *   const comparison = compareWithBaseline(
 *     baseline,
 *     orderPreservationReport,
 *     qualityMetrics,
 *     extremeScenarioReport
 *   );
 *   if (comparison.hasDegradation) {
 *     console.warn('품질 저하 감지:', comparison.degradationDetails);
 *   }
 * }
 * ```
 */
export function compareWithBaseline(
  baseline: BaselineSnapshot,
  currentOrderPreservation: OrderPreservationReport,
  currentQuality: QualityMetrics,
  currentExtremeScenarios: ExtremeScenarioReport,
  kValues: number[] = [1, 5, 10]
): BaselineComparisonResult {
  const degradationDetails: string[] = [];
  
  // 순서 보존 지표 비교
  const baselineOrderPreservation = baseline.metrics.orderPreservation;
  if (!baselineOrderPreservation) {
    throw new Error('Baseline orderPreservation metrics are missing');
  }
  const kendallTauChange = currentOrderPreservation.metrics.kendallTau - baselineOrderPreservation.kendallTau;
  const top10RetentionChange = (currentOrderPreservation.metrics.topKRetention[10] || 0) - baselineOrderPreservation.top10Retention;
  const top5RetentionChange = (currentOrderPreservation.metrics.topKRetention[5] || 0) - baselineOrderPreservation.top5Retention;
  
  // 순서 보존 지표 저하 감지
  if (kendallTauChange < -0.1) {
    degradationDetails.push(`Kendall's Tau 저하: ${kendallTauChange.toFixed(3)}`);
  }
  if (top10RetentionChange < -0.1) {
    degradationDetails.push(`Top10 유지율 저하: ${top10RetentionChange.toFixed(3)}`);
  }
  if (top5RetentionChange < -0.1) {
    degradationDetails.push(`Top5 유지율 저하: ${top5RetentionChange.toFixed(3)}`);
  }
  
  // 품질 지표 비교
  const precisionChange: Record<number, number> = {};
  const recallChange: Record<number, number> = {};
  const ndcgChange: Record<number, number> = {};
  
  kValues.forEach(k => {
    const baselinePrecision = baseline.metrics.quality.precision[k] || 0;
    const currentPrecision = currentQuality.precision[k] || 0;
    const precisionDiff = baselinePrecision > 0
      ? (currentPrecision - baselinePrecision) / baselinePrecision
      : 0;
    precisionChange[k] = precisionDiff;
    
    const baselineRecall = baseline.metrics.quality.recall[k] || 0;
    const currentRecall = currentQuality.recall[k] || 0;
    const recallDiff = baselineRecall > 0
      ? (currentRecall - baselineRecall) / baselineRecall
      : 0;
    recallChange[k] = recallDiff;
    
    const baselineNDCG = baseline.metrics.quality.ndcg[k] || 0;
    const currentNDCG = currentQuality.ndcg[k] || 0;
    const ndcgDiff = baselineNDCG > 0
      ? (currentNDCG - baselineNDCG) / baselineNDCG
      : 0;
    ndcgChange[k] = ndcgDiff;
    
    // 품질 지표 저하 감지 (5% 이상 저하)
    if (ndcgDiff < -0.05) {
      degradationDetails.push(`NDCG@${k} 저하: ${(ndcgDiff * 100).toFixed(2)}%`);
    }
    if (precisionDiff < -0.10) {
      degradationDetails.push(`Precision@${k} 저하: ${(precisionDiff * 100).toFixed(2)}%`);
    }
    if (recallDiff < -0.10) {
      degradationDetails.push(`Recall@${k} 저하: ${(recallDiff * 100).toFixed(2)}%`);
    }
  });
  
  // 극단적 시나리오 검증 비교
  const lowVectorHighConsolidationChange = 
    (currentExtremeScenarios.lowVectorHighConsolidation.passed ? 1 : 0) - 
    baseline.metrics.extremeScenarios.lowVectorHighConsolidation;
  const highVectorLowConsolidationChange = 
    (currentExtremeScenarios.highVectorLowConsolidation.passed ? 1 : 0) - 
    baseline.metrics.extremeScenarios.highVectorLowConsolidation;
  
  // 극단적 시나리오 검증 저하 감지
  if (lowVectorHighConsolidationChange < 0) {
    degradationDetails.push('저벡터 유사도 + 고 consolidation 점수 검증 실패');
  }
  if (highVectorLowConsolidationChange < 0) {
    degradationDetails.push('고벡터 유사도 + 저 consolidation 점수 검증 실패');
  }
  
  // 전체 품질 저하 여부 판단
  const hasDegradation = degradationDetails.length > 0;
  
  return {
    baseline: {
      version: baseline.version,
      timestamp: baseline.timestamp
    },
    orderPreservation: {
      kendallTauChange,
      top10RetentionChange,
      top5RetentionChange
    },
    quality: {
      precisionChange,
      recallChange,
      ndcgChange
    },
    extremeScenarios: {
      lowVectorHighConsolidationChange,
      highVectorLowConsolidationChange
    },
    hasDegradation,
    degradationDetails: hasDegradation ? degradationDetails : []
  };
}

/**
 * 품질 저하 감지 결과
 */
export interface QualityDegradationDetection {
  /**
   * 품질 저하 감지 여부
   */
  detected: boolean;
  
  /**
   * 심각도 레벨
   */
  severity: 'none' | 'warning' | 'critical';
  
  /**
   * 품질 저하 메시지 목록
   */
  messages: string[];
  
  /**
   * Baseline 비교 결과
   */
  comparison: BaselineComparisonResult;
  
  /**
   * 권장 조치 사항
   */
  recommendations: string[];
}

/**
 * 품질 저하 감지 및 알림
 * Baseline 비교 결과를 분석하여 품질 저하를 감지하고 알림을 생성합니다.
 * 
 * @param comparison Baseline 비교 결과
 * @param options 감지 옵션
 * @param options.ndcg5Threshold NDCG@5 저하 임계값 (기본값: 0.05 = 5%)
 * @param options.precision5Threshold Precision@5 저하 임계값 (기본값: 0.10 = 10%)
 * @param options.recall5Threshold Recall@5 저하 임계값 (기본값: 0.10 = 10%)
 * @param options.kendallTauThreshold Kendall's Tau 저하 임계값 (기본값: 0.1)
 * @param options.criticalThreshold 심각한 저하 임계값 (기본값: 0.20 = 20%)
 * @returns 품질 저하 감지 결과
 * 
 * @example
 * ```typescript
 * const comparison = compareWithBaseline(baseline, ...);
 * const detection = detectQualityDegradation(comparison);
 * if (detection.detected) {
 *   console.warn(`[${detection.severity.toUpperCase()}] 품질 저하 감지:`);
 *   detection.messages.forEach(msg => console.warn(`  - ${msg}`));
 * }
 * ```
 */
export function detectQualityDegradation(
  comparison: BaselineComparisonResult,
  options: {
    ndcg5Threshold?: number;
    precision5Threshold?: number;
    recall5Threshold?: number;
    kendallTauThreshold?: number;
    criticalThreshold?: number;
  } = {}
): QualityDegradationDetection {
  const {
    ndcg5Threshold = 0.05, // 5%
    precision5Threshold = 0.10, // 10%
    recall5Threshold = 0.10, // 10%
    kendallTauThreshold = 0.1,
    criticalThreshold = 0.20 // 20%
  } = options;

  const messages: string[] = [];
  const recommendations: string[] = [];
  let severity: 'none' | 'warning' | 'critical' = 'none';
  let hasWarning = false;
  let hasCritical = false;

  // 순서 보존 지표 저하 감지
  if (comparison.orderPreservation.kendallTauChange < -kendallTauThreshold) {
    const change = comparison.orderPreservation.kendallTauChange;
    const isCritical = change < -criticalThreshold;
    messages.push(
      `Kendall's Tau 저하: ${change.toFixed(3)} (Baseline: ${(comparison.baseline.version)} 기준)`
    );
    if (isCritical) {
      hasCritical = true;
      recommendations.push('순서 보존 지표가 크게 저하되었습니다. 가중치 설정을 재검토하세요.');
    } else {
      hasWarning = true;
      recommendations.push('순서 보존 지표가 저하되었습니다. 모니터링을 강화하세요.');
    }
  }

  if (comparison.orderPreservation.top10RetentionChange < -0.1) {
    const change = comparison.orderPreservation.top10RetentionChange;
    const isCritical = change < -criticalThreshold;
    messages.push(
      `Top10 유지율 저하: ${(change * 100).toFixed(2)}% (Baseline: ${comparison.baseline.version} 기준)`
    );
    if (isCritical) {
      hasCritical = true;
    } else {
      hasWarning = true;
    }
  }

  if (comparison.orderPreservation.top5RetentionChange < -0.1) {
    const change = comparison.orderPreservation.top5RetentionChange;
    const isCritical = change < -criticalThreshold;
    messages.push(
      `Top5 유지율 저하: ${(change * 100).toFixed(2)}% (Baseline: ${comparison.baseline.version} 기준)`
    );
    if (isCritical) {
      hasCritical = true;
    } else {
      hasWarning = true;
    }
  }

  // 품질 지표 저하 감지
  const ndcg5Change = comparison.quality.ndcgChange[5] || 0;
  if (ndcg5Change < -ndcg5Threshold) {
    const isCritical = ndcg5Change < -criticalThreshold;
    messages.push(
      `NDCG@5 저하: ${(ndcg5Change * 100).toFixed(2)}% (Baseline: ${comparison.baseline.version} 기준)`
    );
    if (isCritical) {
      hasCritical = true;
      recommendations.push('NDCG@5가 크게 저하되었습니다. 검색 알고리즘을 재검토하세요.');
    } else {
      hasWarning = true;
      recommendations.push('NDCG@5가 저하되었습니다. 가중치 조정을 고려하세요.');
    }
  }

  const precision5Change = comparison.quality.precisionChange[5] || 0;
  if (precision5Change < -precision5Threshold) {
    const isCritical = precision5Change < -criticalThreshold;
    messages.push(
      `Precision@5 저하: ${(precision5Change * 100).toFixed(2)}% (Baseline: ${comparison.baseline.version} 기준)`
    );
    if (isCritical) {
      hasCritical = true;
    } else {
      hasWarning = true;
    }
  }

  const recall5Change = comparison.quality.recallChange[5] || 0;
  if (recall5Change < -recall5Threshold) {
    const isCritical = recall5Change < -criticalThreshold;
    messages.push(
      `Recall@5 저하: ${(recall5Change * 100).toFixed(2)}% (Baseline: ${comparison.baseline.version} 기준)`
    );
    if (isCritical) {
      hasCritical = true;
    } else {
      hasWarning = true;
    }
  }

  // 극단적 시나리오 검증 저하 감지
  if (comparison.extremeScenarios.lowVectorHighConsolidationChange < 0) {
    messages.push(
      `저벡터 유사도 + 고 consolidation 점수 검증 실패 (Baseline: ${comparison.baseline.version} 기준)`
    );
    hasWarning = true;
    recommendations.push('극단적 시나리오 검증이 실패했습니다. w2 상한 설정을 확인하세요.');
  }

  if (comparison.extremeScenarios.highVectorLowConsolidationChange < 0) {
    messages.push(
      `고벡터 유사도 + 저 consolidation 점수 검증 실패 (Baseline: ${comparison.baseline.version} 기준)`
    );
    hasWarning = true;
    recommendations.push('극단적 시나리오 검증이 실패했습니다. 벡터 유사도 가중치를 확인하세요.');
  }

  // 심각도 결정
  if (hasCritical) {
    severity = 'critical';
  } else if (hasWarning || comparison.hasDegradation) {
    severity = 'warning';
  }

  // 감지 여부 결정
  const detected = comparison.hasDegradation || messages.length > 0;

  return {
    detected,
    severity,
    messages,
    comparison,
    recommendations: recommendations.length > 0 ? recommendations : []
  };
}

/**
 * 경고 메시지 출력 옵션
 */
export interface QualityAlertOptions {
  /**
   * 출력 대상 ('console' | 'file' | 'both')
   */
  output?: 'console' | 'file' | 'both';
  
  /**
   * 파일 경로 (output이 'file' 또는 'both'일 때 사용)
   */
  filePath?: string;
  
  /**
   * 색상 사용 여부 (콘솔 출력 시, 기본값: true)
   */
  useColors?: boolean;
  
  /**
   * 상세 정보 포함 여부 (기본값: true)
   */
  includeDetails?: boolean;
  
  /**
   * Baseline 정보 포함 여부 (기본값: true)
   */
  includeBaselineInfo?: boolean;
}

/**
 * 품질 저하 경고 메시지 출력
 * 품질 저하 감지 결과를 사용자 친화적인 형식으로 출력합니다.
 * 
 * @param detection 품질 저하 감지 결과
 * @param options 출력 옵션
 * 
 * @example
 * ```typescript
 * const detection = detectQualityDegradation(comparison);
 * printQualityAlert(detection, { output: 'console', useColors: true });
 * ```
 */
export function printQualityAlert(
  detection: QualityDegradationDetection,
  options: QualityAlertOptions = {}
): void {
  const {
    output = 'console',
    filePath,
    useColors = true,
    includeDetails = true,
    includeBaselineInfo = true
  } = options;

  // 감지되지 않았으면 출력하지 않음
  if (!detection.detected) {
    return;
  }

  const lines: string[] = [];
  
  // 헤더
  const severityLabel = detection.severity === 'critical' 
    ? '🚨 CRITICAL' 
    : detection.severity === 'warning'
      ? '⚠️  WARNING'
      : 'ℹ️  INFO';
  
  lines.push('='.repeat(80));
  lines.push(`${severityLabel} 품질 저하 감지`);
  lines.push('='.repeat(80));
  lines.push('');
  
  // Baseline 정보
  if (includeBaselineInfo) {
    lines.push(`Baseline 버전: ${detection.comparison.baseline.version}`);
    lines.push(`Baseline 생성 시간: ${detection.comparison.baseline.timestamp}`);
    lines.push('');
  }
  
  // 품질 저하 메시지
  if (detection.messages.length > 0) {
    lines.push('감지된 품질 저하:');
    lines.push('');
    detection.messages.forEach((msg, index) => {
      lines.push(`  ${index + 1}. ${msg}`);
    });
    lines.push('');
  }
  
  // 권장 조치 사항
  if (detection.recommendations.length > 0) {
    lines.push('권장 조치 사항:');
    lines.push('');
    detection.recommendations.forEach((rec, index) => {
      lines.push(`  ${index + 1}. ${rec}`);
    });
    lines.push('');
  }
  
  // 상세 정보
  if (includeDetails) {
    lines.push('상세 정보:');
    lines.push('');
    
    // 순서 보존 지표
    const orderPres = detection.comparison.orderPreservation;
    lines.push('순서 보존 지표:');
    lines.push(`  - Kendall's Tau 변화: ${orderPres.kendallTauChange >= 0 ? '+' : ''}${orderPres.kendallTauChange.toFixed(3)}`);
    lines.push(`  - Top10 유지율 변화: ${orderPres.top10RetentionChange >= 0 ? '+' : ''}${(orderPres.top10RetentionChange * 100).toFixed(2)}%`);
    lines.push(`  - Top5 유지율 변화: ${orderPres.top5RetentionChange >= 0 ? '+' : ''}${(orderPres.top5RetentionChange * 100).toFixed(2)}%`);
    lines.push('');
    
    // 품질 지표
    const quality = detection.comparison.quality;
    lines.push('품질 지표 변화:');
    const kValues = Object.keys(quality.ndcgChange || {}).map(Number).sort((a, b) => a - b);
    if (kValues.length > 0) {
      lines.push('  NDCG@K:');
      kValues.forEach(k => {
        const change = quality.ndcgChange[k] || 0;
        lines.push(`    - NDCG@${k}: ${change >= 0 ? '+' : ''}${(change * 100).toFixed(2)}%`);
      });
      lines.push('  Precision@K:');
      kValues.forEach(k => {
        const change = quality.precisionChange[k] || 0;
        lines.push(`    - Precision@${k}: ${change >= 0 ? '+' : ''}${(change * 100).toFixed(2)}%`);
      });
      lines.push('  Recall@K:');
      kValues.forEach(k => {
        const change = quality.recallChange[k] || 0;
        lines.push(`    - Recall@${k}: ${change >= 0 ? '+' : ''}${(change * 100).toFixed(2)}%`);
      });
    }
    lines.push('');
  }
  
  lines.push('='.repeat(80));
  lines.push('');
  
  const alertText = lines.join('\n');
  
  // `output: 'console'`: 터미널로 사람이 읽는 QA 알림만 보냄. 심각도에 따라 stderr/stdout을
  // 나누기 위해 `console.*`를 쓴다(도입: #38, tasks-0009). 운영 로그(logger)와 역할이 다르므로
  // 여기서는 logger로 바꾸지 않는다.
  /* eslint-disable no-console -- matches QualityAlertOptions.output "console" contract */
  if (output === 'console' || output === 'both') {
    if (detection.severity === 'critical') {
      // Critical은 stderr로 출력
      console.error(alertText);
    } else if (detection.severity === 'warning') {
      // Warning은 console.warn으로 출력
      console.warn(alertText);
    } else {
      // Info는 console.log로 출력
      console.log(alertText);
    }
  }
  /* eslint-enable no-console */
  
  // 파일 출력
  if ((output === 'file' || output === 'both') && filePath) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    
    try {
      writeFileSync(filePath, alertText, 'utf-8');
    } catch (error) {
      throw new Error(
        `경고 메시지 파일 저장 실패: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * 품질 저하 감지 및 경고 출력 (통합 함수)
 * Baseline 비교 결과를 분석하여 품질 저하를 감지하고 경고 메시지를 출력합니다.
 * 
 * @param comparison Baseline 비교 결과
 * @param detectionOptions 감지 옵션
 * @param alertOptions 경고 출력 옵션
 * @returns 품질 저하 감지 결과
 * 
 * @example
 * ```typescript
 * const comparison = compareWithBaseline(baseline, currentMetrics);
 * detectAndAlertQualityDegradation(comparison, {}, { output: 'console' });
 * ```
 */
export function detectAndAlertQualityDegradation(
  comparison: BaselineComparisonResult,
  detectionOptions: Parameters<typeof detectQualityDegradation>[1] = {},
  alertOptions: QualityAlertOptions = {}
): QualityDegradationDetection {
  // 품질 저하 감지
  const detection = detectQualityDegradation(comparison, detectionOptions);
  
  // 경고 메시지 출력
  printQualityAlert(detection, alertOptions);
  
  return detection;
}

/**
 * 시드 기반 랜덤 생성기 (Ground Truth 생성용)
 * 재현 가능한 랜덤 값 생성
 */
class GroundTruthSeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  /**
   * 0과 1 사이의 랜덤 값 생성
   */
  random(): number {
    // LCG: (a * seed + c) mod m
    // a = 1664525, c = 1013904223, m = 2^32
    this.seed = (this.seed * 1664525 + 1013904223) % 0x100000000;
    return this.seed / 0x100000000;
  }

  /**
   * min과 max 사이의 정수 랜덤 값 생성
   */
  randomInt(min: number, max: number): number {
    return Math.floor(this.random() * (max - min + 1)) + min;
  }
}

/**
 * Ground Truth 생성 옵션
 */
export interface GroundTruthGenerationOptions {
  /**
   * 시드 값 (재현성을 위해 사용, 기본값: 12345)
   */
  seed?: number;
  
  /**
   * 쿼리 목록 (기본값: ['React', 'TypeScript', 'database', 'MCP', 'optimization'])
   */
  queries?: string[];
  
  /**
   * 각 쿼리당 관련 결과 수 (기본값: 5)
   */
  relevantCountPerQuery?: number;
  
  /**
   * 관련 결과 선택 전략 (기본값: 'random')
   * - 'random': 랜덤 선택
   * - 'first': 처음 N개 선택
   * - 'pattern': 패턴 기반 선택 (i % 3 === 0 등)
   */
  selectionStrategy?: 'random' | 'first' | 'pattern';
}

/**
 * Ground Truth 자동 생성
 * 시드 기반으로 재현 가능한 Ground Truth 생성
 * 
 * @param memoryIds 메모리 ID 배열
 * @param options 생성 옵션
 * @returns Ground Truth 배열
 * 
 * @example
 * ```typescript
 * // 기본 옵션으로 생성
 * const groundTruths = generateGroundTruth(memoryIds);
 * 
 * // 시드와 쿼리 지정
 * const groundTruths = generateGroundTruth(memoryIds, {
 *   seed: 12345,
 *   queries: ['React', 'TypeScript'],
 *   relevantCountPerQuery: 3
 * });
 * ```
 */
export function generateGroundTruth(
  memoryIds: string[],
  options: GroundTruthGenerationOptions = {}
): GroundTruth[] {
  const {
    seed = 12345,
    queries = ['React', 'TypeScript', 'database', 'MCP', 'optimization'],
    relevantCountPerQuery = 5,
    selectionStrategy = 'random'
  } = options;

  const rng = new GroundTruthSeededRandom(seed);
  const groundTruths: GroundTruth[] = [];

  queries.forEach((query, queryIndex) => {
    let relevantIds: string[];

    switch (selectionStrategy) {
      case 'first':
        // 처음 N개 선택
        relevantIds = memoryIds.slice(0, relevantCountPerQuery);
        break;
      
      case 'pattern':
        // 패턴 기반 선택 (쿼리별로 다른 패턴)
        relevantIds = memoryIds.filter((_, i) => 
          i % (queries.length + 1) === queryIndex
        ).slice(0, relevantCountPerQuery);
        break;
      
      case 'random':
      default: {
        // 랜덤 선택 (시드 기반)
        const shuffled = [...memoryIds];
        // Fisher-Yates 셔플 (시드 기반)
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = rng.randomInt(0, i);
          const temp = shuffled[i];
          if (temp !== undefined && shuffled[j] !== undefined) {
            shuffled[i] = shuffled[j];
            shuffled[j] = temp;
          }
        }
        relevantIds = shuffled.slice(0, relevantCountPerQuery);
        break;
      }
    }

    groundTruths.push({
      queryId: query,
      relevantIds
    });
  });

  return groundTruths;
}

/**
 * Ground Truth 저장
 * JSON 파일로 Ground Truth를 저장합니다.
 * 
 * @param groundTruths 저장할 Ground Truth 배열
 * @param filePath 저장할 파일 경로 (기본값: `data/vector-search-quality-ground-truth.json`)
 * 
 * @example
 * ```typescript
 * const groundTruths = generateGroundTruth(memoryIds);
 * saveGroundTruth(groundTruths);
 * ```
 */
export function saveGroundTruth(
  groundTruths: GroundTruth[],
  filePath?: string
): void {
  const defaultPath = join(__dirname, '../../../data/vector-search-quality-ground-truth.json');
  const targetPath = filePath || defaultPath;
  const dir = dirname(targetPath);
  
  // 디렉토리가 없으면 생성
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  
  try {
    const jsonContent = JSON.stringify(groundTruths, null, 2);
    writeFileSync(targetPath, jsonContent, 'utf-8');
  } catch (error) {
    throw new Error(
      `Ground Truth 저장 실패: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Ground Truth 로드
 * JSON 파일에서 Ground Truth를 로드합니다.
 * 
 * @param filePath 로드할 파일 경로 (기본값: `data/vector-search-quality-ground-truth.json`)
 * @returns 로드된 Ground Truth 배열 또는 null (파일이 없거나 로드 실패 시)
 * 
 * @example
 * ```typescript
 * const groundTruths = loadGroundTruth();
 * if (groundTruths) {
 *   console.log(`로드된 Ground Truth 수: ${groundTruths.length}`);
 * } else {
 *   console.log('Ground Truth 파일이 없습니다. 새로 생성합니다.');
 *   const newGroundTruths = generateGroundTruth(memoryIds);
 *   saveGroundTruth(newGroundTruths);
 * }
 * ```
 */
export function loadGroundTruth(
  filePath?: string
): GroundTruth[] | null {
  const defaultPath = join(__dirname, '../../../data/vector-search-quality-ground-truth.json');
  const targetPath = filePath || defaultPath;
  
  // 파일 존재 여부 확인
  if (!existsSync(targetPath)) {
    return null;
  }
  
  try {
    // 파일 읽기
    const content = readFileSync(targetPath, 'utf-8');
    
    // JSON 파싱
    const groundTruths = JSON.parse(content) as GroundTruth[];
    
    // 기본 검증 (배열이고 각 항목이 올바른 형식인지 확인)
    if (!Array.isArray(groundTruths)) {
      throw new Error('Ground Truth는 배열이어야 합니다.');
    }
    
    for (const gt of groundTruths) {
      if (!gt.queryId || !Array.isArray(gt.relevantIds)) {
        throw new Error('Ground Truth 형식이 올바르지 않습니다.');
      }
    }
    
    return groundTruths;
  } catch (error) {
    // 로드 실패 시 null 반환 (에러 로깅은 호출자가 처리)
    return null;
  }
}

/**
 * Ground Truth 생성 또는 로드
 * 파일이 있으면 로드하고, 없으면 자동 생성하여 저장합니다.
 * 
 * @param memoryIds 메모리 ID 배열
 * @param options 생성 옵션 (파일이 없을 때만 사용)
 * @param filePath Ground Truth 파일 경로 (기본값: `data/vector-search-quality-ground-truth.json`)
 * @returns Ground Truth 배열
 * 
 * @example
 * ```typescript
 * // 파일이 있으면 로드, 없으면 생성
 * const groundTruths = generateOrLoadGroundTruth(memoryIds, {
 *   seed: 12345,
 *   queries: ['React', 'TypeScript']
 * });
 * ```
 */
export function generateOrLoadGroundTruth(
  memoryIds: string[],
  options: GroundTruthGenerationOptions = {},
  filePath?: string
): GroundTruth[] {
  // 먼저 파일에서 로드 시도
  const loaded = loadGroundTruth(filePath);
  
  if (loaded) {
    return loaded;
  }
  
  // 파일이 없으면 생성
  const generated = generateGroundTruth(memoryIds, options);
  
  // 생성한 Ground Truth 저장
  saveGroundTruth(generated, filePath);
  
  return generated;
}

/**
 * strict benchmark fixture에서 사람이 확정한 Ground Truth를 로드합니다.
 *
 * @param benchmarkDir benchmark fixture 디렉터리
 * @returns strict benchmark 검증을 통과한 Ground Truth 배열
 */
export function loadStrictBenchmarkGroundTruth(
  benchmarkDir: string = DEFAULT_SEARCH_BENCHMARK_DIR
): GroundTruth[] {
  const manifest = loadBenchmarkManifest(benchmarkDir);
  assertStrictBenchmark(manifest);
  return loadBenchmarkGroundTruth(benchmarkDir);
}

/**
 * 리포트 저장 옵션
 */
export interface ReportSaveOptions {
  /**
   * 저장할 파일 경로 (기본값: 리포트 타입에 따라 자동 생성)
   */
  filePath?: string;
  
  /**
   * 저장 형식 ('json' | 'markdown' | 'both')
   */
  format?: 'json' | 'markdown' | 'both';
  
  /**
   * 파일명에 타임스탬프 포함 여부 (기본값: true)
   */
  includeTimestamp?: boolean;
}

/**
 * 순서 보존 리포트 저장
 * 순서 보존 리포트를 JSON 또는 Markdown 형식으로 파일에 저장합니다.
 * 
 * @param report 저장할 순서 보존 리포트
 * @param options 저장 옵션
 * 
 * @example
 * ```typescript
 * const report = generateOrderPreservationReport(pair);
 * saveOrderPreservationReport(report, { format: 'markdown' });
 * ```
 */
export function saveOrderPreservationReport(
  report: OrderPreservationReport,
  options: ReportSaveOptions = {}
): void {
  const {
    format = 'both',
    includeTimestamp = true
  } = options;
  
  const timestamp = includeTimestamp 
    ? `_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)}`
    : '';
  
  const defaultJsonPath = join(__dirname, `../../../data/order-preservation-report${timestamp}.json`);
  const defaultMarkdownPath = join(__dirname, `../../../data/order-preservation-report${timestamp}.md`);
  
  const jsonPath = options.filePath && format === 'json' 
    ? options.filePath 
    : format === 'both' 
      ? defaultJsonPath.replace('.md', '.json')
      : format === 'json'
        ? defaultJsonPath
        : undefined;
  
  const markdownPath = options.filePath && format === 'markdown'
    ? options.filePath
    : format === 'both'
      ? defaultMarkdownPath
      : format === 'markdown'
        ? defaultMarkdownPath
        : undefined;
  
  // 디렉토리 생성
  if (jsonPath) {
    const dir = dirname(jsonPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  
  if (markdownPath) {
    const dir = dirname(markdownPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  
  try {
    // JSON 형식 저장
    if (jsonPath) {
      const jsonContent = JSON.stringify(report, null, 2);
      writeFileSync(jsonPath, jsonContent, 'utf-8');
    }
    
    // Markdown 형식 저장
    if (markdownPath) {
      const markdownLines: string[] = [];
      markdownLines.push('# 순서 보존 검증 리포트');
      markdownLines.push('');
      markdownLines.push(`**생성 시간**: ${report.timestamp}`);
      markdownLines.push(`**검증 통과**: ${report.passed ? '[PASS] 통과' : '[FAIL] 실패'}`);
      markdownLines.push('');
      
      markdownLines.push('## 순서 보존 지표');
      markdownLines.push('');
      markdownLines.push('| 지표 | 값 |');
      markdownLines.push('|------|-----|');
      markdownLines.push(`| Kendall's Tau | ${report.metrics.kendallTau.toFixed(3)} |`);
      markdownLines.push(`| Top10 유지율 | ${(report.metrics.top10Retention * 100).toFixed(2)}% |`);
      markdownLines.push(`| Top5 유지율 | ${(report.metrics.top5Retention * 100).toFixed(2)}% |`);
      
      if (report.metrics.spearmanRho !== undefined) {
        markdownLines.push(`| Spearman's Rho | ${report.metrics.spearmanRho.toFixed(3)} |`);
      }
      
      markdownLines.push('');
      
      // 검증 결과
      markdownLines.push('## 검증 결과');
      markdownLines.push('');
      markdownLines.push('| 항목 | 임계값 | 실제 값 | 상태 |');
      markdownLines.push('|------|--------|---------|------|');
      
      const kendallTauStatus = report.metrics.kendallTau >= (report.thresholds?.kendallTauThreshold || 0.7)
        ? '[PASS] 통과'
        : '[FAIL] 실패';
      const top10Status = report.metrics.top10Retention >= (report.thresholds?.top10RetentionThreshold || 0.8)
        ? '[PASS] 통과'
        : '[FAIL] 실패';
      const top5Status = report.metrics.top5Retention >= (report.thresholds?.top5RetentionThreshold || 0.9)
        ? '[PASS] 통과'
        : '[FAIL] 실패';
      
      markdownLines.push(`| Kendall's Tau | ≥ ${(report.thresholds?.kendallTauThreshold || 0.7).toFixed(1)} | ${report.metrics.kendallTau.toFixed(3)} | ${kendallTauStatus} |`);
      markdownLines.push(`| Top10 유지율 | ≥ ${((report.thresholds?.top10RetentionThreshold || 0.8) * 100).toFixed(0)}% | ${(report.metrics.top10Retention * 100).toFixed(2)}% | ${top10Status} |`);
      markdownLines.push(`| Top5 유지율 | ≥ ${((report.thresholds?.top5RetentionThreshold || 0.9) * 100).toFixed(0)}% | ${(report.metrics.top5Retention * 100).toFixed(2)}% | ${top5Status} |`);
      markdownLines.push('');
      
      // 실패 사유
      if (report.failureReasons && report.failureReasons.length > 0) {
        markdownLines.push('### 실패 사유');
        markdownLines.push('');
        report.failureReasons.forEach(reason => {
          markdownLines.push(`- [FAIL] ${reason}`);
        });
        markdownLines.push('');
      }
      
      const markdownContent = markdownLines.join('\n');
      writeFileSync(markdownPath, markdownContent, 'utf-8');
    }
  } catch (error) {
    throw new Error(
      `순서 보존 리포트 저장 실패: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * 품질 비교 리포트 저장
 * 품질 비교 리포트를 JSON 또는 Markdown 형식으로 파일에 저장합니다.
 * 
 * @param report 저장할 품질 비교 리포트
 * @param options 저장 옵션
 * 
 * @example
 * ```typescript
 * const report = generateQualityComparisonReport(comparison, groundTruth);
 * saveQualityComparisonReport(report, { format: 'markdown' });
 * ```
 */
export function saveQualityComparisonReport(
  report: QualityComparisonReport,
  options: ReportSaveOptions = {}
): void {
  const {
    format = 'both',
    includeTimestamp = true
  } = options;
  
  const timestamp = includeTimestamp 
    ? `_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)}`
    : '';
  
  const defaultJsonPath = join(__dirname, `../../../data/quality-comparison-report${timestamp}.json`);
  const defaultMarkdownPath = join(__dirname, `../../../data/quality-comparison-report${timestamp}.md`);
  
  const jsonPath = options.filePath && format === 'json' 
    ? options.filePath 
    : format === 'both' 
      ? defaultJsonPath.replace('.md', '.json')
      : format === 'json'
        ? defaultJsonPath
        : undefined;
  
  const markdownPath = options.filePath && format === 'markdown'
    ? options.filePath
    : format === 'both'
      ? defaultMarkdownPath
      : format === 'markdown'
        ? defaultMarkdownPath
        : undefined;
  
  // 디렉토리 생성
  if (jsonPath) {
    const dir = dirname(jsonPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  
  if (markdownPath) {
    const dir = dirname(markdownPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  
  try {
    // JSON 형식 저장
    if (jsonPath) {
      const jsonContent = JSON.stringify(report, null, 2);
      writeFileSync(jsonPath, jsonContent, 'utf-8');
    }
    
    // Markdown 형식 저장 (기존 visualizeQualityComparison 함수 활용)
    if (markdownPath) {
      const markdownContent = visualizeQualityComparison(report);
      writeFileSync(markdownPath, markdownContent, 'utf-8');
    }
  } catch (error) {
    throw new Error(
      `품질 비교 리포트 저장 실패: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * 극단적 시나리오 리포트 저장
 * 극단적 시나리오 리포트를 JSON 또는 Markdown 형식으로 파일에 저장합니다.
 * 
 * @param report 저장할 극단적 시나리오 리포트
 * @param options 저장 옵션
 * 
 * @example
 * ```typescript
 * const report = generateExtremeScenarioReport(lowVectorHigh, highVectorLow, w2Validation);
 * saveExtremeScenarioReport(report, { format: 'markdown' });
 * ```
 */
export function saveExtremeScenarioReport(
  report: ExtremeScenarioReport,
  options: ReportSaveOptions = {}
): void {
  const {
    format = 'both',
    includeTimestamp = true
  } = options;
  
  const timestamp = includeTimestamp 
    ? `_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)}`
    : '';
  
  const defaultJsonPath = join(__dirname, `../../../data/extreme-scenario-report${timestamp}.json`);
  const defaultMarkdownPath = join(__dirname, `../../../data/extreme-scenario-report${timestamp}.md`);
  
  const jsonPath = options.filePath && format === 'json' 
    ? options.filePath 
    : format === 'both' 
      ? defaultJsonPath.replace('.md', '.json')
      : format === 'json'
        ? defaultJsonPath
        : undefined;
  
  const markdownPath = options.filePath && format === 'markdown'
    ? options.filePath
    : format === 'both'
      ? defaultMarkdownPath
      : format === 'markdown'
        ? defaultMarkdownPath
        : undefined;
  
  // 디렉토리 생성
  if (jsonPath) {
    const dir = dirname(jsonPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  
  if (markdownPath) {
    const dir = dirname(markdownPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  
  try {
    // JSON 형식 저장
    if (jsonPath) {
      const jsonContent = JSON.stringify(report, null, 2);
      writeFileSync(jsonPath, jsonContent, 'utf-8');
    }
    
    // Markdown 형식 저장
    if (markdownPath) {
      const markdownLines: string[] = [];
      markdownLines.push('# 극단적 시나리오 검증 리포트');
      markdownLines.push('');
      markdownLines.push(`**생성 시간**: ${report.timestamp}`);
      markdownLines.push(`**전체 검증 통과**: ${report.overallPassed ? '[PASS] 통과' : '[FAIL] 실패'}`);
      markdownLines.push('');
      
      markdownLines.push('## 검증 결과 요약');
      markdownLines.push('');
      markdownLines.push(`- **통과한 시나리오**: ${report.summary.passedCount} / ${report.summary.totalCount}`);
      markdownLines.push(`- **실패한 시나리오**: ${report.summary.failedScenarios.length}`);
      markdownLines.push('');
      
      if (report.summary.failedScenarios.length > 0) {
        markdownLines.push('### 실패한 시나리오');
        markdownLines.push('');
        report.summary.failedScenarios.forEach(scenario => {
          markdownLines.push(`- [FAIL] ${scenario}`);
        });
        markdownLines.push('');
      }
      
      // 저벡터 유사도 + 고 consolidation 점수 검증
      markdownLines.push('## 저벡터 유사도 + 고 consolidation 점수 검증');
      markdownLines.push('');
      markdownLines.push(`**검증 통과**: ${report.lowVectorHighConsolidation.passed ? '[PASS] 통과' : '[FAIL] 실패'}`);
      markdownLines.push('');
      markdownLines.push('| 지표 | 값 |');
      markdownLines.push('|------|-----|');
      markdownLines.push(`| 최종 점수 범위 | ${report.lowVectorHighConsolidation.finalScoreRange.min.toFixed(3)} ~ ${report.lowVectorHighConsolidation.finalScoreRange.max.toFixed(3)} |`);
      markdownLines.push(`| 최종 점수 평균 | ${report.lowVectorHighConsolidation.finalScoreRange.average.toFixed(3)} |`);
      markdownLines.push(`| 벡터 유사도 평균 | ${report.lowVectorHighConsolidation.vectorSimilarityStats.average.toFixed(3)} |`);
      markdownLines.push(`| Consolidation 점수 평균 | ${report.lowVectorHighConsolidation.consolidationScoreStats.average.toFixed(3)} |`);
      markdownLines.push('');
      
      if (report.lowVectorHighConsolidation.failureReasons && report.lowVectorHighConsolidation.failureReasons.length > 0) {
        markdownLines.push('### 실패 사유');
        markdownLines.push('');
        report.lowVectorHighConsolidation.failureReasons.forEach(reason => {
          markdownLines.push(`- [FAIL] ${reason}`);
        });
        markdownLines.push('');
      }
      
      // 고벡터 유사도 + 저 consolidation 점수 검증
      markdownLines.push('## 고벡터 유사도 + 저 consolidation 점수 검증');
      markdownLines.push('');
      markdownLines.push(`**검증 통과**: ${report.highVectorLowConsolidation.passed ? '[PASS] 통과' : '[FAIL] 실패'}`);
      markdownLines.push('');
      markdownLines.push('| 지표 | 값 |');
      markdownLines.push('|------|-----|');
      markdownLines.push(`| 최종 점수 범위 | ${report.highVectorLowConsolidation.finalScoreRange.min.toFixed(3)} ~ ${report.highVectorLowConsolidation.finalScoreRange.max.toFixed(3)} |`);
      markdownLines.push(`| 최종 점수 평균 | ${report.highVectorLowConsolidation.finalScoreRange.average.toFixed(3)} |`);
      markdownLines.push(`| 벡터 유사도 평균 | ${report.highVectorLowConsolidation.vectorSimilarityStats.average.toFixed(3)} |`);
      markdownLines.push(`| Consolidation 점수 평균 | ${report.highVectorLowConsolidation.consolidationScoreStats.average.toFixed(3)} |`);
      markdownLines.push('');
      
      if (report.highVectorLowConsolidation.failureReasons && report.highVectorLowConsolidation.failureReasons.length > 0) {
        markdownLines.push('### 실패 사유');
        markdownLines.push('');
        report.highVectorLowConsolidation.failureReasons.forEach(reason => {
          markdownLines.push(`- [FAIL] ${reason}`);
        });
        markdownLines.push('');
      }
      
      // w2 상한 검증
      markdownLines.push('## w2 상한 검증');
      markdownLines.push('');
      markdownLines.push(`**검증 통과**: ${report.w2UpperBound.passed ? '[PASS] 통과' : '[FAIL] 실패'}`);
      markdownLines.push('');
      
      if (report.w2UpperBound.w2_04 && report.w2UpperBound.w2_06) {
        markdownLines.push('| 지표 | w2=0.4 | w2=0.6 | 품질 저하 |');
        markdownLines.push('|------|--------|--------|----------|');
        
        const kValues = Object.keys(report.w2UpperBound.w2_04.ndcg || {}).map(Number);
        kValues.forEach(k => {
          const ndcg4 = report.w2UpperBound.w2_04.ndcg[k] || 0;
          const ndcg6 = report.w2UpperBound.w2_06.ndcg[k] || 0;
          const degradation = report.w2UpperBound.degradation?.ndcg?.[k] || 0;
          markdownLines.push(`| NDCG@${k} | ${ndcg4.toFixed(3)} | ${ndcg6.toFixed(3)} | ${(degradation * 100).toFixed(2)}% |`);
        });
        markdownLines.push('');
      }
      
      if (report.w2UpperBound.failureReasons && report.w2UpperBound.failureReasons.length > 0) {
        markdownLines.push('### 실패 사유');
        markdownLines.push('');
        report.w2UpperBound.failureReasons.forEach(reason => {
          markdownLines.push(`- [FAIL] ${reason}`);
        });
        markdownLines.push('');
      }
      
      const markdownContent = markdownLines.join('\n');
      writeFileSync(markdownPath, markdownContent, 'utf-8');
    }
  } catch (error) {
    throw new Error(
      `극단적 시나리오 리포트 저장 실패: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * 통합 리포트 저장
 * 모든 리포트(순서 보존, 품질 비교, 극단적 시나리오)를 하나의 파일로 저장합니다.
 * 
 * @param reports 저장할 리포트들
 * @param options 저장 옵션
 * 
 * @example
 * ```typescript
 * const orderReport = generateOrderPreservationReport(pair);
 * const qualityReport = generateQualityComparisonReport(comparison, groundTruth);
 * const extremeReport = generateExtremeScenarioReport(lowVectorHigh, highVectorLow, w2Validation);
 * saveIntegratedReport({ orderReport, qualityReport, extremeReport }, { format: 'markdown' });
 * ```
 */
export interface IntegratedReports {
  orderReport?: OrderPreservationReport;
  qualityReport?: QualityComparisonReport;
  extremeReport?: ExtremeScenarioReport;
  baselineComparison?: BaselineComparisonResult;
  qualityDegradation?: QualityDegradationDetection;
}

export function saveIntegratedReport(
  reports: IntegratedReports,
  options: ReportSaveOptions = {}
): void {
  const {
    format = 'both',
    includeTimestamp = true
  } = options;
  
  const timestamp = includeTimestamp 
    ? `_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)}`
    : '';
  
  const defaultJsonPath = join(__dirname, `../../../data/vector-search-quality-report${timestamp}.json`);
  const defaultMarkdownPath = join(__dirname, `../../../data/vector-search-quality-report${timestamp}.md`);
  
  const jsonPath = options.filePath && format === 'json' 
    ? options.filePath 
    : format === 'both' 
      ? defaultJsonPath.replace('.md', '.json')
      : format === 'json'
        ? defaultJsonPath
        : undefined;
  
  const markdownPath = options.filePath && format === 'markdown'
    ? options.filePath
    : format === 'both'
      ? defaultMarkdownPath
      : format === 'markdown'
        ? defaultMarkdownPath
        : undefined;
  
  // 디렉토리 생성
  if (jsonPath) {
    const dir = dirname(jsonPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  
  if (markdownPath) {
    const dir = dirname(markdownPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  
  try {
    // JSON 형식 저장
    if (jsonPath) {
      const jsonContent = JSON.stringify(reports, null, 2);
      writeFileSync(jsonPath, jsonContent, 'utf-8');
    }
    
    // Markdown 형식 저장
    if (markdownPath) {
      const markdownLines: string[] = [];
      markdownLines.push('# 벡터 검색 품질 검증 통합 리포트');
      markdownLines.push('');
      markdownLines.push(`**생성 시간**: ${new Date().toISOString()}`);
      markdownLines.push('');
      
      // 순서 보존 리포트
      if (reports.orderReport) {
        markdownLines.push('## 1. 순서 보존 검증');
        markdownLines.push('');
        markdownLines.push(`**검증 통과**: ${reports.orderReport.passed ? '[PASS] 통과' : '[FAIL] 실패'}`);
        markdownLines.push('');
        markdownLines.push('| 지표 | 값 |');
        markdownLines.push('|------|-----|');
        markdownLines.push(`| Kendall's Tau | ${reports.orderReport.metrics.kendallTau.toFixed(3)} |`);
        markdownLines.push(`| Top10 유지율 | ${(reports.orderReport.metrics.top10Retention * 100).toFixed(2)}% |`);
        markdownLines.push(`| Top5 유지율 | ${(reports.orderReport.metrics.top5Retention * 100).toFixed(2)}% |`);
        markdownLines.push('');
      }
      
      // 품질 비교 리포트
      if (reports.qualityReport) {
        markdownLines.push('## 2. 품질 지표 비교');
        markdownLines.push('');
        const qualityMarkdown = visualizeQualityComparison(reports.qualityReport);
        // 헤더 제거하고 내용만 추가
        const qualityContent = qualityMarkdown.split('\n').slice(1).join('\n');
        markdownLines.push(qualityContent);
        markdownLines.push('');
      }
      
      // 극단적 시나리오 리포트
      if (reports.extremeReport) {
        markdownLines.push('## 3. 극단적 시나리오 검증');
        markdownLines.push('');
        markdownLines.push(`**전체 검증 통과**: ${reports.extremeReport.overallPassed ? '[PASS] 통과' : '[FAIL] 실패'}`);
        markdownLines.push('');
        markdownLines.push(`- **통과한 시나리오**: ${reports.extremeReport.summary.passedCount} / ${reports.extremeReport.summary.totalCount}`);
        if (reports.extremeReport.summary.failedScenarios.length > 0) {
          markdownLines.push(`- **실패한 시나리오**: ${reports.extremeReport.summary.failedScenarios.join(', ')}`);
        }
        markdownLines.push('');
      }
      
      // Baseline 비교 결과
      if (reports.baselineComparison) {
        markdownLines.push('## 4. Baseline 비교');
        markdownLines.push('');
        markdownLines.push(`**Baseline 버전**: ${reports.baselineComparison.baseline.version}`);
        markdownLines.push(`**Baseline 생성 시간**: ${reports.baselineComparison.baseline.timestamp}`);
        markdownLines.push(`**품질 저하 감지**: ${reports.baselineComparison.hasDegradation ? '[WARNING] 감지됨' : '[PASS] 없음'}`);
        markdownLines.push('');
        
        if (reports.baselineComparison.degradationDetails.length > 0) {
          markdownLines.push('### 저하 상세');
          markdownLines.push('');
          reports.baselineComparison.degradationDetails.forEach(detail => {
            markdownLines.push(`- [WARNING] ${detail}`);
          });
          markdownLines.push('');
        }
      }
      
      // 품질 저하 감지 결과
      if (reports.qualityDegradation) {
        markdownLines.push('## 5. 품질 저하 감지');
        markdownLines.push('');
        markdownLines.push(`**감지 여부**: ${reports.qualityDegradation.detected ? '[WARNING] 감지됨' : '[PASS] 없음'}`);
        markdownLines.push(`**심각도**: ${reports.qualityDegradation.severity}`);
        markdownLines.push('');
        
        if (reports.qualityDegradation.messages.length > 0) {
          markdownLines.push('### 경고 메시지');
          markdownLines.push('');
          reports.qualityDegradation.messages.forEach(message => {
            markdownLines.push(`- ${message}`);
          });
          markdownLines.push('');
        }
        
        if (reports.qualityDegradation.recommendations.length > 0) {
          markdownLines.push('### 권장사항');
          markdownLines.push('');
          reports.qualityDegradation.recommendations.forEach(recommendation => {
            markdownLines.push(`- ${recommendation}`);
          });
          markdownLines.push('');
        }
      }
      
      const markdownContent = markdownLines.join('\n');
      writeFileSync(markdownPath, markdownContent, 'utf-8');
    }
  } catch (error) {
    throw new Error(
      `통합 리포트 저장 실패: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
