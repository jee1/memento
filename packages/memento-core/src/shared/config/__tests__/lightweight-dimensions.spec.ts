import { describe, it, expect } from 'vitest';
import { providerDimensionDefaults } from '../environment.js';
import { VECTOR_SEARCH } from '../constants.js';
import { LightweightEmbeddingService } from '../../../domains/embedding/services/lightweight-embedding-service.js';
import { VectorCompatibilityService } from '../../../domains/embedding/services/vector-compatibility-service.js';
import { getVecTableSchemaDimensions } from '../../../domains/search/repositories/vector-search/vector-search-runtime-context.js';

describe('lightweight provider dimensions (#1221)', () => {
  const serviceDimensions = new LightweightEmbeddingService().getModelInfo().dimensions;

  it('LightweightEmbeddingService reports 512 dimensions', () => {
    expect(serviceDimensions).toBe(512);
  });

  it('providerDimensionDefaults.lightweight matches service and tfidf', () => {
    expect(providerDimensionDefaults.lightweight).toBe(serviceDimensions);
    expect(providerDimensionDefaults.lightweight).toBe(providerDimensionDefaults.tfidf);
  });

  it('VECTOR_SEARCH.PROVIDER_DIMENSIONS.lightweight matches service and tfidf', () => {
    expect(VECTOR_SEARCH.PROVIDER_DIMENSIONS.lightweight).toBe(serviceDimensions);
    expect(VECTOR_SEARCH.PROVIDER_DIMENSIONS.lightweight).toBe(
      VECTOR_SEARCH.PROVIDER_DIMENSIONS.tfidf
    );
  });

  it('VectorCompatibilityService.getNativeDimensions(lightweight) matches service', () => {
    expect(new VectorCompatibilityService().getNativeDimensions('lightweight')).toBe(
      serviceDimensions
    );
  });

  it('memory_item_vec schema dimensions remain 384 (shared vec0 table)', () => {
    // shared 384-dim vec0 table; not the lightweight service dimension (#1221)
    expect(getVecTableSchemaDimensions('memory_item_vec')).toBe(384);
  });
});
