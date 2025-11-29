/**
 * 관계 추출 품질 검증 서비스
 * Precision, Recall, F1-Score 계산 및 관계 유형별 정확도 분석
 */

import type { RelationType } from '../../../../shared/types/relation.js';
import type { RelationCandidate } from '../../../../shared/types/relation.js';
import { ALL_RELATION_TYPES } from '../../../../shared/types/relation.js';

/**
 * 예상 관계 (Ground Truth)
 */
export interface ExpectedRelation {
  source_id: string;
  target_id: string;
  expected_relation_type: RelationType;
  expected_confidence_range: [number, number]; // [min, max]
  source_content: string;
  target_content: string;
}

/**
 * 실제 추출된 관계
 */
export interface ExtractedRelation {
  source_id: string;
  target_id: string;
  relation_type: RelationType;
  confidence: number;
}

/**
 * 관계 매칭 결과
 */
export interface RelationMatch {
  expected: ExpectedRelation;
  extracted: ExtractedRelation | null;
  isMatch: boolean;
  isTypeMatch: boolean;
  isConfidenceInRange: boolean;
}

/**
 * 관계 유형별 상세 분석
 */
export interface TypeAnalysis {
  relationType: RelationType;
  precision: number;
  recall: number;
  f1Score: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  
  // 상세 통계
  averageConfidence: number; // 평균 신뢰도
  confidenceStdDev: number; // 신뢰도 표준편차
  minConfidence: number;
  maxConfidence: number;
  
  // 혼동 행렬 (이 관계 유형이 다른 관계 유형으로 잘못 분류된 횟수)
  confusionMatrix: Record<RelationType, number>;
  
  // 오류 분석
  mostConfusedWith: RelationType | null; // 가장 많이 혼동되는 관계 유형
  confusionRate: number; // 혼동 비율 (0-1)
}

/**
 * 혼동 행렬 (Confusion Matrix)
 * 실제 관계 유형 vs 예측 관계 유형
 */
export interface ConfusionMatrix {
  // [실제 관계 유형][예측 관계 유형] = 개수
  matrix: Record<RelationType, Record<RelationType, number>>;
  
  // 전체 정확도
  overallAccuracy: number;
  
  // 관계 유형별 정확도
  typeAccuracy: Record<RelationType, number>;
}

/**
 * 품질 메트릭
 */
export interface QualityMetrics {
  // 전체 메트릭
  precision: number;
  recall: number;
  f1Score: number;
  
  // 카운트
  truePositives: number;  // 올바르게 추출된 관계
  falsePositives: number; // 잘못 추출된 관계 (예상에 없음)
  falseNegatives: number; // 누락된 관계 (예상에 있지만 추출되지 않음)
  
  // 관계 유형별 메트릭
  typeMetrics: Record<RelationType, {
    precision: number;
    recall: number;
    f1Score: number;
    truePositives: number;
    falsePositives: number;
    falseNegatives: number;
  }>;
  
  // 신뢰도 범위 준수율
  confidenceComplianceRate: number;
  
  // 총 예상 관계 수
  totalExpected: number;
  
  // 총 추출된 관계 수
  totalExtracted: number;
  
  // 관계 유형별 상세 분석 (6.4 추가)
  typeAnalysis?: Record<RelationType, TypeAnalysis>;
  
  // 혼동 행렬 (6.4 추가)
  confusionMatrix?: ConfusionMatrix;
}

/**
 * 관계 추출 품질 검증 서비스
 */
