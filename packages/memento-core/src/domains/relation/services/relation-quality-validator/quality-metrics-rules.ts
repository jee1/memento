import type { RelationType } from '../../../../shared/types/relation.js';
import { ALL_RELATION_TYPES } from '../../../../shared/types/relation.js';
import { analyzeAllRelationTypes, calculateConfusionMatrix } from './analysis-rules.js';
import { matchRelations } from './matching-rules.js';
import {
  calculateConfidenceComplianceRate,
  calculateF1Score,
  calculatePrecision,
  calculateRecall,
  calculateTypeMetrics,
} from './metric-rules.js';
import type {
  ExpectedRelation,
  ExtractedRelation,
  QualityMetrics,
  RelationMatch,
  TypeMetricSummary,
} from './types.js';

function emptyTypeMetric(): TypeMetricSummary {
  return {
    precision: 0,
    recall: 0,
    f1Score: 0,
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: 0,
  };
}

export function calculateQualityMetrics(
  expectedRelations: ExpectedRelation[],
  extractedRelations: ExtractedRelation[]
): QualityMetrics {
  const matches = matchRelations(expectedRelations, extractedRelations);

  const truePositives = matches.filter(m => m.isMatch).length;
  const falseNegatives = matches.filter(m => !m.isMatch).length;
  const matchedSourceTargets = new Set(
    matches.map(m => `${m.expected.source_id}:${m.expected.target_id}`)
  );
  const falsePositives = extractedRelations.filter(
    ext => !matchedSourceTargets.has(`${ext.source_id}:${ext.target_id}`)
  ).length;

  const precision = calculatePrecision(matches, extractedRelations);
  const recall = calculateRecall(matches, expectedRelations);
  const f1Score = calculateF1Score(precision, recall);

  const typeMetrics = Object.fromEntries(
    ALL_RELATION_TYPES.map(t => [t, emptyTypeMetric()])
  ) as Record<RelationType, TypeMetricSummary>;

  for (const type of ALL_RELATION_TYPES) {
    typeMetrics[type] = calculateTypeMetrics(
      matches,
      extractedRelations,
      expectedRelations,
      type
    );
  }

  const confidenceComplianceRate = calculateConfidenceComplianceRate(matches);

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
    totalExtracted: extractedRelations.length,
  };
}

export function validateThresholds(
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
      actual: metrics.precision,
    });
  }

  if (thresholds.recall !== undefined && metrics.recall < thresholds.recall) {
    failures.push({
      metric: 'recall',
      expected: thresholds.recall,
      actual: metrics.recall,
    });
  }

  if (thresholds.f1Score !== undefined && metrics.f1Score < thresholds.f1Score) {
    failures.push({
      metric: 'f1Score',
      expected: thresholds.f1Score,
      actual: metrics.f1Score,
    });
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}

export function calculateQualityMetricsWithAnalysis(
  expectedRelations: ExpectedRelation[],
  extractedRelations: ExtractedRelation[]
): QualityMetrics {
  const metrics = calculateQualityMetrics(expectedRelations, extractedRelations);
  const matches = matchRelations(expectedRelations, extractedRelations);
  const typeAnalysis = analyzeAllRelationTypes(matches, extractedRelations, expectedRelations);
  const confusionMatrix = calculateConfusionMatrix(matches);

  return {
    ...metrics,
    typeAnalysis,
    confusionMatrix,
  };
}

export type { RelationMatch };
