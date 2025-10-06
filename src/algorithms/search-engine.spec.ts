/**
 * 검색 엔진 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SearchEngine, type SearchQuery } from './search-engine.js';
import Database from 'better-sqlite3';

// Mock Database
vi.mock('better-sqlite3', () => {
  const mockDb = {
    prepare: vi.fn(() => ({
      all: vi.fn(),
      get: vi.fn()
    }))
  };
  
  return {
    default: vi.fn(() => mockDb)
  };
});

describe('SearchEngine', () => {
  let searchEngine: SearchEngine;
  let mockDb: any;

  beforeEach(() => {
    searchEngine = new SearchEngine();
    mockDb = {
      prepare: vi.fn(() => ({
        all: vi.fn(),
        get: vi.fn()
      }))
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('search', () => {
    it('정상적인 검색 실행', async () => {
      const mockResults = [
        {
          id: 'mem1',
          content: 'test content',
          type: 'episodic',
          importance: 0.8,
          created_at: new Date().toISOString(),
          last_accessed: new Date().toISOString(),
          pinned: false,
          tags: JSON.stringify(['test']),
          source: 'test',
          fts_rank: 0.9
        }
      ];

      mockDb.prepare.mockReturnValue({
        all: vi.fn().mockReturnValue(mockResults)
      });

      const query: SearchQuery = {
        query: 'test',
        limit: 10
      };

      const result = await searchEngine.search(mockDb, query);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('mem1');
      expect(result.total_count).toBe(1);
      expect(result.query_time).toBeGreaterThan(0);
    });

    it('FTS5 사용 가능한 경우', async () => {
      const mockResults = [
        {
          id: 'mem1',
          content: 'test content',
          type: 'episodic',
          importance: 0.8,
          created_at: new Date().toISOString(),
          last_accessed: new Date().toISOString(),
          pinned: false,
          tags: JSON.stringify(['test']),
          source: 'test',
          fts_rank: 0.9
        }
      ];

      // FTS5 테이블 존재 확인 mock
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('sqlite_master')) {
          return { get: vi.fn().mockReturnValue({ name: 'memory_item_fts' }) };
        }
        if (sql.includes('COUNT(*)')) {
          return { get: vi.fn().mockReturnValue({ count: 1 }) };
        }
        if (sql.includes('SELECT * FROM memory_item_fts')) {
          return { get: vi.fn().mockReturnValue(mockResults[0]) };
        }
        return { all: vi.fn().mockReturnValue(mockResults) };
      });

      const query: SearchQuery = {
        query: 'test',
        limit: 10
      };

      const result = await searchEngine.search(mockDb, query);

      expect(result.items).toHaveLength(1);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('memory_item_fts')
      );
    });

    it('FTS5 사용 불가능한 경우 기본 검색', async () => {
      const mockResults = [
        {
          id: 'mem1',
          content: 'test content',
          type: 'episodic',
          importance: 0.8,
          created_at: new Date().toISOString(),
          last_accessed: new Date().toISOString(),
          pinned: false,
          tags: JSON.stringify(['test']),
          source: 'test',
          fts_rank: 0
        }
      ];

      // FTS5 테이블이 존재하지 않음
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('sqlite_master')) {
          return { get: vi.fn().mockReturnValue(null) };
        }
        return { all: vi.fn().mockReturnValue(mockResults) };
      });

      const query: SearchQuery = {
        query: 'test',
        limit: 10
      };

      const result = await searchEngine.search(mockDb, query);

      expect(result.items).toHaveLength(1);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('LIKE')
      );
    });

    it('ID 필터가 있는 경우', async () => {
      const mockResults = [
        {
          id: 'mem1',
          content: 'test content',
          type: 'episodic',
          importance: 0.8,
          created_at: new Date().toISOString(),
          last_accessed: new Date().toISOString(),
          pinned: false,
          tags: JSON.stringify(['test']),
          source: 'test',
          fts_rank: 0
        }
      ];

      mockDb.prepare.mockReturnValue({
        all: vi.fn().mockReturnValue(mockResults)
      });

      const query: SearchQuery = {
        query: 'test',
        filters: {
          id: ['mem1', 'mem2']
        },
        limit: 10
      };

      const result = await searchEngine.search(mockDb, query);

      expect(result.items).toHaveLength(1);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('m.id IN')
      );
    });

    it('타입 필터가 있는 경우', async () => {
      const mockResults = [
        {
          id: 'mem1',
          content: 'test content',
          type: 'episodic',
          importance: 0.8,
          created_at: new Date().toISOString(),
          last_accessed: new Date().toISOString(),
          pinned: false,
          tags: JSON.stringify(['test']),
          source: 'test',
          fts_rank: 0
        }
      ];

      mockDb.prepare.mockReturnValue({
        all: vi.fn().mockReturnValue(mockResults)
      });

      const query: SearchQuery = {
        query: 'test',
        filters: {
          type: ['episodic', 'semantic']
        },
        limit: 10
      };

      const result = await searchEngine.search(mockDb, query);

      expect(result.items).toHaveLength(1);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('m.type IN')
      );
    });

    it('고정 필터가 있는 경우', async () => {
      const mockResults = [
        {
          id: 'mem1',
          content: 'test content',
          type: 'episodic',
          importance: 0.8,
          created_at: new Date().toISOString(),
          last_accessed: new Date().toISOString(),
          pinned: true,
          tags: JSON.stringify(['test']),
          source: 'test',
          fts_rank: 0
        }
      ];

      mockDb.prepare.mockReturnValue({
        all: vi.fn().mockReturnValue(mockResults)
      });

      const query: SearchQuery = {
        query: 'test',
        filters: {
          pinned: true
        },
        limit: 10
      };

      const result = await searchEngine.search(mockDb, query);

      expect(result.items).toHaveLength(1);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('m.pinned = ?')
      );
    });

    it('시간 필터가 있는 경우', async () => {
      const mockResults = [
        {
          id: 'mem1',
          content: 'test content',
          type: 'episodic',
          importance: 0.8,
          created_at: new Date().toISOString(),
          last_accessed: new Date().toISOString(),
          pinned: false,
          tags: JSON.stringify(['test']),
          source: 'test',
          fts_rank: 0
        }
      ];

      mockDb.prepare.mockReturnValue({
        all: vi.fn().mockReturnValue(mockResults)
      });

      const query: SearchQuery = {
        query: 'test',
        filters: {
          time_from: '2024-01-01',
          time_to: '2024-12-31'
        },
        limit: 10
      };

      const result = await searchEngine.search(mockDb, query);

      expect(result.items).toHaveLength(1);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('m.created_at >= ?')
      );
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('m.created_at <= ?')
      );
    });

    it('빈 검색어 처리', async () => {
      const mockResults = [
        {
          id: 'mem1',
          content: 'test content',
          type: 'episodic',
          importance: 0.8,
          created_at: new Date().toISOString(),
          last_accessed: new Date().toISOString(),
          pinned: false,
          tags: JSON.stringify(['test']),
          source: 'test',
          fts_rank: 0
        }
      ];

      mockDb.prepare.mockReturnValue({
        all: vi.fn().mockReturnValue(mockResults)
      });

      const query: SearchQuery = {
        query: '',
        limit: 10
      };

      const result = await searchEngine.search(mockDb, query);

      expect(result.items).toHaveLength(1);
    });

    it('결과 제한 테스트', async () => {
      const mockResults = Array.from({ length: 20 }, (_, i) => ({
        id: `mem${i}`,
        content: `test content ${i}`,
        type: 'episodic',
        importance: 0.8,
        created_at: new Date().toISOString(),
        last_accessed: new Date().toISOString(),
        pinned: false,
        tags: JSON.stringify(['test']),
        source: 'test',
        fts_rank: 0.9 - i * 0.01
      }));

      mockDb.prepare.mockReturnValue({
        all: vi.fn().mockReturnValue(mockResults)
      });

      const query: SearchQuery = {
        query: 'test',
        limit: 5
      };

      const result = await searchEngine.search(mockDb, query);

      expect(result.items).toHaveLength(5);
      expect(result.total_count).toBe(5);
    });
  });

  describe('buildFTSQuery', () => {
    it('정상적인 FTS 쿼리 구성', () => {
      const query = 'test query';
      const ftsQuery = (searchEngine as any).buildFTSQuery(query);
      
      expect(ftsQuery).toBeDefined();
      expect(ftsQuery).not.toBe('');
    });

    it('빈 쿼리 처리', () => {
      const query = '';
      const ftsQuery = (searchEngine as any).buildFTSQuery(query);
      
      expect(ftsQuery).toBe('*');
    });

    it('공백만 있는 쿼리 처리', () => {
      const query = '   ';
      const ftsQuery = (searchEngine as any).buildFTSQuery(query);
      
      expect(ftsQuery).toBe('*');
    });

    it('특수문자 포함 쿼리 처리', () => {
      const query = 'test@#$%^&*()_+{}|:"<>?[]\\;\',./';
      const ftsQuery = (searchEngine as any).buildFTSQuery(query);
      
      expect(ftsQuery).toBeDefined();
      expect(ftsQuery).not.toContain('@');
      expect(ftsQuery).not.toContain('#');
    });
  });

  describe('preprocessQuery', () => {
    it('정상적인 쿼리 전처리', () => {
      const query = 'test query with spaces';
      const processed = (searchEngine as any).preprocessQuery(query);
      
      expect(processed).toBe('test query spaces');
    });

    it('연속 공백 제거', () => {
      const query = 'test    query   with    spaces';
      const processed = (searchEngine as any).preprocessQuery(query);
      
      expect(processed).toBe('test query spaces');
    });

    it('특수문자 제거', () => {
      const query = 'test@#$%^&*()_+{}|:"<>?[]\\;\',./query';
      const processed = (searchEngine as any).preprocessQuery(query);
      
      expect(processed).toBe('test query');
    });

    it('불용어 제거', () => {
      const query = 'the test query with and or but';
      const processed = (searchEngine as any).preprocessQuery(query);
      
      // 불용어가 제거되어야 함
      expect(processed).not.toContain('the');
      expect(processed).not.toContain('with');
      expect(processed).not.toContain('and');
      expect(processed).not.toContain('or');
      expect(processed).not.toContain('but');
    });

    it('한글 쿼리 처리', () => {
      const query = '테스트 쿼리';
      const processed = (searchEngine as any).preprocessQuery(query);
      
      expect(processed).toBe('테스트 쿼리');
    });

    it('영문과 한글 혼합 쿼리', () => {
      const query = 'test 테스트 query';
      const processed = (searchEngine as any).preprocessQuery(query);
      
      expect(processed).toBe('test 테스트 query');
    });
  });

  describe('makeFTSSafe', () => {
    it('FTS5 안전 쿼리 생성', () => {
      const query = 'test "query" with \'quotes\'';
      const safeQuery = (searchEngine as any).makeFTSSafe(query);
      
      expect(safeQuery).toBeDefined();
      expect(safeQuery).toContain('""'); // 이스케이프된 따옴표
      expect(safeQuery).toContain("''"); // 이스케이프된 작은따옴표
    });

    it('대괄호 제거', () => {
      const query = 'test [query] with {brackets}';
      const safeQuery = (searchEngine as any).makeFTSSafe(query);
      
      expect(safeQuery).not.toContain('[');
      expect(safeQuery).not.toContain(']');
      expect(safeQuery).not.toContain('{');
      expect(safeQuery).not.toContain('}');
    });

    it('연속 공백 정리', () => {
      const query = 'test    query   with    spaces';
      const safeQuery = (searchEngine as any).makeFTSSafe(query);
      
      expect(safeQuery).toBe('test query with spaces');
    });
  });

  describe('checkFTS5Availability', () => {
    it('FTS5 사용 가능한 경우', async () => {
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('sqlite_master')) {
          return { get: vi.fn().mockReturnValue({ name: 'memory_item_fts' }) };
        }
        if (sql.includes('COUNT(*)')) {
          return { get: vi.fn().mockReturnValue({ count: 1 }) };
        }
        if (sql.includes('SELECT * FROM memory_item_fts')) {
          return { get: vi.fn().mockReturnValue({ id: 'test' }) };
        }
        return { get: vi.fn() };
      });

      const isAvailable = await (searchEngine as any).checkFTS5Availability(mockDb);
      
      expect(isAvailable).toBe(true);
    });

    it('FTS5 테이블이 없는 경우', async () => {
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('sqlite_master')) {
          return { get: vi.fn().mockReturnValue(null) };
        }
        return { get: vi.fn() };
      });

      const isAvailable = await (searchEngine as any).checkFTS5Availability(mockDb);
      
      expect(isAvailable).toBe(false);
    });

    it('FTS5 테이블에 데이터가 없는 경우', async () => {
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('sqlite_master')) {
          return { get: vi.fn().mockReturnValue({ name: 'memory_item_fts' }) };
        }
        if (sql.includes('COUNT(*)')) {
          return { get: vi.fn().mockReturnValue({ count: 0 }) };
        }
        return { get: vi.fn() };
      });

      const isAvailable = await (searchEngine as any).checkFTS5Availability(mockDb);
      
      expect(isAvailable).toBe(false);
    });

    it('FTS5 쿼리 실패하는 경우', async () => {
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('sqlite_master')) {
          return { get: vi.fn().mockReturnValue({ name: 'memory_item_fts' }) };
        }
        if (sql.includes('COUNT(*)')) {
          return { get: vi.fn().mockReturnValue({ count: 1 }) };
        }
        if (sql.includes('SELECT * FROM memory_item_fts')) {
          return { get: vi.fn().mockImplementation(() => { throw new Error('FTS error'); }) };
        }
        return { get: vi.fn() };
      });

      const isAvailable = await (searchEngine as any).checkFTS5Availability(mockDb);
      
      expect(isAvailable).toBe(false);
    });
  });

  describe('applyRanking', () => {
    it('정상적인 랭킹 적용', () => {
      const results = [
        {
          id: 'mem1',
          content: 'test content',
          type: 'episodic',
          importance: 0.8,
          created_at: new Date().toISOString(),
          last_accessed: new Date().toISOString(),
          pinned: false,
          tags: JSON.stringify(['test']),
          source: 'test',
          fts_rank: 0.9
        }
      ];

      const rankedResults = (searchEngine as any).applyRanking(results, 'test');
      
      expect(rankedResults).toHaveLength(1);
      expect(rankedResults[0].id).toBe('mem1');
      expect(rankedResults[0].score).toBeGreaterThan(0);
      expect(rankedResults[0].recall_reason).toBeDefined();
    });

    it('FTS 랭킹이 있는 경우', () => {
      const results = [
        {
          id: 'mem1',
          content: 'test content',
          type: 'episodic',
          importance: 0.8,
          created_at: new Date().toISOString(),
          last_accessed: new Date().toISOString(),
          pinned: false,
          tags: JSON.stringify(['test']),
          source: 'test',
          fts_rank: 50 // FTS5 랭킹
        }
      ];

      const rankedResults = (searchEngine as any).applyRanking(results, 'test');
      
      expect(rankedResults).toHaveLength(1);
      expect(rankedResults[0].score).toBeGreaterThan(0);
    });

    it('FTS 랭킹이 없는 경우', () => {
      const results = [
        {
          id: 'mem1',
          content: 'test content',
          type: 'episodic',
          importance: 0.8,
          created_at: new Date().toISOString(),
          last_accessed: new Date().toISOString(),
          pinned: false,
          tags: JSON.stringify(['test']),
          source: 'test',
          fts_rank: 0
        }
      ];

      const rankedResults = (searchEngine as any).applyRanking(results, 'test');
      
      expect(rankedResults).toHaveLength(1);
      expect(rankedResults[0].score).toBeGreaterThan(0);
    });

    it('정렬 확인', () => {
      const results = [
        {
          id: 'mem1',
          content: 'test content',
          type: 'episodic',
          importance: 0.5,
          created_at: new Date().toISOString(),
          last_accessed: new Date().toISOString(),
          pinned: false,
          tags: JSON.stringify(['test']),
          source: 'test',
          fts_rank: 0.3
        },
        {
          id: 'mem2',
          content: 'better test content',
          type: 'episodic',
          importance: 0.8,
          created_at: new Date().toISOString(),
          last_accessed: new Date().toISOString(),
          pinned: true,
          tags: JSON.stringify(['test', 'better']),
          source: 'test',
          fts_rank: 0.8
        }
      ];

      const rankedResults = (searchEngine as any).applyRanking(results, 'test');
      
      expect(rankedResults).toHaveLength(2);
      expect(rankedResults[0].score).toBeGreaterThanOrEqual(rankedResults[1].score);
    });
  });

  describe('generateRecallReason', () => {
    it('FTS5 검색 이유 생성', () => {
      const reason = (searchEngine as any).generateRecallReason(
        0.8, 0.6, 0.7, 0.9, true
      );
      
      expect(reason).toContain('FTS5 전문 검색');
    });

    it('높은 관련성 이유 생성', () => {
      const reason = (searchEngine as any).generateRecallReason(
        0.8, 0.6, 0.7, 0.9, false
      );
      
      expect(reason).toContain('높은 관련성');
    });

    it('최근 생성 이유 생성', () => {
      const reason = (searchEngine as any).generateRecallReason(
        0.5, 0.9, 0.7, 0.8, false
      );
      
      expect(reason).toContain('최근 생성');
    });

    it('높은 중요도 이유 생성', () => {
      const reason = (searchEngine as any).generateRecallReason(
        0.5, 0.6, 0.9, 0.8, false
      );
      
      expect(reason).toContain('높은 중요도');
    });

    it('종합 점수 우수 이유 생성', () => {
      const reason = (searchEngine as any).generateRecallReason(
        0.8, 0.8, 0.8, 0.95, false
      );
      
      expect(reason).toContain('종합 점수 우수');
    });

    it('복합 이유 생성', () => {
      const reason = (searchEngine as any).generateRecallReason(
        0.8, 0.9, 0.9, 0.95, true
      );
      
      expect(reason).toContain('FTS5 전문 검색');
      expect(reason).toContain('높은 관련성');
      expect(reason).toContain('최근 생성');
      expect(reason).toContain('높은 중요도');
      expect(reason).toContain('종합 점수 우수');
    });

    it('기본 이유 생성', () => {
      const reason = (searchEngine as any).generateRecallReason(
        0.3, 0.3, 0.3, 0.3, false
      );
      
      expect(reason).toBe('일반 검색 결과');
    });
  });

  describe('엣지 케이스', () => {
    it('매우 긴 쿼리 처리', async () => {
      const longQuery = 'a'.repeat(10000);
      const mockResults = [];

      mockDb.prepare.mockReturnValue({
        all: vi.fn().mockReturnValue(mockResults)
      });

      const query: SearchQuery = {
        query: longQuery,
        limit: 10
      };

      const result = await searchEngine.search(mockDb, query);

      expect(result.items).toHaveLength(0);
    });

    it('특수문자만 포함된 쿼리', async () => {
      const mockResults = [];

      mockDb.prepare.mockReturnValue({
        all: vi.fn().mockReturnValue(mockResults)
      });

      const query: SearchQuery = {
        query: '@#$%^&*()_+{}|:"<>?[]\\;\',./',
        limit: 10
      };

      const result = await searchEngine.search(mockDb, query);

      expect(result.items).toHaveLength(0);
    });

    it('데이터베이스 오류 처리', async () => {
      mockDb.prepare.mockImplementation(() => {
        throw new Error('Database error');
      });

      const query: SearchQuery = {
        query: 'test',
        limit: 10
      };

      await expect(searchEngine.search(mockDb, query)).rejects.toThrow('Database error');
    });

    it('빈 결과 처리', async () => {
      mockDb.prepare.mockReturnValue({
        all: vi.fn().mockReturnValue([])
      });

      const query: SearchQuery = {
        query: 'nonexistent',
        limit: 10
      };

      const result = await searchEngine.search(mockDb, query);

      expect(result.items).toHaveLength(0);
      expect(result.total_count).toBe(0);
    });

    it('잘못된 JSON 태그 처리', () => {
      const results = [
        {
          id: 'mem1',
          content: 'test content',
          type: 'episodic',
          importance: 0.8,
          created_at: new Date().toISOString(),
          last_accessed: new Date().toISOString(),
          pinned: false,
          tags: 'invalid json',
          source: 'test',
          fts_rank: 0
        }
      ];

      expect(() => {
        (searchEngine as any).applyRanking(results, 'test');
      }).toThrow();
    });
  });

  describe('성능 테스트', () => {
    it('대량 결과 처리 성능', async () => {
      const mockResults = Array.from({ length: 1000 }, (_, i) => ({
        id: `mem${i}`,
        content: `test content ${i}`,
        type: 'episodic',
        importance: 0.8,
        created_at: new Date().toISOString(),
        last_accessed: new Date().toISOString(),
        pinned: false,
        tags: JSON.stringify(['test']),
        source: 'test',
        fts_rank: 0.9 - i * 0.001
      }));

      mockDb.prepare.mockReturnValue({
        all: vi.fn().mockReturnValue(mockResults)
      });

      const startTime = Date.now();
      
      const query: SearchQuery = {
        query: 'test',
        limit: 100
      };

      const result = await searchEngine.search(mockDb, query);
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(result.items).toHaveLength(100);
      expect(duration).toBeLessThan(2000); // 2초 이내 (더 관대한 허용 시간)
    });

    it('반복 검색 성능', async () => {
      const mockResults = [
        {
          id: 'mem1',
          content: 'test content',
          type: 'episodic',
          importance: 0.8,
          created_at: new Date().toISOString(),
          last_accessed: new Date().toISOString(),
          pinned: false,
          tags: JSON.stringify(['test']),
          source: 'test',
          fts_rank: 0.9
        }
      ];

      mockDb.prepare.mockReturnValue({
        all: vi.fn().mockReturnValue(mockResults)
      });

      const startTime = Date.now();
      
      // 100번 반복 검색
      for (let i = 0; i < 100; i++) {
        const query: SearchQuery = {
          query: 'test',
          limit: 10
        };
        await searchEngine.search(mockDb, query);
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(500); // 500ms 이내
    });
  });
});
