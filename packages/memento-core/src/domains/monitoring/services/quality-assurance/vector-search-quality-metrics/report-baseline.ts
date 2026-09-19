/**
 * 벡터 검색 품질 검증 — baseline 스냅샷 저장·로드·비교
 * (#910: report-comparison.ts 에서 분리)
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import type { OrderPreservationReport } from './types.js';
import { reportOutputRoot } from './report-paths.js';
import type { QualityMetrics } from './report-quality-comparison.js';
import type { ExtremeScenarioReport } from './report-extreme-scenarios.js';

const __dirname = reportOutputRoot;

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

