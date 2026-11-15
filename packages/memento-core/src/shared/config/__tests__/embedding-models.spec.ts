import { afterEach, describe, expect, it } from 'vitest';
import { getEmbeddingModelFilter, LOCAL_EMBEDDING_MODEL, mapQueryScore } from '../embedding-models.js';

// 저장 이름이 바뀌면 기존 memory_embedding 행이 모두 벡터 검색에서 빠진다 (#889).
// 모델 교체(#1729 전환 PR)가 아니면 이 값은 바뀌지 않아야 한다.
describe('LOCAL_EMBEDDING_MODEL (#1729)', () => {
  it('저장 이름과 위치가 지금 모델 그대로다', () => {
    expect(LOCAL_EMBEDDING_MODEL.storedName).toBe('paraphrase-multilingual-MiniLM-L12-v2');
    expect(LOCAL_EMBEDDING_MODEL.source).toEqual({
      repo: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
      dtype: 'q8',
    });
    expect(LOCAL_EMBEDDING_MODEL.dimensions).toBe(384);
  });

  it('minilm 제공자만 저장 이름으로 거른다', () => {
    expect(getEmbeddingModelFilter('minilm')).toBe('paraphrase-multilingual-MiniLM-L12-v2');
    expect(getEmbeddingModelFilter('openai')).toBeNull();
    expect(getEmbeddingModelFilter(undefined)).toBeNull();
  });

  it('질의 점수 사상과 기억끼리 기준값이 지금 모델 그대로다', () => {
    expect(LOCAL_EMBEDDING_MODEL.queryScoreMapping).toEqual({ a: 1, b: 0 });
    expect(LOCAL_EMBEDDING_MODEL.memorySimilarity).toEqual({
      consolidationCluster: 0.65,
      consolidationMerge: 0.85,
      rememberDedup: 0.85,
      supersedeCandidate: 0.65,
      neighbor: 0.8,
      anchorSlots: { A: 0.8, B: 0.6, C: 0.4 },
    });
  });

  it('지금 계수의 사상은 [0, 1] 점수를 바꾸지 않는다', () => {
    for (const score of [0, 0.38, 0.73, 1]) {
      expect(mapQueryScore('minilm', score)).toBe(score);
    }
  });

  describe('mapQueryScore', () => {
    type MutableMapping = { queryScoreMapping: { a: number; b: number } };
    const original = LOCAL_EMBEDDING_MODEL.queryScoreMapping;
    afterEach(() => {
      (LOCAL_EMBEDDING_MODEL as unknown as MutableMapping).queryScoreMapping = original;
    });

    it('로컬 임베딩 모델 점수만 a·s+b 로 옮기고 [0, 1] 로 자른다', () => {
      (LOCAL_EMBEDDING_MODEL as unknown as MutableMapping).queryScoreMapping = { a: 1.9943, b: -0.6838 };

      expect(mapQueryScore('minilm', 0.6)).toBeCloseTo(1.9943 * 0.6 - 0.6838, 10);
      expect(mapQueryScore('minilm', 0.2)).toBe(0);
      expect(mapQueryScore('minilm', 0.9)).toBe(1);
      expect(mapQueryScore('tfidf', 0.6)).toBe(0.6);
      expect(mapQueryScore(undefined, 0.6)).toBe(0.6);
    });
  });
});
