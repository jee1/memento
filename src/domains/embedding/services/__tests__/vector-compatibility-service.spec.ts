import { describe, it, expect, beforeEach } from 'vitest';
import { VectorCompatibilityService } from './vector-compatibility-service.js';
import type { EmbeddingProvider } from '../../../../../shared/types/embedding.types.js';

describe('VectorCompatibilityService', () => {
  let service: VectorCompatibilityService;

  beforeEach(() => {
    service = new VectorCompatibilityService();
  });

  it('projects legacy 384-dimension vectors to openai native dimensions (1536)', () => {
    const provider: EmbeddingProvider = 'openai';
    const legacyVector = Array.from({ length: 384 }, (_, idx) => (idx + 1) / 384);

    const assessment = service.assessProviderCompatibility(legacyVector, provider);

    expect(assessment.needsProjection).toBe(true);
    expect(assessment.projection.targetDimensions).toBe(1536);
    expect(assessment.projection.vector).toHaveLength(1536);
    expect(assessment.projection.vector.slice(0, 384)).toEqual(legacyVector);
    expect(assessment.projection.vector.slice(384).every(value => value === 0)).toBe(true);

    const dimensionIssue = assessment.issues.find(issue => issue.code === 'dimension_mismatch');
    expect(dimensionIssue).toBeDefined();
    expect(dimensionIssue?.severity).toBe('error');
  });

  it('marks matching dimensions as compatible without projection', () => {
    const provider: EmbeddingProvider = 'tfidf';
    const vector = Array.from({ length: 512 }, (_, idx) => Math.sin(idx)); // TF-IDF는 512차원

    const assessment = service.assessProviderCompatibility(vector, provider);

    expect(assessment.isCompatible).toBe(true);
    expect(assessment.needsProjection).toBe(false);
    expect(assessment.projection.projectionType).toBe('native');
    expect(assessment.issues).toHaveLength(0);
  });

  it('sanitises non-finite values and reports warnings', () => {
    const provider: EmbeddingProvider = 'minilm';
    const vector = [1, Number.POSITIVE_INFINITY, NaN, -1];

    const assessment = service.assessProviderCompatibility(vector, provider);

    const warning = assessment.issues.find(issue => issue.code === 'non_finite_values');
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
    expect(assessment.projection.vector[1]).toBe(0);
    expect(assessment.projection.vector[2]).toBe(0);
  });
});
