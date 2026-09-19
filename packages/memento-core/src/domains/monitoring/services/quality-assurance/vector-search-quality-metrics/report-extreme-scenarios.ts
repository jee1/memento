/**
 * 벡터 검색 품질 검증 — 극단적 시나리오 검증
 * (#910: report-comparison.ts 에서 분리)
 */

import type { SearchResult } from '../search-quality-metrics.js';
import type { HybridSearchResult } from '../../../../search/algorithms/hybrid-search-engine.js';
import {
  measureConsolidationQuality,
  calculateQualityDegradation,
} from './report-quality-comparison.js';
import type { QualityMetrics, QualityDegradation } from './report-quality-comparison.js';

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

