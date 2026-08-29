/**
 * 대체 경로 근접도 방향 회귀 검증 (#806).
 *
 * DB를 스텁해 SQL → 행 → 매퍼 경로를 그대로 통과시킨다.
 * 임베딩 서비스보다 상류에서 스텁하면 방향 결함을 통과시켜 버리므로 여기가 RED 게이트다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows = [
  {
    id: 'near', content: 'c-near', type: 'episodic', importance: 0.5,
    created_at: '2026-08-29T00:00:00.000Z', last_accessed: null, pinned: 0, tags: null,
    distance: 0.05,
  },
  {
    id: 'far', content: 'c-far', type: 'episodic', importance: 0.5,
    created_at: '2026-08-29T00:00:00.000Z', last_accessed: null, pinned: 0, tags: null,
    distance: 1.6,
  },
];

vi.mock('../../../shared/utils/database.js', () => ({
  DatabaseUtils: {
    all: vi.fn(async () => rows),
    get: vi.fn(async () => undefined),
    run: vi.fn(async () => undefined),
  },
}));

const { MemoryEmbeddingService } = await import('./memory-embedding-service.js');

describe('searchBySimilarity 근접도 방향 (#806)', () => {
  let service: InstanceType<typeof MemoryEmbeddingService>;

  beforeEach(() => {
    service = new MemoryEmbeddingService();
    (service as unknown as { embeddingService: unknown }).embeddingService = {
      isAvailable: () => true,
      generateEmbedding: async () => ({ embedding: [0.1, 0.2, 0.3], provider: 'tfidf' }),
    };
  });

  it('거리가 가까운 행이 더 높은 similarity를 받는다 — 방향 반전 금지', async () => {
    const out = await service.searchBySimilarity({} as never, 'q');
    const near = out.results.find((r) => r.id === 'near')!;
    const far = out.results.find((r) => r.id === 'far')!;

    expect(near.similarity).toBeGreaterThan(far.similarity);
    expect(near.similarity).toBeCloseTo(0.95, 5);
    expect(far.similarity).toBe(0);
  });

  it('SC-018: 결과 객체에 방향이 다른 근접도 필드가 함께 있지 않다', async () => {
    const out = await service.searchBySimilarity({} as never, 'q');
    expect(out.results.length).toBeGreaterThan(0);
    for (const r of out.results) {
      expect(r).not.toHaveProperty('score');
      expect(r).not.toHaveProperty('distance');
    }
  });

  it('모든 similarity가 0~1 유한값이다', async () => {
    const out = await service.searchBySimilarity({} as never, 'q');
    for (const r of out.results) {
      expect(Number.isFinite(r.similarity)).toBe(true);
      expect(r.similarity).toBeGreaterThanOrEqual(0);
      expect(r.similarity).toBeLessThanOrEqual(1);
    }
  });
});