export class RelationQualityValidator {
  /**
   * 관계 매칭: 예상 관계와 추출된 관계를 매칭
   * 
   * Given: 예상 관계 목록과 추출된 관계 목록
   * When: source_id와 target_id로 매칭
   * Then: 매칭 결과 반환
   */
  matchRelations(
    expectedRelations: ExpectedRelation[],
    extractedRelations: ExtractedRelation[]
  ): RelationMatch[] {
    // 추출된 관계를 Map으로 변환 (key: `${source_id}:${target_id}`)
    const extractedMap = new Map<string, ExtractedRelation>();
    for (const extracted of extractedRelations) {
      const key = `${extracted.source_id}:${extracted.target_id}`;
      extractedMap.set(key, extracted);
    }

    // 예상 관계와 매칭
    const matches: RelationMatch[] = expectedRelations.map(expected => {
      const key = `${expected.source_id}:${expected.target_id}`;
      const extracted = extractedMap.get(key) || null;

      if (!extracted) {
        return {
          expected,
          extracted: null,
          isMatch: false,
          isTypeMatch: false,
          isConfidenceInRange: false
        };
      }

      // 관계 유형 일치 확인
      const isTypeMatch = extracted.relation_type === expected.expected_relation_type;

      // 신뢰도 범위 확인
      const [minConfidence, maxConfidence] = expected.expected_confidence_range;
      const isConfidenceInRange = 
        extracted.confidence >= minConfidence && 
        extracted.confidence <= maxConfidence;

      // 완전 일치: 관계 유형과 신뢰도 범위 모두 일치
      const isMatch = isTypeMatch && isConfidenceInRange;

      return {
        expected,
        extracted,
        isMatch,
        isTypeMatch,
        isConfidenceInRange
      };
    });

    return matches;
  }

  /**
   * Precision 계산
   * Precision = TP / (TP + FP)
   * 
   * Given: 매칭 결과
   * When: 추출된 관계 중 올바른 관계 비율 계산
   * Then: Precision 값 반환
   */
  calculatePrecision(matches: RelationMatch[], extractedRelations: ExtractedRelation[]): number {
    const truePositives = matches.filter(m => m.isMatch).length;
    const totalExtracted = extractedRelations.length;

    if (totalExtracted === 0) {
      return 0; // 추출된 관계가 없으면 Precision은 0
    }

    // False Positives: 추출되었지만 예상에 없는 관계
    const matchedSourceTargets = new Set(
      matches.map(m => `${m.expected.source_id}:${m.expected.target_id}`)
    );
    const falsePositives = extractedRelations.filter(
      ext => !matchedSourceTargets.has(`${ext.source_id}:${ext.target_id}`)
    ).length;

    return truePositives / (truePositives + falsePositives);
  }

  /**
   * Recall 계산
   * Recall = TP / (TP + FN)
   * 
   * Given: 매칭 결과와 예상 관계 목록
   * When: 예상 관계 중 올바르게 추출된 관계 비율 계산
   * Then: Recall 값 반환
   */
  calculateRecall(matches: RelationMatch[], expectedRelations: ExpectedRelation[]): number {
    const truePositives = matches.filter(m => m.isMatch).length;
    const falseNegatives = matches.filter(m => !m.isMatch).length;
    const totalExpected = expectedRelations.length;

    if (totalExpected === 0) {
      return 0; // 예상 관계가 없으면 Recall은 0
    }

    return truePositives / (truePositives + falseNegatives);
  }

  /**
   * F1-Score 계산
   * F1 = 2 * (Precision * Recall) / (Precision + Recall)
   * 
   * Given: Precision과 Recall
   * When: 조화 평균 계산
   * Then: F1-Score 값 반환
   */
  calculateF1Score(precision: number, recall: number): number {
    if (precision === 0 && recall === 0) {
      return 0;
    }

    return (2 * precision * recall) / (precision + recall);
  }

