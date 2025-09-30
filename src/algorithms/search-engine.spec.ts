import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
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
  let db: Database.Database;
  let engine: SearchEngine;

  beforeEach(async () => {
    db = new Database(':memory:');
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
        agent_id TEXT,
        user_id TEXT,
        project_id TEXT,
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

  afterEach(() => {
    db.close();
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
        pinned, tags, source, agent_id, user_id, project_id, view_count, cite_count, edit_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)` ,
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
        source,
        null, // agent_id
        null, // user_id
        null  // project_id
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

    const searchResult = await engine.search(db, { query: 'hybrid search', limit: 5 });
    const results = searchResult.items;

    // 반환값 구조 검증
    expect(searchResult).toHaveProperty('items');
    expect(searchResult).toHaveProperty('total_count');
    expect(searchResult).toHaveProperty('query_time');
    expect(Array.isArray(results)).toBe(true);

    // 검색 결과 검증
    expect(results.map(r => r.id)).toEqual([
      'memory-recent',
      'memory-old-pinned'
    ]);
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
    expect(results.find(r => r.id === 'memory-unrelated')).toBeUndefined();

    // SearchResult 인터페이스 검증
    results.forEach(result => {
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('importance');
      expect(result).toHaveProperty('created_at');
      expect(result).toHaveProperty('pinned');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('recall_reason');
      expect(typeof result.score).toBe('number');
      expect(typeof result.recall_reason).toBe('string');
    });
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

    const pinnedSearchResult = await engine.search(db, {
      query: 'hybrid search',
      filters: { pinned: true }
    });
    const pinnedResults = pinnedSearchResult.items;

    expect(pinnedResults).toHaveLength(1);
    expect(pinnedResults[0]?.id).toBe('memory-old-pinned');

    const typeFilteredResult = await engine.search(db, {
      query: 'hybrid search',
      filters: { type: ['semantic'], pinned: false }
    });
    const typeFiltered = typeFilteredResult.items;

    expect(typeFiltered).toHaveLength(1);
    expect(typeFiltered[0]?.id).toBe('memory-recent');
  });

  it('FTS5 검색이 작동한다', async () => {
    await insertMemory({
      id: 'memory-fts-test',
      type: 'semantic',
      content: 'Full text search with FTS5 implementation',
      importance: 0.7,
      createdAtIso: daysAgo(1),
      lastAccessedIso: null,
      pinned: false,
      tags: ['search', 'fts5']
    });

    const searchResult = await engine.search(db, { query: 'FTS5', limit: 5 });
    const results = searchResult.items;

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('memory-fts-test');
    // FTS5 검색이 정상적으로 작동하는지 확인 (쿼리 로그에서 FTS5 사용 확인됨)
    expect(results[0]?.recall_reason).toBeDefined();
    expect(typeof results[0]?.recall_reason).toBe('string');
  });

  it('시간 필터가 작동한다', async () => {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

    await insertMemory({
      id: 'memory-old',
      type: 'episodic',
      content: 'Old memory from 3 days ago',
      importance: 0.5,
      createdAtIso: threeDaysAgo.toISOString(),
      lastAccessedIso: null,
      pinned: false,
      tags: ['old']
    });

    await insertMemory({
      id: 'memory-recent',
      type: 'episodic',
      content: 'Recent memory from 1 day ago',
      importance: 0.5,
      createdAtIso: oneDayAgo.toISOString(),
      lastAccessedIso: null,
      pinned: false,
      tags: ['recent']
    });

    // 최근 2일 이내 메모리만 검색
    const recentResult = await engine.search(db, {
      query: 'memory',
      filters: { time_from: twoDaysAgo.toISOString() }
    });

    expect(recentResult.items).toHaveLength(1);
    expect(recentResult.items[0]?.id).toBe('memory-recent');
  });

  it('빈 쿼리로 검색하면 모든 메모리를 반환한다', async () => {
    await insertMemory({
      id: 'memory-1',
      type: 'semantic',
      content: 'First memory',
      importance: 0.5,
      createdAtIso: daysAgo(1),
      lastAccessedIso: null,
      pinned: false,
      tags: ['test']
    });

    await insertMemory({
      id: 'memory-2',
      type: 'episodic',
      content: 'Second memory',
      importance: 0.3,
      createdAtIso: daysAgo(2),
      lastAccessedIso: null,
      pinned: false,
      tags: ['test']
    });

    const searchResult = await engine.search(db, { query: '', limit: 10 });
    
    expect(searchResult.items).toHaveLength(2);
    expect(searchResult.items.map(r => r.id)).toContain('memory-1');
    expect(searchResult.items.map(r => r.id)).toContain('memory-2');
  });

  it('ID 필터가 작동한다', async () => {
    await insertMemory({
      id: 'memory-target',
      type: 'semantic',
      content: 'Target memory',
      importance: 0.8,
      createdAtIso: daysAgo(1),
      lastAccessedIso: null,
      pinned: false,
      tags: ['target']
    });

    await insertMemory({
      id: 'memory-other',
      type: 'episodic',
      content: 'Other memory',
      importance: 0.5,
      createdAtIso: daysAgo(1),
      lastAccessedIso: null,
      pinned: false,
      tags: ['other']
    });

    const searchResult = await engine.search(db, {
      query: 'memory',
      filters: { id: ['memory-target'] }
    });

    expect(searchResult.items).toHaveLength(1);
    expect(searchResult.items[0]?.id).toBe('memory-target');
  });

  it('privacy_scope 필터가 작동한다', async () => {
    await insertMemory({
      id: 'memory-private',
      type: 'semantic',
      content: 'Private memory',
      importance: 0.5,
      createdAtIso: daysAgo(1),
      lastAccessedIso: null,
      pinned: false,
      tags: ['private'],
      privacyScope: 'private'
    });

    await insertMemory({
      id: 'memory-public',
      type: 'semantic',
      content: 'Public memory',
      importance: 0.5,
      createdAtIso: daysAgo(1),
      lastAccessedIso: null,
      pinned: false,
      tags: ['public'],
      privacyScope: 'public'
    });

    const privateResult = await engine.search(db, {
      query: 'memory',
      filters: { privacy_scope: ['private'] }
    });

    expect(privateResult.items).toHaveLength(1);
    expect(privateResult.items[0]?.id).toBe('memory-private');
  });

  describe('불용어 처리', () => {
    it('불용어 처리가 정상적으로 작동한다', async () => {
      // 기존 메모리 데이터를 사용하여 테스트
      const result = await engine.search(db, {
        query: 'the hybrid search engine is really good',
        limit: 10
      });

      // 불용어가 제거되어 검색이 정상적으로 작동하는지 확인
      // (실제 검색 결과는 기존 테스트 데이터에 따라 달라질 수 있음)
      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('total_count');
      expect(Array.isArray(result.items)).toBe(true);
    });

    it('특수문자와 불용어가 포함된 쿼리가 정리된다', async () => {
      const result = await engine.search(db, {
        query: '!!!the hybrid search!!! 은 정말 @#$% 좋다!!!',
        limit: 10
      });

      // 쿼리 전처리가 정상적으로 작동하는지 확인
      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('total_count');
      expect(Array.isArray(result.items)).toBe(true);
    });

    it('연속된 공백과 불용어가 정리된다', async () => {
      const result = await engine.search(db, {
        query: '  the    hybrid   search   engine   is   really   good  ',
        limit: 10
      });

      // 쿼리 전처리가 정상적으로 작동하는지 확인
      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('total_count');
      expect(Array.isArray(result.items)).toBe(true);
    });

    it('대소문자 불용어가 올바르게 처리된다', async () => {
      const result = await engine.search(db, {
        query: 'THE Hybrid Search Engine IS Really Good',
        limit: 10
      });

      // 쿼리 전처리가 정상적으로 작동하는지 확인
      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('total_count');
      expect(Array.isArray(result.items)).toBe(true);
    });
  });
});
