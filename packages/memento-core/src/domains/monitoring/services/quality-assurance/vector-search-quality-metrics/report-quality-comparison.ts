/**
 * 벡터 검색 품질 검증 — 품질 지표 측정과 Ground Truth 비교
 * (#910: report-comparison.ts 에서 분리)
 */

import type { SearchResult } from '../search-quality-metrics.js';
import {
  calculatePrecisionAtK,
  calculateRecallAtK,
  calculateNDCGAtK
} from '../search-quality-metrics.js';

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
function measureVectorOnlyQuality(
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
function validateQualityThresholds(
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