  /**
   * 관계 유형별 메트릭 계산
   * 
   * Given: 매칭 결과와 관계 유형
   * When: 특정 관계 유형에 대한 Precision, Recall, F1-Score 계산
   * Then: 관계 유형별 메트릭 반환
   */
  calculateTypeMetrics(
    matches: RelationMatch[],
    extractedRelations: ExtractedRelation[],
    expectedRelations: ExpectedRelation[],
    relationType: RelationType
  ): {
    precision: number;
    recall: number;
    f1Score: number;
    truePositives: number;
    falsePositives: number;
    falseNegatives: number;
  } {
    // 해당 관계 유형의 예상 관계 필터링
    const expectedForType = expectedRelations.filter(
      exp => exp.expected_relation_type === relationType
    );

    // 해당 관계 유형의 추출된 관계 필터링
    const extractedForType = extractedRelations.filter(
      ext => ext.relation_type === relationType
    );

    // 해당 관계 유형의 매칭 결과 필터링
    const matchesForType = matches.filter(
      m => m.expected.expected_relation_type === relationType
    );

    // True Positives: 관계 유형이 일치하고 완전히 일치하는 경우
    const truePositives = matchesForType.filter(m => m.isMatch).length;

    // False Positives: 추출되었지만 예상에 없거나 관계 유형이 다른 경우
    const matchedSourceTargets = new Set(
      matchesForType.map(m => `${m.expected.source_id}:${m.expected.target_id}`)
    );
    const falsePositives = extractedForType.filter(
      ext => !matchedSourceTargets.has(`${ext.source_id}:${ext.target_id}`)
    ).length;

    // False Negatives: 예상에 있지만 추출되지 않았거나 관계 유형이 다른 경우
    const falseNegatives = matchesForType.filter(m => !m.isMatch).length;

    // Precision 계산
    const precision = (truePositives + falsePositives) === 0
      ? 0
      : truePositives / (truePositives + falsePositives);

    // Recall 계산
    const recall = expectedForType.length === 0
      ? 0
      : truePositives / (truePositives + falseNegatives);

    // F1-Score 계산
    const f1Score = this.calculateF1Score(precision, recall);

    return {
      precision,
      recall,
      f1Score,
      truePositives,
      falsePositives,
      falseNegatives
    };
  }

  /**
   * 신뢰도 범위 준수율 계산
   * 
   * Given: 매칭 결과
   * When: 추출된 관계 중 신뢰도가 예상 범위 내에 있는 비율 계산
   * Then: 준수율 반환
   */
  calculateConfidenceComplianceRate(matches: RelationMatch[]): number {
    const withExtracted = matches.filter(m => m.extracted !== null);
    
    if (withExtracted.length === 0) {
      return 0;
    }

    const inRange = withExtracted.filter(m => m.isConfidenceInRange).length;
    return inRange / withExtracted.length;
  }

  /**
   * 전체 품질 메트릭 계산
   * 
   * Given: 예상 관계 목록과 추출된 관계 목록
   * When: 모든 메트릭 계산
   * Then: 완전한 품질 메트릭 반환
   */
  calculateQualityMetrics(
    expectedRelations: ExpectedRelation[],
    extractedRelations: ExtractedRelation[]
  ): QualityMetrics {
    // 관계 매칭
    const matches = this.matchRelations(expectedRelations, extractedRelations);

    // 전체 메트릭 계산
    const truePositives = matches.filter(m => m.isMatch).length;
    const falseNegatives = matches.filter(m => !m.isMatch).length;

    // False Positives: 추출되었지만 예상에 없는 관계
    const matchedSourceTargets = new Set(
      matches.map(m => `${m.expected.source_id}:${m.expected.target_id}`)
    );
    const falsePositives = extractedRelations.filter(
      ext => !matchedSourceTargets.has(`${ext.source_id}:${ext.target_id}`)
    ).length;

    const precision = this.calculatePrecision(matches, extractedRelations);
    const recall = this.calculateRecall(matches, expectedRelations);
    const f1Score = this.calculateF1Score(precision, recall);

    // 관계 유형별 메트릭 계산
    const relationTypes = ALL_RELATION_TYPES;

    const typeMetrics: Record<RelationType, {
      precision: number;
      recall: number;
      f1Score: number;
      truePositives: number;
      falsePositives: number;
      falseNegatives: number;
    }> = {
      CAUSES: { precision: 0, recall: 0, f1Score: 0, truePositives: 0, falsePositives: 0, falseNegatives: 0 },
      DEPENDS_ON: { precision: 0, recall: 0, f1Score: 0, truePositives: 0, falsePositives: 0, falseNegatives: 0 },
      FOLLOWS: { precision: 0, recall: 0, f1Score: 0, truePositives: 0, falsePositives: 0, falseNegatives: 0 },
      CONTRASTS_WITH: { precision: 0, recall: 0, f1Score: 0, truePositives: 0, falsePositives: 0, falseNegatives: 0 },
      REFERENCES: { precision: 0, recall: 0, f1Score: 0, truePositives: 0, falsePositives: 0, falseNegatives: 0 },
      BELONGS_TO: { precision: 0, recall: 0, f1Score: 0, truePositives: 0, falsePositives: 0, falseNegatives: 0 }
    };

    for (const type of relationTypes) {
      typeMetrics[type] = this.calculateTypeMetrics(
        matches,
        extractedRelations,
        expectedRelations,
        type
      );
    }

    // 신뢰도 범위 준수율
    const confidenceComplianceRate = this.calculateConfidenceComplianceRate(matches);

    return {
      precision,
      recall,
      f1Score,
      truePositives,
      falsePositives,
      falseNegatives,
      typeMetrics,
      confidenceComplianceRate,
      totalExpected: expectedRelations.length,
      totalExtracted: extractedRelations.length
    };
  }

