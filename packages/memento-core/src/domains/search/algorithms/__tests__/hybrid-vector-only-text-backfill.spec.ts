import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { backfillVectorOnlyTextResults } from '../hybrid-vector-backfill.js';
import { buildFTSQuery } from '../search-engine/search-engine-fts-query.js';
import { ftsRankToRelevance } from '../search-engine/search-engine-ranking.js';
import type { VectorSearchResult } from '../../../embedding/index.js';

describe('backfillVectorOnlyTextResults (#1814)', () => {
  function createFtsDb(withFts = true): Database.Database {
    const db = new Database(':memory:');
    db.exec(
      'CREATE TABLE memory_item (id TEXT PRIMARY KEY, content TEXT, tags TEXT, source TEXT, reflection_notes TEXT)'
    );
    if (withFts) {
      db.exec(
        "CREATE VIRTUAL TABLE memory_item_fts USING fts5(content, tags, source, reflection_notes, content='memory_item', content_rowid='rowid')"
      );
    }
    return db;
  }

  function insertMemory(db: Database.Database, id: string, content: string): void {
    const info = db.prepare('INSERT INTO memory_item (id, content) VALUES (?, ?)').run(id, content);
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='memory_item_fts'").get()) {
      db.prepare('INSERT INTO memory_item_fts (rowid, content) VALUES (?, ?)').run(info.lastInsertRowid, content);
    }
  }

  function vectorRow(id: string): VectorSearchResult {
    return {
      id, content: id, type: 'episodic', importance: 0.5, created_at: '2026-09-19T00:00:00Z',
      pinned: false, similarity: 0.8, project_id: 'p1',
    } as VectorSearchResult;
  }

  // 텍스트 레인 SQL(search-engine-sql-builder)과 같은 MATCH 로 코퍼스 전체를 채점한 값.
  function textLaneScores(db: Database.Database, query: string): Map<string, number> {
    const rows = db
      .prepare('SELECT m.id AS id, memory_item_fts.rank AS fts_rank FROM memory_item_fts JOIN memory_item m ON memory_item_fts.rowid = m.rowid WHERE memory_item_fts MATCH ?')
      .all(buildFTSQuery(query)) as Array<{ id: string; fts_rank: number }>;
    return new Map(rows.map((r) => [r.id, ftsRankToRelevance(r.fts_rank)!]));
  }

  function seed(): Database.Database {
    const db = createFtsDb();
    insertMemory(db, 'strong', 'deploy pipeline rollback deploy pipeline');
    insertMemory(db, 'weak', 'deploy notes from a long meeting about many unrelated topics and lunch plans');
    insertMemory(db, 'none', 'gardening tips for tomatoes');
    for (let i = 0; i < 20; i++) insertMemory(db, `noise${i}`, `deploy filler ${i}`);
    return db;
  }

  it('질의에 걸리는 벡터 전용 후보는 텍스트 레인과 같은 점수를 받고, 더 잘 맞는 쪽이 높다', () => {
    const db = seed();
    const rows = backfillVectorOnlyTextResults(db, 'deploy pipeline', [], [vectorRow('strong'), vectorRow('weak')]) as Array<{ id: string; score: number; project_id?: string }>;
    const expected = textLaneScores(db, 'deploy pipeline');
    const strong = rows.find((r) => r.id === 'strong')!;
    const weak = rows.find((r) => r.id === 'weak')!;
    expect(strong.score).toBeCloseTo(expected.get('strong')!, 10);
    expect(weak.score).toBeCloseTo(expected.get('weak')!, 10);
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.project_id).toBe('p1');
  });

  it('질의에 걸리지 않는 벡터 전용 후보는 돌려주지 않는다', () => {
    const db = seed();
    expect(backfillVectorOnlyTextResults(db, 'deploy pipeline', [], [vectorRow('none')])).toEqual([]);
  });

  it('텍스트 레인이 이미 뽑은 id 와 빈 질의는 건드리지 않는다', () => {
    const db = seed();
    expect(backfillVectorOnlyTextResults(db, 'deploy pipeline', [{ id: 'strong', score: 0.9 }], [vectorRow('strong')])).toEqual([]);
    expect(backfillVectorOnlyTextResults(db, '', [], [vectorRow('strong')])).toEqual([]);
  });

  it('FTS 테이블이 없으면 던지지 않고 빈 배열을 돌려준다', () => {
    const db = createFtsDb(false);
    insertMemory(db, 'strong', 'deploy pipeline');
    expect(backfillVectorOnlyTextResults(db, 'deploy pipeline', [], [vectorRow('strong')])).toEqual([]);
  });
});
