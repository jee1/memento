import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getEmbeddingModelFilter, LOCAL_EMBEDDING_MODEL, mapQueryScore } from '../embedding-models.js';

// 저장 이름이 바뀌면 기존 memory_embedding 행이 모두 옛 모델 행이 되어 이주 대상이 된다 (#889, #1729).
// 모델 교체 PR 이 아니면 이 값들은 바뀌지 않아야 한다.
describe('LOCAL_EMBEDDING_MODEL (#1729)', () => {
  it('저장 이름, 패키지, 접두가 한국어 모델 그대로다', () => {
    expect(LOCAL_EMBEDDING_MODEL.storedName).toBe('multilingual-e5-small-ko-v2');
    expect(LOCAL_EMBEDDING_MODEL.source).toEqual({ packageName: '@jee1/memento-embedding-e5-small-ko-v2', dtype: 'q8' });
    expect(LOCAL_EMBEDDING_MODEL.dimensions).toBe(384);
    expect(LOCAL_EMBEDDING_MODEL.prefixes).toEqual({ query: 'query: ', passage: 'passage: ' });
  });

  it('모델 패키지는 정확한 버전으로 의존하고 그 안 폴더 이름이 저장 이름이다', () => {
    const require = createRequire(import.meta.url);
    const packageJson = require.resolve(`${LOCAL_EMBEDDING_MODEL.source.packageName}/package.json`);
    const rootManifest = JSON.parse(readFileSync(new URL('../../../../../../package.json', import.meta.url), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(rootManifest.dependencies[LOCAL_EMBEDDING_MODEL.source.packageName]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(existsSync(join(dirname(packageJson), LOCAL_EMBEDDING_MODEL.storedName, 'onnx', 'model_quantized.onnx'))).toBe(true);
  });

  it('minilm 제공자만 저장 이름으로 거른다', () => {
    expect(getEmbeddingModelFilter('minilm')).toBe('multilingual-e5-small-ko-v2');
    expect(getEmbeddingModelFilter('openai')).toBeNull();
    expect(getEmbeddingModelFilter(undefined)).toBeNull();
  });

  it('질의 점수 사상과 기억끼리 기준값', () => {
    expect(LOCAL_EMBEDDING_MODEL.queryScoreMapping).toEqual({ a: 1.9943, b: -0.6838 });
    expect(LOCAL_EMBEDDING_MODEL.memorySimilarity).toEqual({
      consolidationCluster: 0.668,
      consolidationMerge: 0.794,
      rememberDedup: 0.794,
      supersedeCandidate: 0.668,
      neighbor: 0.745,
      anchorSlots: { A: 0.745, B: 0.649, C: 0.566 },
    });
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
