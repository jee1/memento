import type {
  ExpectedRelation,
  ExtractedRelation,
  RelationMatch,
} from './types.js';

export function matchRelations(
  expectedRelations: ExpectedRelation[],
  extractedRelations: ExtractedRelation[]
): RelationMatch[] {
  const extractedMap = new Map<string, ExtractedRelation>();
  for (const extracted of extractedRelations) {
    const key = `${extracted.source_id}:${extracted.target_id}`;
    extractedMap.set(key, extracted);
  }

  return expectedRelations.map(expected => {
    const key = `${expected.source_id}:${expected.target_id}`;
    const extracted = extractedMap.get(key) || null;

    if (!extracted) {
      return {
        expected,
        extracted: null,
        isMatch: false,
        isTypeMatch: false,
        isConfidenceInRange: false,
      };
    }

    const isTypeMatch = extracted.relation_type === expected.expected_relation_type;
    const [minConfidence, maxConfidence] = expected.expected_confidence_range;
    const isConfidenceInRange =
      extracted.confidence >= minConfidence && extracted.confidence <= maxConfidence;
    const isMatch = isTypeMatch && isConfidenceInRange;

    return {
      expected,
      extracted,
      isMatch,
      isTypeMatch,
      isConfidenceInRange,
    };
  });
}
