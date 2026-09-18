import { describe, expect, it } from 'vitest';
import {
  cleanupEmbeddingCache,
  estimateEmbeddingTokens,
  generateEmbeddingCacheKey,
  meanPoolNormalize,
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

  it('estimates ASCII and non-ASCII separately and truncates within the estimate', () => {
    expect(estimateEmbeddingTokens('12345')).toBe(2);
    // 한국어는 2.1 chars/token 으로 센다 — len/4 였다면 3 이 나왔을 입력이다.
    expect(estimateEmbeddingTokens('가나다라마바사아자차카타')).toBe(6);
    expect(truncateEmbeddingText('123456789', 2)).toBe('123456');
    const korean = '가'.repeat(100);
    expect(estimateEmbeddingTokens(truncateEmbeddingText(korean, 10))).toBeLessThanOrEqual(10);
  });

  it('mean-pools window vectors back into a unit vector', () => {
    expect(meanPoolNormalize([[3, 4]])).toEqual([3, 4]);
    const pooled = meanPoolNormalize([[1, 0], [0, 1]]);
    expect(pooled[0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(pooled[1]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(() => meanPoolNormalize([[1, 0], [0, 1, 2]])).toThrow('벡터 차원이 일치하지 않습니다');
    expect(() => meanPoolNormalize([])).toThrow('평균 낼 벡터가 없습니다');
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
