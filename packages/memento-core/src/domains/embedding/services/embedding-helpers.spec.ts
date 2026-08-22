import { describe, expect, it } from 'vitest';
import {
  cleanupEmbeddingCache,
  estimateEmbeddingTokens,
  generateEmbeddingCacheKey,
  rankSimilarEmbeddings,
  truncateEmbeddingText,
} from './embedding-helpers.js';

describe('embedding helpers', () => {
  it('preserves provider-specific cache key hashing', () => {
    expect(generateEmbeddingCacheKey('openai', 'OpenAI')).toBe('openai:-vv45im');
    expect(generateEmbeddingCacheKey('gemini_embedding', 'OpenAI', true)).toBe(
      'gemini_embedding:vv45im',
    );
  });

  it('estimates and truncates with the existing four-characters-per-token rule', () => {
    expect(estimateEmbeddingTokens('12345')).toBe(2);
    expect(truncateEmbeddingText('123456789', 2)).toBe('12345678');
  });

  it('retains the newest half when bounded caches exceed their limit', () => {
    const cache = new Map(Array.from({ length: 5 }, (_, index) => [`k${index}`, index]));
    cleanupEmbeddingCache(cache, 4, 2);
    expect([...cache.entries()]).toEqual([['k3', 3], ['k4', 4]]);
  });

  it('ranks once-computed similarities and preserves mismatch and NaN policies', () => {
    const candidates = [{ id: 'a', content: 'A', embedding: [1, 0] }];
    expect(rankSimilarEmbeddings([1, 0], candidates, 10, 0.5)).toEqual([
      { id: 'a', content: 'A', similarity: 1, score: 1 },
    ]);
    expect(() => rankSimilarEmbeddings([1], candidates, 10, 0)).toThrow(
      '벡터 차원이 일치하지 않습니다',
    );
    expect(
      rankSimilarEmbeddings([Number.NaN, 1], [{ ...candidates[0]!, embedding: [1, 1] }], 10, 0, {
        nanAsZero: true,
      }),
    ).toHaveLength(1);
  });
});
