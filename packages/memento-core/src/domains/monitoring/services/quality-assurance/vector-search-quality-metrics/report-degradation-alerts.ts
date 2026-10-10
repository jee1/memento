/**
 * 벡터 검색 품질 검증 — 품질 저하 감지와 알림
 * (#910: report-comparison.ts 에서 분리)
 */

import type { BaselineComparisonResult } from './report-baseline.js';

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
