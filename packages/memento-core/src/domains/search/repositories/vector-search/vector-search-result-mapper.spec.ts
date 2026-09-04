/**
 * 벡터 검색 similarity 계약 회귀 (issue #713 / #806 / #811 US5)
 *
 * 계약: vec0 테이블은 distance_metric=cosine 이므로 distance는 cosine distance([0, 2])이고,
 * similarity = clamp(1 - distance, 0, 1) 인 cosine similarity 이다.
 * 하이브리드 SQL은 distance를 노출하고, 변환은 mapHybridResults → cosineDistanceToSimilarity 만 수행한다.
 */

import { describe, expect, it } from 'vitest';
import {
  cosineDistanceToSimilarity,
  mapHybridResults,
  mapKnnResults
} from './vector-search-result-mapper.js';
import type { RawVectorSearchResult, VectorSearchExecutionOptions } from './vector-search.types.js';

const options: VectorSearchExecutionOptions = {
  limit: 10,
  threshold: 0,
  includeContent: true,
  includeMetadata: true
};

function rawResult(overrides: Partial<RawVectorSearchResult>): RawVectorSearchResult {
  return {
    memory_id: 'mem_1',
    similarity: 0,
    content: 'content',
    type: 'episodic',
    importance: 0.5,
    created_at: '2026-01-01T00:00:00.000Z',
    pinned: 0,
    ...overrides
  };
}

describe('cosineDistanceToSimilarity (issue #713 계약)', () => {
  it('양의 비례 벡터(cosine distance 0)는 similarity 1.0', () => {
    expect(cosineDistanceToSimilarity(0)).toBeCloseTo(1.0, 6);
  });

  it('직교 벡터(cosine distance 1)는 similarity 0', () => {
    expect(cosineDistanceToSimilarity(1)).toBeCloseTo(0, 6);
  });

  it('유사한 벡터(cosine distance 0.15)는 slot A threshold 0.8을 통과한다', () => {
    expect(cosineDistanceToSimilarity(0.15)).toBeCloseTo(0.85, 6);
  });

  it('반대 방향 벡터(cosine distance 2)는 하한 clamp로 0', () => {
    expect(cosineDistanceToSimilarity(2)).toBe(0);
  });

  it('최대 거리를 넘어서는 값도 하한 clamp로 0', () => {
    expect(cosineDistanceToSimilarity(2.5)).toBe(0);
  });

  it('부동소수 오차로 distance가 음수여도 상한 clamp로 1을 넘지 않는다', () => {
    expect(cosineDistanceToSimilarity(-1e-7)).toBe(1);
  });

  it('숫자가 아니거나 NaN이면 0으로 처리한다', () => {
    expect(cosineDistanceToSimilarity(Number.NaN)).toBe(0);
    expect(cosineDistanceToSimilarity(undefined as unknown as number)).toBe(0);
  });
});

describe('mapKnnResults', () => {
  it('cosine distance를 cosine similarity로 변환한다', () => {
    const mapped = mapKnnResults(
      [
        rawResult({ memory_id: 'proportional', similarity: 0 }),
        rawResult({ memory_id: 'near', similarity: 0.25 }),
        rawResult({ memory_id: 'orthogonal', similarity: 1 }),
        rawResult({ memory_id: 'opposite', similarity: 2 })
      ],
      options
    );

    expect(mapped.map(r => [r.memory_id, r.similarity])).toEqual([
      ['proportional', 1],
      ['near', 0.75],
      ['orthogonal', 0],
      ['opposite', 0]
    ]);
  });

  it('slot threshold(0.8)는 cosine similarity 기준으로 걸러진다', () => {
    const mapped = mapKnnResults(
      [
        rawResult({ memory_id: 'near', similarity: 0.1 }),
        rawResult({ memory_id: 'far', similarity: 0.5 })
      ],
      { ...options, threshold: 0.8 }
    );

    expect(mapped.map(r => r.memory_id)).toEqual(['near']);
  });
});

describe('mapHybridResults (#811 US5 / #806 FR-020)', () => {
  it('vector_distance를 cosineDistanceToSimilarity로 변환한다', () => {
    const mapped = mapHybridResults(
      [
        rawResult({ memory_id: 'proportional', vector_distance: 0 }),
        rawResult({ memory_id: 'near', vector_distance: 0.25 }),
        rawResult({ memory_id: 'orthogonal', vector_distance: 1 }),
        rawResult({ memory_id: 'opposite', vector_distance: 2 })
      ],
      options,
      false
    );

    expect(mapped.map(r => [r.memory_id, r.similarity])).toEqual([
      ['proportional', 1],
      ['near', 0.75],
      ['orthogonal', 0],
      ['opposite', 0]
    ]);
  });

  it('거리 범위 밖·부동소수 오차도 cosineDistanceToSimilarity와 동일하게 clamp한다', () => {
    const mapped = mapHybridResults(
      [
        rawResult({ memory_id: 'over', vector_distance: 2.5 }),
        rawResult({ memory_id: 'neg', vector_distance: -1e-7 })
      ],
      options,
      false
    );

    expect(mapped.map(r => [r.memory_id, r.similarity])).toEqual([
      ['over', cosineDistanceToSimilarity(2.5)],
      ['neg', cosineDistanceToSimilarity(-1e-7)]
    ]);
  });

  it('텍스트 쿼리가 있으면 변환된 벡터 유사도로 가중 합산한다', () => {
    // distance 2 → similarity 0; text 1 → 0*0.6 + 1*0.4
    const mapped = mapHybridResults(
      [rawResult({ memory_id: 'mixed', vector_distance: 2, text_similarity: 1 })],
      options,
      true
    );

    expect(mapped[0]?.similarity).toBeCloseTo(0.4, 6);
  });

  it('반환 점수는 cosineDistanceToSimilarity와 byte-for-byte 동일 경로다', () => {
    const distance = 0.15;
    const mapped = mapHybridResults(
      [rawResult({ memory_id: 'slot-a', vector_distance: distance })],
      options,
      false
    );

    expect(mapped[0]?.similarity).toBe(cosineDistanceToSimilarity(distance));
  });
});
