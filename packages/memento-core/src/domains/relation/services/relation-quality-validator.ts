/**
 * 관계 추출 품질 검증 서비스
 * Precision, Recall, F1-Score 계산 및 관계 유형별 정확도 분석
 */

export type {
  ConfusionMatrix,
  ExpectedRelation,
  ExtractedRelation,
  QualityMetrics,
  RelationMatch,
  TypeAnalysis,
} from './relation-quality-validator/types.js';

import type { RelationType } from '../../../shared/types/relation.js';
import {
  analyzeAllRelationTypes,
  analyzeRelationType,
  calculateConfusionMatrix,
} from './relation-quality-validator/analysis-rules.js';
import { matchRelations } from './relation-quality-validator/matching-rules.js';
import {
  calculateConfidenceComplianceRate,
  calculateF1Score,
  calculatePrecision,
  calculateRecall,
  calculateTypeMetrics,
} from './relation-quality-validator/metric-rules.js';
import {
  calculateQualityMetrics,
  calculateQualityMetricsWithAnalysis,
  validateThresholds,
} from './relation-quality-validator/quality-metrics-rules.js';
import type {
  ConfusionMatrix,
  ExpectedRelation,
  ExtractedRelation,
  QualityMetrics,
  RelationMatch,
  TypeAnalysis,
} from './relation-quality-validator/types.js';

/**
 * 관계 추출 품질 검증 서비스
 */
export class RelationQualityValidator {
  matchRelations(
    expectedRelations: ExpectedRelation[],
    extractedRelations: ExtractedRelation[]
  ): RelationMatch[] {
    return matchRelations(expectedRelations, extractedRelations);
  }

  calculatePrecision(matches: RelationMatch[], extractedRelations: ExtractedRelation[]): number {
    return calculatePrecision(matches, extractedRelations);
  }

  calculateRecall(matches: RelationMatch[], expectedRelations: ExpectedRelation[]): number {
    return calculateRecall(matches, expectedRelations);
  }

  calculateF1Score(precision: number, recall: number): number {
    return calculateF1Score(precision, recall);
  }

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
    return calculateTypeMetrics(matches, extractedRelations, expectedRelations, relationType);
  }

  calculateConfidenceComplianceRate(matches: RelationMatch[]): number {
    return calculateConfidenceComplianceRate(matches);
  }

  calculateQualityMetrics(
    expectedRelations: ExpectedRelation[],
    extractedRelations: ExtractedRelation[]
  ): QualityMetrics {
    return calculateQualityMetrics(expectedRelations, extractedRelations);
  }

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
    return validateThresholds(metrics, thresholds);
  }

  calculateConfusionMatrix(matches: RelationMatch[]): ConfusionMatrix {
    return calculateConfusionMatrix(matches);
  }

  analyzeRelationType(
    matches: RelationMatch[],
    extractedRelations: ExtractedRelation[],
    expectedRelations: ExpectedRelation[],
    relationType: RelationType
  ): TypeAnalysis {
    return analyzeRelationType(matches, extractedRelations, expectedRelations, relationType);
  }

  analyzeAllRelationTypes(
    matches: RelationMatch[],
    extractedRelations: ExtractedRelation[],
    expectedRelations: ExpectedRelation[]
  ): Record<RelationType, TypeAnalysis> {
    return analyzeAllRelationTypes(matches, extractedRelations, expectedRelations);
  }

  calculateQualityMetricsWithAnalysis(
    expectedRelations: ExpectedRelation[],
    extractedRelations: ExtractedRelation[]
  ): QualityMetrics {
    return calculateQualityMetricsWithAnalysis(expectedRelations, extractedRelations);
  }
}
