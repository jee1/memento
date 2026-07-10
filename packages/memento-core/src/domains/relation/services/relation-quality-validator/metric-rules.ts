import type { RelationType } from '../../../../shared/types/relation.js';
import type {
  ExpectedRelation,
  ExtractedRelation,
  RelationMatch,
  TypeMetricSummary,
} from './types.js';

export function calculatePrecision(
  matches: RelationMatch[],
  extractedRelations: ExtractedRelation[]
): number {
  const truePositives = matches.filter(m => m.isMatch).length;
  const totalExtracted = extractedRelations.length;

  if (totalExtracted === 0) {
    return 0;
  }

  const matchedSourceTargets = new Set(
    matches.map(m => `${m.expected.source_id}:${m.expected.target_id}`)
  );
  const falsePositives = extractedRelations.filter(
    ext => !matchedSourceTargets.has(`${ext.source_id}:${ext.target_id}`)
  ).length;

  return truePositives / (truePositives + falsePositives);
}

export function calculateRecall(
  matches: RelationMatch[],
  expectedRelations: ExpectedRelation[]
): number {
  const truePositives = matches.filter(m => m.isMatch).length;
  const falseNegatives = matches.filter(m => !m.isMatch).length;
  const totalExpected = expectedRelations.length;

  if (totalExpected === 0) {
    return 0;
  }

  return truePositives / (truePositives + falseNegatives);
}

export function calculateF1Score(precision: number, recall: number): number {
  if (precision === 0 && recall === 0) {
    return 0;
  }

  return (2 * precision * recall) / (precision + recall);
}

export function calculateTypeMetrics(
  matches: RelationMatch[],
  extractedRelations: ExtractedRelation[],
  expectedRelations: ExpectedRelation[],
  relationType: RelationType
): TypeMetricSummary {
  const expectedForType = expectedRelations.filter(
    exp => exp.expected_relation_type === relationType
  );
  const extractedForType = extractedRelations.filter(
    ext => ext.relation_type === relationType
  );
  const matchesForType = matches.filter(
    m => m.expected.expected_relation_type === relationType
  );

  const truePositives = matchesForType.filter(m => m.isMatch).length;
  const matchedSourceTargets = new Set(
    matchesForType.map(m => `${m.expected.source_id}:${m.expected.target_id}`)
  );
  const falsePositives = extractedForType.filter(
    ext => !matchedSourceTargets.has(`${ext.source_id}:${ext.target_id}`)
  ).length;
  const falseNegatives = matchesForType.filter(m => !m.isMatch).length;

  const precision =
    truePositives + falsePositives === 0 ? 0 : truePositives / (truePositives + falsePositives);
  const recall =
    expectedForType.length === 0 ? 0 : truePositives / (truePositives + falseNegatives);
  const f1Score = calculateF1Score(precision, recall);

  return {
    precision,
    recall,
    f1Score,
    truePositives,
    falsePositives,
    falseNegatives,
  };
}

export function calculateConfidenceComplianceRate(matches: RelationMatch[]): number {
  const withExtracted = matches.filter(m => m.extracted !== null);

  if (withExtracted.length === 0) {
    return 0;
  }

  const inRange = withExtracted.filter(m => m.isConfidenceInRange).length;
  return inRange / withExtracted.length;
}
