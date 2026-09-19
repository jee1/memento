/**
 * 벡터 검색 품질 검증 — 검색 결과 생성과 순서 보존 리포트
 * (#910: report-comparison.ts 에서 분리)
 */

import type { SearchResult } from '../search-quality-metrics.js';
import type { HybridSearchResult } from '../../../../search/algorithms/hybrid-search-engine.js';
import { hybridFusionRelevance } from '../../../../search/algorithms/hybrid-result-ranker.js';
import { HYBRID_SEARCH } from '../../../../../shared/config/constants.js';
import { calculateKendallTau } from './kendall-tau.js';
import { calculateSpearmanRho } from './spearman.js';
import { calculateTopKRetention } from './top-k-retention.js';
import type {
  SearchResultPair,
  OrderPreservationMetrics,
  OrderPreservationReport,
} from './types.js';

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
        relevance: hybridFusionRelevance(
          result.textScore,
          result.vectorScore,
          HYBRID_SEARCH.DEFAULT_TEXT_WEIGHT,
          HYBRID_SEARCH.DEFAULT_VECTOR_WEIGHT
        )
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