  /**
   * 메트릭이 임계값을 만족하는지 확인
   * 
   * Given: 품질 메트릭과 임계값
   * When: 각 메트릭이 임계값 이상인지 확인
   * Then: 검증 결과 반환
   */
  validateThresholds(
    metrics: QualityMetrics,
    thresholds: {
      precision?: number;
      recall?: number;
      f1Score?: number;
    }
  ): {
    passed: boolean;
    failures: Array<{ metric: string; expected: number; actual: number }>;
  } {
    const failures: Array<{ metric: string; expected: number; actual: number }> = [];

    if (thresholds.precision !== undefined && metrics.precision < thresholds.precision) {
      failures.push({
        metric: 'precision',
        expected: thresholds.precision,
        actual: metrics.precision
      });
    }

    if (thresholds.recall !== undefined && metrics.recall < thresholds.recall) {
      failures.push({
        metric: 'recall',
        expected: thresholds.recall,
        actual: metrics.recall
      });
    }

    if (thresholds.f1Score !== undefined && metrics.f1Score < thresholds.f1Score) {
      failures.push({
        metric: 'f1Score',
        expected: thresholds.f1Score,
        actual: metrics.f1Score
      });
    }

    return {
      passed: failures.length === 0,
      failures
    };
  }

  /**
   * 혼동 행렬 계산
   * 실제 관계 유형과 예측 관계 유형의 매칭 행렬
   * 
   * Given: 매칭 결과
   * When: 실제 관계 유형과 예측 관계 유형을 매핑
   * Then: 혼동 행렬 반환
   */
  calculateConfusionMatrix(matches: RelationMatch[]): ConfusionMatrix {
    const relationTypes = ALL_RELATION_TYPES;

    // 혼동 행렬 초기화
    const matrix: Record<RelationType, Record<RelationType, number>> = {
      CAUSES: { CAUSES: 0, DEPENDS_ON: 0, FOLLOWS: 0, CONTRASTS_WITH: 0, REFERENCES: 0, BELONGS_TO: 0 },
      DEPENDS_ON: { CAUSES: 0, DEPENDS_ON: 0, FOLLOWS: 0, CONTRASTS_WITH: 0, REFERENCES: 0, BELONGS_TO: 0 },
      FOLLOWS: { CAUSES: 0, DEPENDS_ON: 0, FOLLOWS: 0, CONTRASTS_WITH: 0, REFERENCES: 0, BELONGS_TO: 0 },
      CONTRASTS_WITH: { CAUSES: 0, DEPENDS_ON: 0, FOLLOWS: 0, CONTRASTS_WITH: 0, REFERENCES: 0, BELONGS_TO: 0 },
      REFERENCES: { CAUSES: 0, DEPENDS_ON: 0, FOLLOWS: 0, CONTRASTS_WITH: 0, REFERENCES: 0, BELONGS_TO: 0 },
      BELONGS_TO: { CAUSES: 0, DEPENDS_ON: 0, FOLLOWS: 0, CONTRASTS_WITH: 0, REFERENCES: 0, BELONGS_TO: 0 }
    };

    // 매칭 결과를 기반으로 혼동 행렬 채우기
    for (const match of matches) {
      const actualType = match.expected.expected_relation_type;
      
      if (match.extracted) {
        const predictedType = match.extracted.relation_type;
        matrix[actualType][predictedType]++;
      } else {
        // 추출되지 않은 경우는 false negative로 처리 (실제 유형 -> null)
        // 혼동 행렬에서는 실제 유형의 총합에만 포함
      }
    }

    // 관계 유형별 정확도 계산
    const typeAccuracy: Record<RelationType, number> = {
      CAUSES: 0,
      DEPENDS_ON: 0,
      FOLLOWS: 0,
      CONTRASTS_WITH: 0,
      REFERENCES: 0,
      BELONGS_TO: 0
    };
    for (const type of relationTypes) {
      const totalForType = matches.filter(
        m => m.expected.expected_relation_type === type
      ).length;
      
      if (totalForType === 0) {
        typeAccuracy[type] = 0;
      } else {
        const correct = matrix[type][type]; // 올바르게 분류된 개수
        typeAccuracy[type] = correct / totalForType;
      }
    }

    // 전체 정확도 계산
    const totalMatches = matches.length;
    const totalCorrect = relationTypes.reduce(
      (sum, type) => sum + matrix[type][type],
      0
    );
    const overallAccuracy = totalMatches === 0 ? 0 : totalCorrect / totalMatches;

    return {
      matrix,
      overallAccuracy,
      typeAccuracy
    };
  }

