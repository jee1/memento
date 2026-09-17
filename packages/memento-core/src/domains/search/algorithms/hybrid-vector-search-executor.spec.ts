/**
 * 절대 cosine 척도 계약 회귀 검증 (#806).
 * #921 길이 감쇠는 기본 on — fixture content를 충분히 길게 두어 임계값 계약이 유지되게 하고,
 * 절대 점수 단언은 decay factor를 반영한다.
 */
import { describe, expect, it, vi } from 'vitest';
import { getRankingWeights } from '../../../shared/config/ranking-weights-loader.js';
import { HybridVectorSearchExecutor } from './hybrid-vector-search-executor.js';
import { vectorLengthDecayFactor } from './vector-length-decay.js';

type Row = { memory_id: string; content: string; type: string; importance: number; created_at: string; similarity: number };

/** Long enough that hi=0.90 stays above HYBRID_VECTOR_THRESHOLD after decay (k=40). */
const BODY = 'x'.repeat(200);

function row(memory_id: string, similarity: number, content = `${BODY}-${memory_id}`): Row {
  return {
    memory_id,
    content,
    type: 'episodic',
    importance: 0.5,
    created_at: '2026-08-29T00:00:00.000Z',
    similarity,
  };
}

function decayedSimilarity(raw: number, content: string): number {
  const k = getRankingWeights().vector_length_decay.characteristic_length;
  return raw * vectorLengthDecayFactor(content.length, k);
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
    expect(filled!.similarity).toBeCloseTo(decayedSimilarity(0.02, filled!.content), 5);
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
    expect(filled!.similarity).toBeCloseTo(decayedSimilarity(0.10, filled!.content), 5);
  });

  it('FR-007: 같은 기억이 여러 제공자에서 나오면 절대 유사도의 최댓값이 남는다', async () => {
    const out = await run({ tfidf: [row('shared', 0.41)], minilm: [row('shared', 0.73)] });
    const hit = out.results.filter((r) => r.id === 'shared');
    expect(hit).toHaveLength(1);
    expect(hit[0]!.similarity).toBeCloseTo(decayedSimilarity(0.73, hit[0]!.content), 5);
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

describe('HybridVectorSearchExecutor metadata carry-through (#1006)', () => {
  it('vec lane preserves pinned, tags, and last_accessed per row', async () => {
    const out = await run({
      tfidf: [
        {
          memory_id: 'pinned-meta',
          content: `${BODY}-pinned-meta`,
          type: 'episodic',
          importance: 0.5,
          created_at: '2026-01-01T00:00:00.000Z',
          similarity: 0.9,
          pinned: 1,
          tags: ['alpha', 'beta'],
          last_accessed: '2026-01-01T00:00:00.000Z',
        },
        {
          memory_id: 'unpinned-meta',
          content: `${BODY}-unpinned-meta`,
          type: 'episodic',
          importance: 0.5,
          created_at: '2026-01-02T00:00:00.000Z',
          similarity: 0.85,
          pinned: 0,
          tags: [],
        },
      ],
    });

    const pinnedHit = out.results.find((r) => r.id === 'pinned-meta');
    const unpinnedHit = out.results.find((r) => r.id === 'unpinned-meta');
    expect(pinnedHit?.pinned).toBe(true);
    expect(pinnedHit?.tags).toEqual(['alpha', 'beta']);
    expect(pinnedHit?.last_accessed).toBe('2026-01-01T00:00:00.000Z');
    expect(unpinnedHit?.pinned).toBe(false);
    expect(unpinnedHit?.tags).toEqual([]);
  });
});

describe('HybridVectorSearchExecutor length decay (#921)', () => {
  it('짧은 트리플 문장보다 긴 정답의 유효 유사도가 높다', async () => {
    const shortContent = '#917 수정은 검증 방법을 필요합니다';
    const longContent = 'x'.repeat(663);
    expect(shortContent.length).toBe(21);
    expect(longContent.length).toBe(663);

    const out = await run({
      tfidf: [
        row('short', 0.749, shortContent),
        row('long', 0.722, longContent),
      ],
    });
    const shortHit = out.results.find((r) => r.id === 'short')!;
    const longHit = out.results.find((r) => r.id === 'long')!;
    expect(longHit.similarity).toBeGreaterThan(shortHit.similarity);
    expect(out.results[0]!.id).toBe('long');
  });
});
