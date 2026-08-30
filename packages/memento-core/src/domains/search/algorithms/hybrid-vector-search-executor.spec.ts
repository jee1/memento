/**
 * 절대 cosine 척도 계약 회귀 검증 (#806).
 *
 * 이 실행 지점에는 전용 검증 파일이 없었다. 계약을 코드로 고정하기 위해 신설한다.
 */
import { describe, expect, it, vi } from 'vitest';
import { HybridVectorSearchExecutor } from './hybrid-vector-search-executor.js';

type Row = { memory_id: string; content: string; type: string; importance: number; created_at: string; similarity: number };

function row(memory_id: string, similarity: number): Row {
  return {
    memory_id,
    content: `content-${memory_id}`,
    type: 'episodic',
    importance: 0.5,
    created_at: '2026-08-29T00:00:00.000Z',
    similarity,
  };
}

function availableEngine(providerRows: Record<string, Row[]>) {
  return {
    initialize: vi.fn(),
    getIndexStatus: () => ({
      available: true,
      tableExists: true,
      recordCount: 10,
      dimensions: 512,
      vecExtensionLoaded: true,
    }),
    search: vi.fn(async (_vector: number[], _options: unknown, provider?: string) => providerRows[provider ?? ''] ?? []),
  };
}

function makeExecutor(providerRows: Record<string, Row[]>) {
  const embeddingService = {
    isAvailable: () => true,
    getUnifiedEmbeddingService: () => ({}),
    searchBySimilarity: vi.fn(),
  };
  const providerDetector = vi.fn(async () =>
    Object.keys(providerRows).map((provider) => ({ provider, count: 10, avg_dimensions: 512 }))
  );
  const queryVectorGenerator = vi.fn(async (_q: string, _sid: string, preferred: string) => ({
    embedding: [0.1, 0.2, 0.3],
    actualProvider: preferred,
  }));

  return new HybridVectorSearchExecutor(
    embeddingService as never,
    availableEngine(providerRows) as never,
    {} as never,
    { logSearchStep: vi.fn() } as never,
    providerDetector as never,
    queryVectorGenerator as never
  );
}

async function run(providerRows: Record<string, Row[]>, limit = 10) {
  return await makeExecutor(providerRows).execute({} as never, { query: 'q', limit } as never, 'sid');
}

/** 인덱스를 쓸 수 없는 상태 — 예외 없이 대체 경로로 간다 */
function unavailableEngine() {
  return {
    initialize: vi.fn(),
    getIndexStatus: () => ({
      available: false,
      tableExists: false,
      recordCount: 0,
      dimensions: 512,
      vecExtensionLoaded: false,
    }),
    search: vi.fn(async () => []),
  };
}

describe('대체 경로 분기·임계값 계약 (#806)', () => {
  /**
   * 방향 결함 자체는 임베딩 서비스 안에서 일어나므로
   * memory-embedding-service.spec.ts 가 RED 게이트다.
   * 여기서는 분기 도달과 임계값·보충 계약만 고정한다.
   */
  function fallbackExecutor() {
    const embeddingService = {
      isAvailable: () => true,
      getUnifiedEmbeddingService: () => ({}),
      searchBySimilarity: vi.fn(async () => ({
        results: [
          { ...row('near', 0.95), id: 'near', pinned: false, tags: [], similarity: 0.95 },
          { ...row('far', 0.02), id: 'far', pinned: false, tags: [], similarity: 0.02 },
        ],
        query_embedding_providers: ['tfidf'],
      })),
    };
    return new HybridVectorSearchExecutor(
      embeddingService as never,
      unavailableEngine() as never,
      {} as never,
      { logSearchStep: vi.fn() } as never
    );
  }

  it('SC-011: 인덱스를 쓸 수 없으면 오류 없이 대체 경로로 가고, 임계값 통과분이 가장 가까운 후보다', async () => {
    const out = await fallbackExecutor().execute({} as never, { query: 'q', limit: 1 } as never, 'sid');
    expect(out.fallback_used).toBe(true);
    expect(out.thresholded_ids).toEqual(['near']);
    expect(out.results[0]!.id).toBe('near');
  });

  it('대체 경로에서도 보충 후보가 자기 절대 점수를 유지한다', async () => {
    const out = await fallbackExecutor().execute({} as never, { query: 'q', limit: 2 } as never, 'sid');
    const filled = out.results.find((r) => r.id === 'far');
    expect(filled).toBeDefined();
    expect(filled!.similarity).toBeCloseTo(0.02, 5);
  });
});

