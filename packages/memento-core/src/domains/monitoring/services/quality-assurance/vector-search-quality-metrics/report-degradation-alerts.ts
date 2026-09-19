/**
 * 벡터 검색 품질 검증 — 품질 저하 감지와 알림
 * (#910: report-comparison.ts 에서 분리)
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
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
    useColors: _useColors = true,
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
