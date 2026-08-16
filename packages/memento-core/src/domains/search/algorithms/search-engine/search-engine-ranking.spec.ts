import { describe, expect, it } from 'vitest';
import { SearchEngine } from '../search-engine.js';
import { SearchRanking } from '../search-ranking.js';
import {
  cleanupTestDatabase,
  createTestMemory,
  setupTestDatabase,
} from '../../../../test/helpers/test-database.js';
import { applyRanking, ftsRankToRelevance } from './search-engine-ranking.js';
import type { SearchEngineRow } from './search-engine.types.js';

function row(id: string, ftsRank: number, content = `memory ${id} about recall`): SearchEngineRow {
  return {
    id,
    content,
    type: 'semantic',
    importance: 0.5,
    created_at: '2024-01-01T00:00:00.000Z',
    pinned: 0,
    tags: '[]',
    fts_rank: ftsRank,
  };
}

describe('applyRanking FTS5 BM25 contract (#787)', () => {
  it('maps signed FTS5 rank to (0, 1) relevance while keeping lower rank better', () => {
    expect(ftsRankToRelevance(0)).toBeNull();
    expect(ftsRankToRelevance(Number.NaN)).toBeNull();
    const best = ftsRankToRelevance(-12);
    const mid = ftsRankToRelevance(-4);
    const weak = ftsRankToRelevance(-0.5);
    expect(best).toBeGreaterThan(mid ?? 0);
    expect(mid).toBeGreaterThan(weak ?? 0);
    expect(best).toBeLessThan(1);
    expect(weak).toBeGreaterThan(0);
  });

  it('treats fts_rank 0 as missing BM25 (empty-query sentinel)', () => {
    const ranking = new SearchRanking();
    const items = applyRanking(
      ranking,
      [row('lexical', 0), row('bm25', -8)],
      'recall',
    );

    expect(items[0]?.id).toBe('bm25');
  });

  it('treats negative FTS5 rank as valid BM25 and keeps lower rank first', () => {
    const ranking = new SearchRanking();
    const items = applyRanking(
      ranking,
      [row('worse', -1), row('best', -12)],
      'recall',
    );

    expect(items[0]?.id).toBe('best');
    expect(items[1]?.id).toBe('worse');
    expect(items[0]?.score ?? 0).toBeGreaterThan(items[1]?.score ?? 0);
  });

  it('preserves BM25 order when converting signed rank to relevance', () => {
    const ranking = new SearchRanking();
    const items = applyRanking(
      ranking,
      [
        row('mid', -4, 'alpha funnel notes'),
        row('best', -20, 'beta production recall'),
        row('weak', -0.5, 'gamma kitchen recipe'),
      ],
      'recall',
    );

    expect(items.map((item) => item.id)).toEqual(['best', 'mid', 'weak']);
  });
});

describe('SearchEngine FTS5 BM25 (#787)', () => {
  it('returns the best FTS5 match first on a real in-memory index', async () => {
    const db = await setupTestDatabase();
    try {
      createTestMemory(db, {
        id: 'best',
        type: 'semantic',
        content: 'memento production recall funnel bm25 contract',
        importance: 0.5,
      });
      createTestMemory(db, {
        id: 'noise',
        type: 'semantic',
        content: 'unrelated cooking recipe pasta tomato basil',
        importance: 0.5,
      });

      const engine = new SearchEngine();
      const result = await engine.search(db, {
        query: 'memento production recall funnel bm25',
        limit: 10,
        omit_feedback_in_ranking: true,
      });

      expect(result.items[0]?.id).toBe('best');
    } finally {
      cleanupTestDatabase(db);
    }
  });
});
