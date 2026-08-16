import { describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { SearchRanking } from './search-ranking.js';
import { SearchResultCombiner } from './search-result-combiner.js';
import { HybridResultRanker } from './hybrid-result-ranker.js';
import type { HybridSearchQuery, IProceduralMemoryMatcher } from './hybrid-search-types.js';
import type { VectorSearchResult } from '../../memory/services/memory-embedding-service.js';

const STAMP = '2024-01-01T00:00:00.000Z';
const TEXT_HEAVY_WEIGHTS = { textWeight: 0.7, vectorWeight: 0.3 };
const VECTOR_HEAVY_WEIGHTS = { textWeight: 0.3, vectorWeight: 0.7 };

const stubDb = {
  prepare: () => ({
    all: () => [],
    get: () => undefined,
  }),
} as unknown as Database.Database;

const matcher: IProceduralMemoryMatcher = {
  fetchProceduralMemoryMatches: () => new Map(),
};

const query: HybridSearchQuery = { query: 'fusion recall', include_score_breakdown: true };

function ranker(): HybridResultRanker {
  return new HybridResultRanker(
    new SearchResultCombiner(),
    new SearchRanking(),
    matcher,
    () => null,
  );
}

function textHit(id: string, score: number) {
  return {
    id,
    content: `${id} content`,
    type: 'semantic',
    importance: 0.5,
    created_at: STAMP,
    last_accessed: STAMP,
    pinned: false,
    tags: [],
    score,
  };
}

function vectorHit(id: string, similarity: number): VectorSearchResult {
  return {
    id,
    content: `${id} content`,
    type: 'semantic',
    importance: 0.5,
    created_at: STAMP,
    last_accessed: STAMP,
    pinned: false,
    tags: [],
    similarity,
    score: similarity,
  };
}

describe('HybridResultRanker fusion relevance (#788)', () => {
  it('keeps weighted combiner relevance for overlap candidates', async () => {
    const items = await ranker().combineAndSortResults(
      [textHit('lexical', 0.9), textHit('semantic', 0.2)],
      [vectorHit('lexical', 0.2), vectorHit('semantic', 0.9)],
      TEXT_HEAVY_WEIGHTS,
      10,
      stubDb,
      false,
      query,
    );

    expect(items.map((item) => item.id)).toEqual(['lexical', 'semantic']);
    expect(items[0]?.finalScore ?? 0).toBeGreaterThan(items[1]?.finalScore ?? 0);
  });

  it('does not lower final score when text score rises at fixed vector score', async () => {
    const items = await ranker().combineAndSortResults(
      [textHit('low', 0.2), textHit('high', 0.8)],
      [vectorHit('low', 0.5), vectorHit('high', 0.5)],
      TEXT_HEAVY_WEIGHTS,
      10,
      stubDb,
      false,
      query,
    );

    const low = items.find((item) => item.id === 'low');
    const high = items.find((item) => item.id === 'high');
    expect(high?.finalScore ?? 0).toBeGreaterThan(low?.finalScore ?? 0);
  });

  it('does not lower final score when vector score rises at fixed text score', async () => {
    const items = await ranker().combineAndSortResults(
      [textHit('low', 0.5), textHit('high', 0.5)],
      [vectorHit('low', 0.2), vectorHit('high', 0.8)],
      VECTOR_HEAVY_WEIGHTS,
      10,
      stubDb,
      false,
      query,
    );

    const low = items.find((item) => item.id === 'low');
    const high = items.find((item) => item.id === 'high');
    expect(high?.finalScore ?? 0).toBeGreaterThan(low?.finalScore ?? 0);
  });

  it('scales text-only relevance by textWeight instead of dropping the weight', async () => {
    const [strong, weak] = await Promise.all([
      ranker().combineAndSortResults(
        [textHit('only', 1)],
        [],
        TEXT_HEAVY_WEIGHTS,
        10,
        stubDb,
        false,
        query,
      ),
      ranker().combineAndSortResults(
        [textHit('only', 1)],
        [],
        { textWeight: 0.2, vectorWeight: 0.8 },
        10,
        stubDb,
        false,
        query,
      ),
    ]);

    expect(strong[0]?.finalScore ?? 0).toBeGreaterThan(weak[0]?.finalScore ?? 0);
  });

  it('scales vector-only relevance by vectorWeight instead of using raw similarity', async () => {
    const [strong, weak] = await Promise.all([
      ranker().combineAndSortResults(
        [],
        [vectorHit('only', 1)],
        VECTOR_HEAVY_WEIGHTS,
        10,
        stubDb,
        false,
        query,
      ),
      ranker().combineAndSortResults(
        [],
        [vectorHit('only', 1)],
        { textWeight: 0.8, vectorWeight: 0.2 },
        10,
        stubDb,
        false,
        query,
      ),
    ]);

    expect(strong[0]?.finalScore ?? 0).toBeGreaterThan(weak[0]?.finalScore ?? 0);
  });

  it('does not fold importance into the relevance slot', async () => {
    const important = {
      ...textHit('a', 0.5),
      importance: 0.95,
    };
    const ordinary = textHit('b', 0.5);
    const items = await ranker().combineAndSortResults(
      [important, ordinary],
      [vectorHit('a', 0.5), vectorHit('b', 0.5)],
      TEXT_HEAVY_WEIGHTS,
      10,
      stubDb,
      false,
      query,
    );

    const a = items.find((item) => item.id === 'a');
    const b = items.find((item) => item.id === 'b');
    expect(a?.score_breakdown?.relevance.score).toBeCloseTo(b?.score_breakdown?.relevance.score ?? 0, 8);
    expect(a?.finalScore ?? 0).toBeGreaterThan(b?.finalScore ?? 0);
  });
});
