import { describe, expect, it } from 'vitest';
import { getEmbeddingModelFilter, LOCAL_EMBEDDING_MODEL } from '../embedding-models.js';

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
});
