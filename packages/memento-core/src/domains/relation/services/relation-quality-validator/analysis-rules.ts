import type { RelationType } from '../../../../shared/types/relation.js';
import { ALL_RELATION_TYPES } from '../../../../shared/types/relation.js';
import { calculateTypeMetrics } from './metric-rules.js';
import type {
  ConfusionMatrix,
  ExpectedRelation,
  ExtractedRelation,
  RelationMatch,
  TypeAnalysis,
} from './types.js';

export function calculateConfusionMatrix(matches: RelationMatch[]): ConfusionMatrix {
  const relationTypes = ALL_RELATION_TYPES;

  const confusionZeroRow = (): Record<RelationType, number> =>
    Object.fromEntries(relationTypes.map(t => [t, 0])) as Record<RelationType, number>;
  const matrix = Object.fromEntries(
    relationTypes.map(t => [t, confusionZeroRow()])
  ) as Record<RelationType, Record<RelationType, number>>;

  for (const match of matches) {
    const actualType = match.expected.expected_relation_type;

    if (match.extracted) {
      const predictedType = match.extracted.relation_type;
      matrix[actualType][predictedType]++;
    }
  }

  const typeAccuracy = Object.fromEntries(relationTypes.map(t => [t, 0])) as Record<
    RelationType,
    number
  >;
  for (const type of relationTypes) {
    const totalForType = matches.filter(m => m.expected.expected_relation_type === type).length;

    if (totalForType === 0) {
      typeAccuracy[type] = 0;
    } else {
      const correct = matrix[type][type];
      typeAccuracy[type] = correct / totalForType;
    }
  }

  const totalMatches = matches.length;
  const totalCorrect = relationTypes.reduce((sum, type) => sum + matrix[type][type], 0);
  const overallAccuracy = totalMatches === 0 ? 0 : totalCorrect / totalMatches;

  return {
    matrix,
    overallAccuracy,
    typeAccuracy,
  };
}

export function analyzeRelationType(
  matches: RelationMatch[],
  extractedRelations: ExtractedRelation[],
  expectedRelations: ExpectedRelation[],
  relationType: RelationType
): TypeAnalysis {
  const basicMetrics = calculateTypeMetrics(
    matches,
    extractedRelations,
    expectedRelations,
    relationType
  );

  const extractedForType = extractedRelations.filter(ext => ext.relation_type === relationType);
  const confidences = extractedForType.map(ext => ext.confidence);
  const averageConfidence =
    confidences.length === 0 ? 0 : confidences.reduce((sum, c) => sum + c, 0) / confidences.length;
  const variance =
    confidences.length === 0
      ? 0
      : confidences.reduce((sum, c) => sum + Math.pow(c - averageConfidence, 2), 0) / confidences.length;
  const confidenceStdDev = Math.sqrt(variance);
  const minConfidence = confidences.length === 0 ? 0 : Math.min(...confidences);
  const maxConfidence = confidences.length === 0 ? 0 : Math.max(...confidences);

  const confusionMatrix = Object.fromEntries(ALL_RELATION_TYPES.map(t => [t, 0])) as Record<
    RelationType,
    number
  >;

  const matchesForType = matches.filter(
    m => m.expected.expected_relation_type === relationType && m.extracted !== null
  );

  for (const match of matchesForType) {
    if (match.extracted && match.extracted.relation_type !== relationType) {
      confusionMatrix[match.extracted.relation_type]++;
    }
  }

  let mostConfusedWith: RelationType | null = null;
  let maxConfusion = 0;
  for (const [type, count] of Object.entries(confusionMatrix)) {
    if (count > maxConfusion) {
      maxConfusion = count;
      mostConfusedWith = type as RelationType;
    }
  }

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
    confusionRate,
  };
}

export function analyzeAllRelationTypes(
  matches: RelationMatch[],
  extractedRelations: ExtractedRelation[],
  expectedRelations: ExpectedRelation[]
): Record<RelationType, TypeAnalysis> {
  return Object.fromEntries(
    ALL_RELATION_TYPES.map(t => [
      t,
      analyzeRelationType(matches, extractedRelations, expectedRelations, t),
    ])
  ) as Record<RelationType, TypeAnalysis>;
}