describe('HybridVectorSearchExecutor 절대 척도 계약 (#806)', () => {
  it('SC-001: 모든 후보가 낮은 유사도면 최상위도 낮은 점수를 유지한다', async () => {
    const out = await run({ tfidf: [row('a', 0.31), row('b', 0.22), row('c', 0.11)] });
    const top = out.results[0]!;
    expect(top.similarity).toBeLessThan(0.4);
    expect(top.similarity).not.toBe(1);
  });

  it('SC-002: 같은 기억의 점수가 결과셋 구성에 따라 달라지지 않는다', async () => {
    const alone = await run({ tfidf: [row('a', 0.42)] });
    const withOthers = await run({ tfidf: [row('a', 0.42), row('b', 0.9), row('c', 0.1)] });

    expect(withOthers.results.find((r) => r.id === 'a')!.similarity)
      .toBe(alone.results.find((r) => r.id === 'a')!.similarity);
  });

  it('SC-004: 후보 1건과 다건에서 같은 기억의 점수가 같다', async () => {
    const one = await run({ tfidf: [row('a', 0.55)] });
    const many = await run({ tfidf: [row('a', 0.55), row('b', 0.77)] });

    expect(many.results.find((r) => r.id === 'a')!.similarity)
      .toBe(one.results.find((r) => r.id === 'a')!.similarity);
  });

  it('SC-006: 임계값 판정이 어떤 재조정보다 앞선다 — 임계값 미달 후보는 통과분에 없다', async () => {
    const out = await run({ tfidf: [row('hi', 0.90), row('lo', 0.10)] }, 1);
    expect(out.thresholded_ids).toEqual(['hi']);
    expect(out.raw_ids).toEqual(expect.arrayContaining(['hi', 'lo']));
  });

  it('FR-006: 보충으로 채워진 후보도 자기 절대 점수를 유지한다', async () => {
    const out = await run({ tfidf: [row('hi', 0.90), row('lo', 0.10)] }, 2);
    const filled = out.results.find((r) => r.id === 'lo');
    expect(filled).toBeDefined();
    expect(filled!.similarity).toBeCloseTo(0.10, 5);
  });

  it('FR-007: 같은 기억이 여러 제공자에서 나오면 절대 유사도의 최댓값이 남는다', async () => {
    const out = await run({ tfidf: [row('shared', 0.41)], minilm: [row('shared', 0.73)] });
    const hit = out.results.filter((r) => r.id === 'shared');
    expect(hit).toHaveLength(1);
    expect(hit[0]!.similarity).toBeCloseTo(0.73, 5);
  });

  it('FR-008: 제공자별 결과셋의 최소·최대가 점수에 영향을 주지 않는다', async () => {
    const narrow = await run({ tfidf: [row('x', 0.5)], minilm: [row('y', 0.5)] });
    const wide = await run({
      tfidf: [row('x', 0.5), row('x2', 0.99)],
      minilm: [row('y', 0.5), row('y2', 0.01)],
    });

    expect(wide.results.find((r) => r.id === 'x')!.similarity)
      .toBe(narrow.results.find((r) => r.id === 'x')!.similarity);
    expect(wide.results.find((r) => r.id === 'y')!.similarity)
      .toBe(narrow.results.find((r) => r.id === 'y')!.similarity);
  });

  it('SC-012: 반환되는 모든 점수가 0~1 범위의 유한값이다', async () => {
    const out = await run({ tfidf: [row('a', 1.4), row('b', -0.3), row('c', Number.NaN)] });
    expect(out.results.length).toBeGreaterThan(0);
    for (const r of out.results) {
      expect(Number.isFinite(r.similarity)).toBe(true);
      expect(r.similarity).toBeGreaterThanOrEqual(0);
      expect(r.similarity).toBeLessThanOrEqual(1);
    }
  });
});
