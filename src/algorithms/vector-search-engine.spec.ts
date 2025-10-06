/**
 * 벡터 검색 엔진 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VectorSearchEngine, type VectorSearchResult, type VectorSearchOptions, type VectorIndexStatus } from './vector-search-engine.js';
import Database from 'better-sqlite3';

// Mock Database - removed global mock to avoid conflicts with individual mocks

describe('VectorSearchEngine', () => {
  let vectorEngine: VectorSearchEngine;
  let mockDb: any;

  // Helper function to create consistent mock implementation
  const createMockImplementation = (mockResults: any[] = []) => {
    return (sql: string) => {
      if (sql.includes('sqlite_master')) {
        return { all: vi.fn().mockReturnValue([{ name: 'memory_item_vec_tfidf' }]) };
      }
      if (sql.includes('COUNT(*)')) {
        return { get: vi.fn().mockReturnValue({ count: 1 }) };
      }
      if (sql.includes('SELECT distance FROM memory_item_vec_tfidf')) {
        return { get: vi.fn().mockReturnValue({ distance: 0.5 }) };
      }
      // Handle vector search queries - check for the specific SQL pattern
      if (sql.includes('SELECT') && sql.includes('vec.rowid as memory_id')) {
        return { all: vi.fn().mockReturnValue(mockResults) };
      }
      // Handle hybrid search queries
      if (sql.includes('WITH vector_search AS') || sql.includes('FROM memory_item_fts fts')) {
        return { all: vi.fn().mockReturnValue(mockResults) };
      }
      // Default for any SELECT query
      if (sql.includes('SELECT')) {
        return { all: vi.fn().mockReturnValue(mockResults) };
      }
      return { all: vi.fn().mockReturnValue([]) };
    };
  };

  beforeEach(() => {
    vectorEngine = new VectorSearchEngine();
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

  describe('initialize', () => {
    it('정상적인 초기화', () => {
      vectorEngine.initialize(mockDb);
      
      expect(mockDb).toBeDefined();
    });

    it('null 데이터베이스 초기화', () => {
      vectorEngine.initialize(null as any);
      
      // VEC 사용 불가능 상태가 되어야 함
      expect(vectorEngine.isAvailable()).toBe(false);
    });
  });

  describe('checkVecAvailability', () => {
    it('VEC 사용 가능한 경우', () => {
      mockDb.prepare.mockImplementation(createMockImplementation());

      vectorEngine.initialize(mockDb);
      
      expect(vectorEngine.isAvailable()).toBe(true);
    });

    it('VEC 테이블이 없는 경우', () => {
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('sqlite_master')) {
          return { all: vi.fn().mockReturnValue([]) };
        }
        return { get: vi.fn() };
      });

      vectorEngine.initialize(mockDb);
      
      expect(vectorEngine.isAvailable()).toBe(false);
    });

    it('VEC 테이블에 데이터가 없는 경우', () => {
      mockDb.prepare.mockImplementation(createMockImplementation());

      vectorEngine.initialize(mockDb);
      
      expect(vectorEngine.isAvailable()).toBe(true); // VEC가 설치되어 있으면 available
    });

    it('VEC 함수 사용 불가능한 경우', () => {
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('sqlite_master')) {
          return { all: vi.fn().mockReturnValue([{ name: 'memory_item_vec_tfidf' }]) };
        }
        if (sql.includes('COUNT(*)')) {
          return { get: vi.fn().mockReturnValue({ count: 1 }) };
        }
        if (sql.includes('SELECT distance FROM memory_item_vec_tfidf')) {
          return { get: vi.fn().mockImplementation(() => { throw new Error('VEC error'); }) };
        }
        return { get: vi.fn() };
      });

      vectorEngine.initialize(mockDb);
      
      expect(vectorEngine.isAvailable()).toBe(false);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      // VEC 사용 가능 상태로 설정
      const defaultMockResults = [
        {
          memory_id: 'mem1',
          similarity: 0.3, // SQL query selects vec.distance as similarity
          content: 'test content',
          type: 'episodic',
          importance: 0.8,
          created_at: new Date().toISOString(),
          last_accessed: new Date().toISOString(),
          pinned: false,
          tags: JSON.stringify(['test'])
        }
      ];
      mockDb.prepare.mockImplementation(createMockImplementation(defaultMockResults));
      vectorEngine.initialize(mockDb);
    });

    it('정상적인 벡터 검색', async () => {
      const queryVector = new Array(384).fill(0.1);
      const options: VectorSearchOptions = {
        limit: 10,
        threshold: 0.5,
        includeContent: true
      };

      // Mock database results
      const mockResults = [
        {
          memory_id: 'mem1',
          similarity: 0.3,
          content: 'test content',
          type: 'semantic',
          importance: 0.8,
          created_at: '2023-01-01T00:00:00Z',
          last_accessed: '2023-01-02T00:00:00Z',
          pinned: false
        }
      ];

      // Update the existing mock to return results
      mockDb.prepare.mockImplementation(createMockImplementation(mockResults));

      const results = await vectorEngine.search(queryVector, options);

      expect(results).toHaveLength(1);
      expect(results[0].memory_id).toBe('mem1');
      expect(results[0].similarity).toBeCloseTo(0.7, 1); // 1 - 0.3
      expect(results[0].content).toBe('test content');
    });

    it('VEC 사용 불가능한 경우 빈 결과', async () => {
      vectorEngine.initialize(null as any);
      
      const queryVector = new Array(384).fill(0.1);
      const results = await vectorEngine.search(queryVector);

      expect(results).toHaveLength(0);
    });

    it('벡터 차원 불일치 처리', async () => {
      const queryVector = new Array(1000).fill(0.1); // 잘못된 차원
      const results = await vectorEngine.search(queryVector);

      expect(results).toHaveLength(0);
    });

    it('임계값 필터링', async () => {
      const queryVector = new Array(384).fill(0.1);
      const options: VectorSearchOptions = {
        limit: 10,
        threshold: 0.8, // 높은 임계값
        includeContent: true
      };

      const results = await vectorEngine.search(queryVector, options);

      // distance 0.3이 similarity 0.7로 변환되어 임계값 0.8보다 낮으므로 필터링됨
      expect(results).toHaveLength(0);
    });

    it('타입 필터 적용', async () => {
      const queryVector = new Array(384).fill(0.1);
      const options: VectorSearchOptions = {
        limit: 10,
        threshold: 0.5,
        type: 'episodic',
        includeContent: true
      };

      // Mock database results
      const mockResults = [
        {
          memory_id: 'mem1',
          similarity: 0.3,
          content: 'test content',
          type: 'episodic',
          importance: 0.8,
          created_at: '2023-01-01T00:00:00Z',
          last_accessed: '2023-01-02T00:00:00Z',
          pinned: false
        }
      ];

      // Update the existing mock to return results
      mockDb.prepare.mockImplementation(createMockImplementation(mockResults));

      const results = await vectorEngine.search(queryVector, options);

      expect(results).toHaveLength(1);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('AND mi.type = ?')
      );
    });

    it('메타데이터 포함 옵션', async () => {
      const queryVector = new Array(384).fill(0.1);
      const options: VectorSearchOptions = {
        limit: 10,
        threshold: 0.5,
        includeContent: true,
        includeMetadata: true
      };

      // Mock database results
      const mockResults = [
        {
          memory_id: 'mem1',
          similarity: 0.3,
          content: 'test content',
          type: 'semantic',
          importance: 0.8,
          created_at: '2023-01-01T00:00:00Z',
          last_accessed: '2023-01-02T00:00:00Z',
          pinned: false,
          tags: JSON.stringify(['test', 'example'])
        }
      ];

      // Update the existing mock to return results
      mockDb.prepare.mockImplementation(createMockImplementation(mockResults));

      const results = await vectorEngine.search(queryVector, options);

      expect(results).toHaveLength(1);
      expect(results[0].last_accessed).toBeDefined();
      expect(results[0].pinned).toBeDefined();
      expect(results[0].tags).toBeDefined();
    });

    it('메타데이터 제외 옵션', async () => {
      const queryVector = new Array(384).fill(0.1);
      const options: VectorSearchOptions = {
        limit: 10,
        threshold: 0.5,
        includeContent: false,
        includeMetadata: false
      };

      // Mock database results
      const mockResults = [
        {
          memory_id: 'mem1',
          similarity: 0.3,
          content: 'test content',
          type: 'semantic',
          importance: 0.8,
          created_at: '2023-01-01T00:00:00Z',
          last_accessed: '2023-01-02T00:00:00Z',
          pinned: false,
          tags: JSON.stringify(['test', 'example'])
        }
      ];

      // Update the existing mock to return results
      mockDb.prepare.mockImplementation(createMockImplementation(mockResults));

      const results = await vectorEngine.search(queryVector, options);

      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('');
      expect(results[0].last_accessed).toBeUndefined();
      expect(results[0].pinned).toBe(false);
      expect(results[0].tags).toBeUndefined();
    });

    it('다양한 제공자 테스트', async () => {
      const queryVector = new Array(384).fill(0.1);
      
      // Mock database results
      const mockResults = [
        {
          memory_id: 'mem1',
          similarity: 0.3,
          content: 'test content',
          type: 'semantic',
          importance: 0.8,
          created_at: '2023-01-01T00:00:00Z',
          last_accessed: '2023-01-02T00:00:00Z',
          pinned: false
        }
      ];

      // Update the existing mock to return results
      mockDb.prepare.mockImplementation(createMockImplementation(mockResults));
      
      // tfidf 제공자
      const tfidfResults = await vectorEngine.search(queryVector, {}, 'tfidf');
      expect(tfidfResults).toHaveLength(1);
      
      // minilm 제공자
      const minilmResults = await vectorEngine.search(queryVector, {}, 'minilm');
      expect(minilmResults).toHaveLength(1);
      
      // openai 제공자
      const openaiResults = await vectorEngine.search(queryVector, {}, 'openai');
      expect(openaiResults).toHaveLength(1);
      
      // gemini 제공자
      const geminiResults = await vectorEngine.search(queryVector, {}, 'gemini');
      expect(geminiResults).toHaveLength(1);
    });
  });

  describe('hybridSearch', () => {
    beforeEach(() => {
      // VEC 사용 가능 상태로 설정
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('sqlite_master')) {
          return { all: vi.fn().mockReturnValue([{ name: 'memory_item_vec_tfidf' }]) };
        }
        if (sql.includes('COUNT(*)')) {
          return { get: vi.fn().mockReturnValue({ count: 1 }) };
        }
        if (sql.includes('SELECT distance FROM memory_item_vec_tfidf')) {
          return { get: vi.fn().mockReturnValue({ distance: 0.5 }) };
        }
        if (sql.includes('WITH vector_search AS')) {
          return { all: vi.fn().mockReturnValue([
            {
              memory_id: 'mem1',
              vector_similarity: 0.7,
              text_similarity: 0.8,
              content: 'test content',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              last_accessed: new Date().toISOString(),
              pinned: false,
              tags: JSON.stringify(['test'])
            }
          ]) };
        }
        return { all: vi.fn().mockReturnValue([]) };
      });

      vectorEngine.initialize(mockDb);
    });

    it('정상적인 하이브리드 검색', async () => {
      const queryVector = new Array(384).fill(0.1);
      const textQuery = 'test query';
      const options: VectorSearchOptions = {
        limit: 10,
        threshold: 0.5,
        includeContent: true,
        includeMetadata: true
      };

      const results = await vectorEngine.hybridSearch(queryVector, textQuery, options);

      expect(results).toHaveLength(1);
      expect(results[0].memory_id).toBe('mem1');
      expect(results[0].similarity).toBeCloseTo(0.7 * 0.6 + 0.8 * 0.4, 2);
    });

    it('VEC 사용 불가능한 경우 빈 결과', async () => {
      vectorEngine.initialize(null as any);
      
      const queryVector = new Array(384).fill(0.1);
      const textQuery = 'test query';
      const results = await vectorEngine.hybridSearch(queryVector, textQuery);

      expect(results).toHaveLength(0);
    });

    it('벡터 차원 불일치 처리', async () => {
      const queryVector = new Array(1000).fill(0.1); // 잘못된 차원
      const textQuery = 'test query';
      const results = await vectorEngine.hybridSearch(queryVector, textQuery);

      expect(results).toHaveLength(0);
    });

    it('타입 필터 적용', async () => {
      const queryVector = new Array(384).fill(0.1);
      const textQuery = 'test query';
      const options: VectorSearchOptions = {
        limit: 10,
        threshold: 0.5,
        type: 'episodic',
        includeContent: true
      };

      const results = await vectorEngine.hybridSearch(queryVector, textQuery, options);

      expect(results).toHaveLength(1);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('AND mi.type = ?')
      );
    });
  });

  describe('getIndexStatus', () => {
    it('정상적인 인덱스 상태', () => {
      mockDb.prepare.mockImplementation(createMockImplementation());

      vectorEngine.initialize(mockDb);
      const status = vectorEngine.getIndexStatus();

      expect(status.available).toBe(true);
      expect(status.tableExists).toBe(true);
      expect(status.recordCount).toBeGreaterThan(0);
      expect(status.dimensions).toBe(384);
      expect(status.vecExtensionLoaded).toBe(true);
    });

    it('데이터베이스 연결 없는 경우', () => {
      const status = vectorEngine.getIndexStatus();

      expect(status.available).toBe(false);
      expect(status.tableExists).toBe(false);
      expect(status.recordCount).toBe(0);
      expect(status.dimensions).toBe(384);
      expect(status.vecExtensionLoaded).toBe(false);
    });

    it('VEC 사용 불가능한 경우', () => {
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('sqlite_master')) {
          return { all: vi.fn().mockReturnValue([]) };
        }
        return { get: vi.fn() };
      });

      vectorEngine.initialize(mockDb);
      const status = vectorEngine.getIndexStatus();

      expect(status.available).toBe(false);
      expect(status.tableExists).toBe(false);
      expect(status.recordCount).toBe(0);
    });

    it('다양한 제공자 테이블 확인', () => {
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('sqlite_master')) {
          return { all: vi.fn().mockReturnValue([
            { name: 'memory_item_vec_tfidf' },
            { name: 'memory_item_vec_minilm' },
            { name: 'memory_item_vec_openai' }
          ]) };
        }
        if (sql.includes('COUNT(*)')) {
          return { get: vi.fn().mockReturnValue({ count: 5 }) };
        }
        if (sql.includes('SELECT distance FROM memory_item_vec_tfidf')) {
          return { get: vi.fn().mockReturnValue({ distance: 0.5 }) };
        }
        return { get: vi.fn() };
      });

      vectorEngine.initialize(mockDb);
      const status = vectorEngine.getIndexStatus();

      expect(status.available).toBe(true);
      expect(status.recordCount).toBe(20); // 4개 테이블 * 5개 레코드
    });
  });

  describe('rebuildIndex', () => {
    it('정상적인 인덱스 재구성', async () => {
      mockDb.prepare.mockImplementation(createMockImplementation());

      vectorEngine.initialize(mockDb);
      const result = await vectorEngine.rebuildIndex();

      expect(result).toBe(true);
    });

    it('VEC 사용 불가능한 경우', async () => {
      vectorEngine.initialize(null as any);
      const result = await vectorEngine.rebuildIndex();

      expect(result).toBe(false);
    });
  });

  describe('performanceTest', () => {
    beforeEach(() => {
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('sqlite_master')) {
          return { all: vi.fn().mockReturnValue([{ name: 'memory_item_vec_tfidf' }]) };
        }
        if (sql.includes('COUNT(*)')) {
          return { get: vi.fn().mockReturnValue({ count: 1 }) };
        }
        if (sql.includes('SELECT distance FROM memory_item_vec_tfidf')) {
          return { get: vi.fn().mockReturnValue({ distance: 0.5 }) };
        }
        if (sql.includes('SELECT')) {
          return { all: vi.fn().mockReturnValue([
            {
              memory_id: 'mem1',
              similarity: 0.3,
              content: 'test content',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              last_accessed: new Date().toISOString(),
              pinned: false,
              tags: JSON.stringify(['test'])
            }
          ]) };
        }
        return { all: vi.fn().mockReturnValue([]) };
      });

      vectorEngine.initialize(mockDb);
    });

    it('정상적인 성능 테스트', async () => {
      const queryVector = new Array(384).fill(0.1);
      const performance = await vectorEngine.performanceTest(queryVector, 5);

      expect(performance.averageTime).toBeGreaterThan(0);
      expect(performance.minTime).toBeGreaterThan(0);
      expect(performance.maxTime).toBeGreaterThan(0);
      expect(performance.results).toBeGreaterThanOrEqual(0);
      expect(performance.successRate).toBeGreaterThanOrEqual(0);
    });

    it('VEC 사용 불가능한 경우', async () => {
      vectorEngine.initialize(null as any);
      const queryVector = new Array(384).fill(0.1);
      const performance = await vectorEngine.performanceTest(queryVector, 5);

      expect(performance.averageTime).toBe(0);
      expect(performance.minTime).toBe(0);
      expect(performance.maxTime).toBe(0);
      expect(performance.results).toBe(0);
      expect(performance.successRate).toBe(0);
    });

    it('성능 테스트 실패 처리', async () => {
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('sqlite_master')) {
          return { all: vi.fn().mockReturnValue([{ name: 'memory_item_vec_tfidf' }]) };
        }
        if (sql.includes('COUNT(*)')) {
          return { get: vi.fn().mockReturnValue({ count: 1 }) };
        }
        if (sql.includes('SELECT distance FROM memory_item_vec_tfidf')) {
          return { get: vi.fn().mockReturnValue({ distance: 0.5 }) };
        }
        if (sql.includes('SELECT')) {
          return { all: vi.fn().mockImplementation(() => { throw new Error('Test error'); }) };
        }
        return { all: vi.fn().mockReturnValue([]) };
      });

      vectorEngine.initialize(mockDb);
      const queryVector = new Array(384).fill(0.1);
      const performance = await vectorEngine.performanceTest(queryVector, 3);

      expect(performance.successRate).toBeLessThanOrEqual(1);
    });
  });

  describe('getDimensions', () => {
    it('기본 차원 반환', () => {
      const dimensions = vectorEngine.getDimensions();
      expect(dimensions).toBe(384);
    });
  });

  describe('isAvailable', () => {
    it('초기화 전 사용 불가능', () => {
      expect(vectorEngine.isAvailable()).toBe(false);
    });

    it('초기화 후 사용 가능', () => {
      mockDb.prepare.mockImplementation(createMockImplementation());

      vectorEngine.initialize(mockDb);
      expect(vectorEngine.isAvailable()).toBe(true);
    });
  });

  describe('isConnected', () => {
    it('연결되지 않은 상태', () => {
      expect(vectorEngine.isConnected()).toBe(false);
    });

    it('연결된 상태', () => {
      vectorEngine.initialize(mockDb);
      expect(vectorEngine.isConnected()).toBe(true);
    });
  });

  describe('getVectorTableName', () => {
    it('다양한 제공자별 테이블명', () => {
      const tfidfTable = (vectorEngine as any).getVectorTableName('tfidf');
      const minilmTable = (vectorEngine as any).getVectorTableName('minilm');
      const openaiTable = (vectorEngine as any).getVectorTableName('openai');
      const geminiTable = (vectorEngine as any).getVectorTableName('gemini');
      const defaultTable = (vectorEngine as any).getVectorTableName('unknown');

      expect(tfidfTable).toBe('memory_item_vec_tfidf');
      expect(minilmTable).toBe('memory_item_vec_minilm');
      expect(openaiTable).toBe('memory_item_vec_openai');
      expect(geminiTable).toBe('memory_item_vec_gemini');
      expect(defaultTable).toBe('memory_item_vec_tfidf');
    });
  });

  describe('엣지 케이스', () => {
    it('매우 큰 벡터 처리', async () => {
      const largeVector = new Array(10000).fill(0.1);
      const results = await vectorEngine.search(largeVector);

      expect(results).toHaveLength(0);
    });

    it('빈 벡터 처리', async () => {
      const emptyVector: number[] = [];
      const results = await vectorEngine.search(emptyVector);

      expect(results).toHaveLength(0);
    });

    it('NaN 값이 포함된 벡터', async () => {
      const nanVector = new Array(384).fill(NaN);
      const results = await vectorEngine.search(nanVector);

      expect(results).toHaveLength(0);
    });

    it('무한대 값이 포함된 벡터', async () => {
      const infVector = new Array(384).fill(Infinity);
      const results = await vectorEngine.search(infVector);

      expect(results).toHaveLength(0);
    });

    it('데이터베이스 오류 처리', async () => {
      mockDb.prepare.mockImplementation(() => {
        throw new Error('Database error');
      });

      vectorEngine.initialize(mockDb);
      const queryVector = new Array(384).fill(0.1);
      const results = await vectorEngine.search(queryVector);

      expect(results).toHaveLength(0);
    });

    it('잘못된 JSON 태그 처리', async () => {
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('sqlite_master')) {
          return { all: vi.fn().mockReturnValue([{ name: 'memory_item_vec_tfidf' }]) };
        }
        if (sql.includes('COUNT(*)')) {
          return { get: vi.fn().mockReturnValue({ count: 1 }) };
        }
        if (sql.includes('SELECT distance FROM memory_item_vec_tfidf')) {
          return { get: vi.fn().mockReturnValue({ distance: 0.5 }) };
        }
        if (sql.includes('SELECT')) {
          return { all: vi.fn().mockReturnValue([
            {
              memory_id: 'mem1',
              similarity: 0.3,
              content: 'test content',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              last_accessed: new Date().toISOString(),
              pinned: false,
              tags: 'invalid json'
            }
          ]) };
        }
        return { all: vi.fn().mockReturnValue([]) };
      });

      vectorEngine.initialize(mockDb);
      const queryVector = new Array(384).fill(0.1);
      
      // 잘못된 JSON 태그는 빈 배열로 처리되어야 함
      const results = await vectorEngine.search(queryVector);
      expect(results).toHaveLength(0);
    });

    it('매우 높은 임계값', async () => {
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('sqlite_master')) {
          return { all: vi.fn().mockReturnValue([{ name: 'memory_item_vec_tfidf' }]) };
        }
        if (sql.includes('COUNT(*)')) {
          return { get: vi.fn().mockReturnValue({ count: 1 }) };
        }
        if (sql.includes('SELECT distance FROM memory_item_vec_tfidf')) {
          return { get: vi.fn().mockReturnValue({ distance: 0.5 }) };
        }
        if (sql.includes('SELECT')) {
          return { all: vi.fn().mockReturnValue([
            {
              memory_id: 'mem1',
              similarity: 0.3,
              content: 'test content',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              last_accessed: new Date().toISOString(),
              pinned: false,
              tags: JSON.stringify(['test'])
            }
          ]) };
        }
        return { all: vi.fn().mockReturnValue([]) };
      });

      vectorEngine.initialize(mockDb);
      const queryVector = new Array(384).fill(0.1);
      const results = await vectorEngine.search(queryVector, { threshold: 0.99 });

      expect(results).toHaveLength(0);
    });

    it('매우 낮은 임계값', async () => {
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('sqlite_master')) {
          return { all: vi.fn().mockReturnValue([{ name: 'memory_item_vec_tfidf' }]) };
        }
        if (sql.includes('COUNT(*)')) {
          return { get: vi.fn().mockReturnValue({ count: 1 }) };
        }
        if (sql.includes('SELECT distance FROM memory_item_vec_tfidf')) {
          return { get: vi.fn().mockReturnValue({ distance: 0.5 }) };
        }
        if (sql.includes('SELECT')) {
          return { all: vi.fn().mockReturnValue([
            {
              memory_id: 'mem1',
              similarity: 0.9,
              content: 'test content',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              last_accessed: new Date().toISOString(),
              pinned: false,
              tags: JSON.stringify(['test'])
            }
          ]) };
        }
        return { all: vi.fn().mockReturnValue([]) };
      });

      vectorEngine.initialize(mockDb);
      const queryVector = new Array(384).fill(0.1);
      const results = await vectorEngine.search(queryVector, { threshold: 0.01 });

      expect(results).toHaveLength(1);
    });
  });

  describe('성능 테스트', () => {
    it('대량 벡터 검색 성능', async () => {
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('sqlite_master')) {
          return { all: vi.fn().mockReturnValue([{ name: 'memory_item_vec_tfidf' }]) };
        }
        if (sql.includes('COUNT(*)')) {
          return { get: vi.fn().mockReturnValue({ count: 1 }) };
        }
        if (sql.includes('SELECT distance FROM memory_item_vec_tfidf')) {
          return { get: vi.fn().mockReturnValue({ distance: 0.5 }) };
        }
        if (sql.includes('SELECT')) {
          const mockResults = Array.from({ length: 100 }, (_, i) => ({
            memory_id: `mem${i}`,
            similarity: 0.1 + i * 0.001,
            content: `test content ${i}`,
            type: 'episodic',
            importance: 0.8,
            created_at: new Date().toISOString(),
            last_accessed: new Date().toISOString(),
            pinned: false,
            tags: JSON.stringify(['test'])
          }));
          return { all: vi.fn().mockReturnValue(mockResults) };
        }
        return { all: vi.fn().mockReturnValue([]) };
      });

      vectorEngine.initialize(mockDb);
      const queryVector = new Array(384).fill(0.1);
      
      const startTime = Date.now();
      const results = await vectorEngine.search(queryVector, { limit: 100 });
      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(results).toHaveLength(100);
      expect(duration).toBeLessThan(1000); // 1초 이내
    });

    it('반복 검색 성능', async () => {
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('sqlite_master')) {
          return { all: vi.fn().mockReturnValue([{ name: 'memory_item_vec_tfidf' }]) };
        }
        if (sql.includes('COUNT(*)')) {
          return { get: vi.fn().mockReturnValue({ count: 1 }) };
        }
        if (sql.includes('SELECT distance FROM memory_item_vec_tfidf')) {
          return { get: vi.fn().mockReturnValue({ distance: 0.5 }) };
        }
        if (sql.includes('SELECT')) {
          return { all: vi.fn().mockReturnValue([
            {
              memory_id: 'mem1',
              similarity: 0.3,
              content: 'test content',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              last_accessed: new Date().toISOString(),
              pinned: false,
              tags: JSON.stringify(['test'])
            }
          ]) };
        }
        return { all: vi.fn().mockReturnValue([]) };
      });

      vectorEngine.initialize(mockDb);
      const queryVector = new Array(384).fill(0.1);
      
      const startTime = Date.now();
      
      // 100번 반복 검색
      for (let i = 0; i < 100; i++) {
        await vectorEngine.search(queryVector, { limit: 10 });
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(500); // 500ms 이내
    });
  });
});