  /**
   * 관계 유형별 상세 분석
   * 
   * Given: 매칭 결과, 추출된 관계, 예상 관계, 관계 유형
   * When: 상세 통계 및 혼동 분석 수행
   * Then: 관계 유형별 상세 분석 반환
   */
  analyzeRelationType(
    matches: RelationMatch[],
    extractedRelations: ExtractedRelation[],
    expectedRelations: ExpectedRelation[],
    relationType: RelationType
  ): TypeAnalysis {
    // 기본 메트릭 계산
    const basicMetrics = this.calculateTypeMetrics(
      matches,
      extractedRelations,
      expectedRelations,
      relationType
    );

    // 해당 관계 유형의 추출된 관계 필터링
    const extractedForType = extractedRelations.filter(
      ext => ext.relation_type === relationType
    );

    // 신뢰도 통계 계산
    const confidences = extractedForType.map(ext => ext.confidence);
    const averageConfidence = confidences.length === 0
      ? 0
      : confidences.reduce((sum, c) => sum + c, 0) / confidences.length;

    // 표준편차 계산
    const variance = confidences.length === 0
      ? 0
      : confidences.reduce((sum, c) => sum + Math.pow(c - averageConfidence, 2), 0) / confidences.length;
    const confidenceStdDev = Math.sqrt(variance);

    const minConfidence = confidences.length === 0 ? 0 : Math.min(...confidences);
    const maxConfidence = confidences.length === 0 ? 0 : Math.max(...confidences);

    // 혼동 행렬 계산 (이 관계 유형이 다른 관계 유형으로 잘못 분류된 횟수)
    const confusionMatrix: Record<RelationType, number> = {
      CAUSES: 0,
      DEPENDS_ON: 0,
      FOLLOWS: 0,
      CONTRASTS_WITH: 0,
      REFERENCES: 0,
      BELONGS_TO: 0
    };

    // 예상 관계 유형이 relationType인데 다른 유형으로 추출된 경우
    const matchesForType = matches.filter(
      m => m.expected.expected_relation_type === relationType && m.extracted !== null
    );

    for (const match of matchesForType) {
      if (match.extracted && match.extracted.relation_type !== relationType) {
        confusionMatrix[match.extracted.relation_type]++;
      }
    }

    // 가장 많이 혼동되는 관계 유형 찾기
    let mostConfusedWith: RelationType | null = null;
    let maxConfusion = 0;
    for (const [type, count] of Object.entries(confusionMatrix)) {
      if (count > maxConfusion) {
        maxConfusion = count;
        mostConfusedWith = type as RelationType;
      }
    }

    // 혼동 비율 계산 (전체 추출 중 잘못 분류된 비율)
    const totalExtracted = extractedForType.length;
    const totalConfused = Object.values(confusionMatrix).reduce((sum, count) => sum + count, 0);
    const confusionRate = totalExtracted === 0 ? 0 : totalConfused / totalExtracted;

    return {
      relationType,
      precision: basicMetrics.precision,
      recall: basicMetrics.recall,
      f1Score: basicMetrics.f1Score,
      truePositives: basicMetrics.truePositives,
      falsePositives: basicMetrics.falsePositives,
      falseNegatives: basicMetrics.falseNegatives,
      averageConfidence,
      confidenceStdDev,
      minConfidence,
      maxConfidence,
      confusionMatrix,
      mostConfusedWith,
      confusionRate
    };
  }

