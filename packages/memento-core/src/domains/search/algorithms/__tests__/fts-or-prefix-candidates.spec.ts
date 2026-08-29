/**
 * #807 T004/T005 — real SQLite FTS5 candidates for OR + prefix*
 * Direct MATCH against in-memory FTS (YAGNI: no full SearchEngine wiring).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { buildFTSQuery } from '../search-engine/search-engine-fts-query.js';

type FtsRow = { id: string; content: string };

function createFtsDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE VIRTUAL TABLE memory_item_fts USING fts5(
      id UNINDEXED,
      content
    );
  `);
  return db;
}

function insertMemory(
  db: Database.Database,
  id: string,
  content: string
): void {
  db.prepare(
    'INSERT INTO memory_item_fts(id, content) VALUES (?, ?)'
  ).run(id, content);
}

function ftsCandidates(db: Database.Database, rawQuery: string): FtsRow[] {
  const match = buildFTSQuery(rawQuery);
  return db
    .prepare(
      'SELECT id, content FROM memory_item_fts WHERE memory_item_fts MATCH ?'
    )
    .all(match) as FtsRow[];
}

describe('FTS OR+prefix candidates (#807 T004/T005)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createFtsDb();
  });

  afterEach(() => {
    db.close();
  });

  describe('US1 — multi-concept short query (T004)', () => {
    const fixtures: ReadonlyArray<{ id: string; content: string; token: string }> = [
      { id: 'mem_search', content: '이 기억은 검색만 다룬다', token: '검색' },
      { id: 'mem_ranking', content: '이 기억은 랭킹만 다룬다', token: '랭킹' },
      { id: 'mem_weight', content: '이 기억은 가중치만 다룬다', token: '가중치' },
      { id: 'mem_tuning', content: '이 기억은 튜닝만 다룬다', token: '튜닝' },
    ];

    beforeEach(() => {
      for (const f of fixtures) {
        insertMemory(db, f.id, f.content);
      }
    });

    it('returns text candidates > 0 for 검색 랭킹 가중치 튜닝 (OR of partial docs)', () => {
      const candidates = ftsCandidates(db, '검색 랭킹 가중치 튜닝');
      const ids = new Set(candidates.map(r => r.id));
      const fixtureIds = fixtures.map(f => f.id);

      expect(candidates.length).toBeGreaterThan(0);
      expect(fixtureIds.every(id => ids.has(id))).toBe(true);
      // No single memory holds all four tokens; OR must surface all partial docs
      expect(
        fixtureIds.filter(id => ids.has(id)).length
      ).toBe(4);
    });

    it('single-token query still finds the matching memory', () => {
      const candidates = ftsCandidates(db, '검색');
      expect(candidates.map(r => r.id)).toContain('mem_search');
      expect(candidates.map(r => r.id)).not.toContain('mem_ranking');
    });

    it('long multi-token query still returns candidates (OR-cap regression)', () => {
      // > FTS_OR_ABOVE_TOKEN_COUNT (5); capped to FTS_MAX_TOKENS_FOR_OR with OR
      const longQuery =
        '검색 랭킹 가중치 튜닝 알파 베타 감마 델타 엡실론';
      const candidates = ftsCandidates(db, longQuery);
      expect(candidates.length).toBeGreaterThan(0);
      expect(
        candidates.some(r => fixtures.some(f => f.id === r.id))
      ).toBe(true);
    });
  });

  describe('US2 — particle-fused morphology via prefix (T005)', () => {
    it('query 가중치 matches body token 가중치는 via prefix*', () => {
      insertMemory(
        db,
        'mem_particle',
        '하이브리드 검색에서 가중치는 중요한 요소이다'
      );
      // Distractor without the stem — must not be required for the assert
      insertMemory(db, 'mem_other', '벡터 임베딩만 다루는 기억');

      expect(buildFTSQuery('가중치')).toContain('가중치*');

      const candidates = ftsCandidates(db, '가중치');
      expect(candidates.map(r => r.id)).toContain('mem_particle');
    });
  });
});
