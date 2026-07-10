import type { RelationType } from '../../../../shared/types/relation.js';

/**
 * 예상 관계 (Ground Truth)
 */
export interface ExpectedRelation {
  source_id: string;
  target_id: string;
  expected_relation_type: RelationType;
  expected_confidence_range: [number, number];
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
  averageConfidence: number;
  confidenceStdDev: number;
  minConfidence: number;
  maxConfidence: number;
  confusionMatrix: Record<RelationType, number>;
  mostConfusedWith: RelationType | null;
  confusionRate: number;
}

/**
 * 혼동 행렬 (Confusion Matrix)
 */
export interface ConfusionMatrix {
  matrix: Record<RelationType, Record<RelationType, number>>;
  overallAccuracy: number;
  typeAccuracy: Record<RelationType, number>;
}

/**
 * 품질 메트릭
 */
export interface QualityMetrics {
  precision: number;
  recall: number;
  f1Score: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  typeMetrics: Record<
    RelationType,
    {
      precision: number;
      recall: number;
      f1Score: number;
      truePositives: number;
      falsePositives: number;
      falseNegatives: number;
    }
  >;
  confidenceComplianceRate: number;
  totalExpected: number;
  totalExtracted: number;
  typeAnalysis?: Record<RelationType, TypeAnalysis>;
  confusionMatrix?: ConfusionMatrix;
}

export interface TypeMetricSummary {
  precision: number;
  recall: number;
  f1Score: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
}