  /**
   * 모든 관계 유형별 상세 분석 수행
   * 
   * Given: 매칭 결과, 추출된 관계, 예상 관계
   * When: 모든 관계 유형에 대해 상세 분석 수행
   * Then: 관계 유형별 상세 분석 맵 반환
   */
  analyzeAllRelationTypes(
    matches: RelationMatch[],
    extractedRelations: ExtractedRelation[],
    expectedRelations: ExpectedRelation[]
  ): Record<RelationType, TypeAnalysis> {
    const relationTypes = ALL_RELATION_TYPES;

    // 모든 관계 유형에 대해 분석 수행
    const analysis: Record<RelationType, TypeAnalysis> = {
      CAUSES: this.analyzeRelationType(matches, extractedRelations, expectedRelations, 'CAUSES'),
      DEPENDS_ON: this.analyzeRelationType(matches, extractedRelations, expectedRelations, 'DEPENDS_ON'),
      FOLLOWS: this.analyzeRelationType(matches, extractedRelations, expectedRelations, 'FOLLOWS'),
      CONTRASTS_WITH: this.analyzeRelationType(matches, extractedRelations, expectedRelations, 'CONTRASTS_WITH'),
      REFERENCES: this.analyzeRelationType(matches, extractedRelations, expectedRelations, 'REFERENCES'),
      BELONGS_TO: this.analyzeRelationType(matches, extractedRelations, expectedRelations, 'BELONGS_TO')
    };

    return analysis;
  }

  /**
   * 전체 품질 메트릭 계산 (상세 분석 포함)
   * 
   * Given: 예상 관계 목록과 추출된 관계 목록
   * When: 모든 메트릭 및 상세 분석 계산
   * Then: 완전한 품질 메트릭 반환 (관계 유형별 분석 및 혼동 행렬 포함)
   */
  calculateQualityMetricsWithAnalysis(
    expectedRelations: ExpectedRelation[],
    extractedRelations: ExtractedRelation[]
  ): QualityMetrics {
    // 기본 메트릭 계산
    const metrics = this.calculateQualityMetrics(expectedRelations, extractedRelations);

    // 관계 매칭
    const matches = this.matchRelations(expectedRelations, extractedRelations);

    // 관계 유형별 상세 분석
    const typeAnalysis = this.analyzeAllRelationTypes(
      matches,
      extractedRelations,
      expectedRelations
    );

    // 혼동 행렬 계산
    const confusionMatrix = this.calculateConfusionMatrix(matches);

    return {
      ...metrics,
      typeAnalysis,
      confusionMatrix
    };
  }
}
