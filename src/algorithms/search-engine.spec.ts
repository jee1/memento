import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { SearchEngine } from './search-engine.js';
import { DatabaseUtils } from '../utils/database.js';

const daysAgo = (days: number): string => {
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return date.toISOString();
};

interface MemorySeed {
  id: string;
  type: string;
  content: string;
  importance: number;
  createdAtIso: string;
  lastAccessedIso?: string | null;
  pinned?: boolean;
  tags?: string[];
  privacyScope?: string;
  source?: string | null;
}

describe('SearchEngine', () => {
  let db: sqlite3.Database;
  let engine: SearchEngine;

  beforeEach(async () => {
    db = new sqlite3.Database(':memory:');
    engine = new SearchEngine();

    await DatabaseUtils.exec(
      db,
      `CREATE TABLE memory_item (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        importance REAL NOT NULL,
        privacy_scope TEXT DEFAULT 'private',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_accessed TEXT,
        pinned BOOLEAN DEFAULT FALSE,
        tags TEXT,
        source TEXT,
        view_count INTEGER DEFAULT 0,
        cite_count INTEGER DEFAULT 0,
        edit_count INTEGER DEFAULT 0
      )`
    );

    await DatabaseUtils.exec(
      db,
      'CREATE VIRTUAL TABLE memory_item_fts USING fts5(content, tags, source)'
    );
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      db.close((err) => (err ? reject(err) : resolve()));
    });
  });

  const insertMemory = async (seed: MemorySeed): Promise<void> => {
    const {
      id,
      type,
      content,
      importance,
      createdAtIso,
      lastAccessedIso,
      pinned = false,
      tags = [],
      privacyScope = 'private',
      source = null
    } = seed;

    await DatabaseUtils.run(
      db,
      `INSERT INTO memory_item (
        id, type, content, importance, privacy_scope, created_at, last_accessed,
        pinned, tags, source, view_count, cite_count, edit_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)` ,
      [
        id,
        type,
        content,
        importance,
        privacyScope,
        createdAtIso,
        lastAccessedIso ?? null,
        pinned ? 1 : 0,
        JSON.stringify(tags),
        source
      ]
    );

    const row = await DatabaseUtils.get(
      db,
      'SELECT rowid FROM memory_item WHERE id = ?',
      [id]
    );

    await DatabaseUtils.run(
      db,
      'INSERT INTO memory_item_fts(rowid, content, tags, source) VALUES (?, ?, ?, ?)',
      [row.rowid, content, tags.join(' '), source]
    );
  };

  it('랭킹 기준에 따라 최신 기억을 우선 반환한다', async () => {
    await insertMemory({
      id: 'memory-recent',
      type: 'semantic',
      content: 'Hybrid search engine architecture overview',
      importance: 0.5,
      createdAtIso: daysAgo(2),
      lastAccessedIso: daysAgo(1),
      pinned: false,
      tags: ['search', 'hybrid']
    });

    await insertMemory({
      id: 'memory-old-pinned',
      type: 'semantic',
      content: 'Hybrid search algorithm design with vector integration',
      importance: 0.4,
      createdAtIso: daysAgo(200),
      lastAccessedIso: null,
      pinned: true,
      tags: ['search', 'vector']
    });

    await insertMemory({
      id: 'memory-unrelated',
      type: 'episodic',
      content: 'Cooking recipe for pasta with tomato sauce',
      importance: 0.3,
      createdAtIso: daysAgo(5),
      lastAccessedIso: null,
      pinned: false,
      tags: ['cooking']
    });

    const results = await engine.search(db, { query: 'hybrid search', limit: 5 });

    expect(results.map(r => r.id)).toEqual([
      'memory-recent',
      'memory-old-pinned'
    ]);
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
    expect(results.find(r => r.id === 'memory-unrelated')).toBeUndefined();
  });

  it('필터를 적용하면 조건에 부합하는 검색 결과만 반환한다', async () => {
    await insertMemory({
      id: 'memory-recent',
      type: 'semantic',
      content: 'Hybrid search engine architecture overview',
      importance: 0.5,
      createdAtIso: daysAgo(2),
      lastAccessedIso: daysAgo(1),
      pinned: false,
      tags: ['search', 'hybrid']
    });

    await insertMemory({
      id: 'memory-old-pinned',
      type: 'semantic',
      content: 'Hybrid search algorithm design with vector integration',
      importance: 0.4,
      createdAtIso: daysAgo(200),
      lastAccessedIso: null,
      pinned: true,
      tags: ['search', 'vector']
    });

    const pinnedResults = await engine.search(db, {
      query: 'hybrid search',
      filters: { pinned: true }
    });

    expect(pinnedResults).toHaveLength(1);
    expect(pinnedResults[0]?.id).toBe('memory-old-pinned');

    const typeFiltered = await engine.search(db, {
      query: 'hybrid search',
      filters: { type: ['semantic'], pinned: false }
    });

    expect(typeFiltered).toHaveLength(1);
    expect(typeFiltered[0]?.id).toBe('memory-recent');
  });
});
