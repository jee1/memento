import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getVectorSearchEngine, VectorSearchEngine, resetVectorSearchEngine } from '../algorithms/vector-search-engine.js';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../utils/database.js';

// Mock sqlite-vec functions
const mockVecSearch = vi.fn();
const mockVecDistance = vi.fn();

// Mock sqlite-vec extension
vi.mock('better-sqlite3', async () => {
  const actual = await vi.importActual('better-sqlite3');
  return {
    ...actual,
    default: class MockDatabase extends actual.default {
      constructor(...args: any[]) {
        super(...args);
        // Mock sqlite-vec functions
        this.function('vec_search', mockVecSearch);
        this.function('vec_distance', mockVecDistance);
      }
      
      // Mock prepare method to return proper query objects
      prepare(sql: string) {
        const originalPrepare = super.prepare(sql);
        return {
          ...originalPrepare,
          get: vi.fn().mockReturnValue({ page_count: 1000, page_size: 4096 }),
          all: vi.fn().mockReturnValue([]),
          run: vi.fn().mockReturnValue({ changes: 0 })
        };
      }
    }
  };
});

describe('VectorSearchEngine', () => {
  let db: Database.Database;
  let vectorSearchEngine: VectorSearchEngine;
  
  // Test data
  const testQueryVector = new Array(1536).fill(0.1);
  const testTextQuery = 'test query';
  const mockSearchResults = [
    { 
      memory_id: '1', 
      similarity: 0.9, 
      content: 'test content 1', 
      type: 'episodic', 
      importance: 0.8,
      created_at: '2024-01-01T00:00:00Z',
      last_accessed: '2024-01-02T00:00:00Z',
      pinned: false,
      tags: '["test", "example"]'
    },
    { 
      memory_id: '2', 
      similarity: 0.8, 
      content: 'test content 2', 
      type: 'semantic', 
      importance: 0.7,
      created_at: '2024-01-02T00:00:00Z',
      last_accessed: '2024-01-03T00:00:00Z',
      pinned: true,
      tags: '["test", "demo"]'
    },
    { 
      memory_id: '3', 
      similarity: 0.7, 
      content: 'test content 3', 
      type: 'procedural', 
      importance: 0.6,
      created_at: '2024-01-03T00:00:00Z',
      last_accessed: '2024-01-04T00:00:00Z',
      pinned: false,
      tags: null
    }
  ];

  beforeEach(() => {
    // Reset singleton instance
    resetVectorSearchEngine();
    
    // Create in-memory database for testing
    db = new Database(':memory:');
    // Initialize database schema
    db.exec(`
      CREATE TABLE memory_item (
        id TEXT PRIMARY KEY,
        type TEXT CHECK (type IN ('working','episodic','semantic','procedural')),
        content TEXT NOT NULL,
        importance REAL CHECK (importance >= 0 AND importance <= 1) DEFAULT 0.5,
        privacy_scope TEXT CHECK (privacy_scope IN ('private','team','public')) DEFAULT 'private',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_accessed TIMESTAMP,
        pinned BOOLEAN DEFAULT FALSE,
        tags TEXT,
        source TEXT,
        agent_id TEXT,
        user_id TEXT,
        project_id TEXT,
        origin_trace TEXT
      );
      
      -- VSS 테이블은 Mock에서 처리하므로 실제 생성하지 않음
      CREATE TABLE memory_item_vss (
        rowid INTEGER PRIMARY KEY,
        embedding TEXT
      );
      
      -- FTS 테이블도 Mock에서 처리
      CREATE VIRTUAL TABLE memory_item_fts USING fts5(
        content,
        tags,
        source
      );
    `);
    
    vectorSearchEngine = getVectorSearchEngine();
    vectorSearchEngine.initialize(db);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    vi.clearAllMocks();
  });

  describe('초기화', () => {
    it('should initialize successfully', () => {
      expect(() => vectorSearchEngine.initialize(db)).not.toThrow();
    });

    it('should check VSS availability', () => {
      const status = vectorSearchEngine.getIndexStatus();
      expect(status).toHaveProperty('available');
      expect(status).toHaveProperty('tableExists');
      expect(status).toHaveProperty('recordCount');
      expect(status).toHaveProperty('dimensions');
      expect(status).toHaveProperty('vssExtensionLoaded');
      expect(typeof status.available).toBe('boolean');
      expect(typeof status.tableExists).toBe('boolean');
      expect(typeof status.recordCount).toBe('number');
      expect(typeof status.dimensions).toBe('number');
      expect(typeof status.vssExtensionLoaded).toBe('boolean');
    });

    it('should return correct dimensions', () => {
      const status = vectorSearchEngine.getIndexStatus();
      expect(status.dimensions).toBe(1536);
    });

    it('should return correct table status', () => {
      const status = vectorSearchEngine.getIndexStatus();
      expect(status.tableExists).toBe(true);
      expect(status.recordCount).toBe(0);
    });
  });

  describe('벡터 검색', () => {
    beforeEach(() => {
      // Setup mock VSS search results
      mockVssSearch.mockReturnValue(0.95);
    });

    it('should return empty array when not initialized', async () => {
      const newEngine = new VectorSearchEngine();
      const results = await newEngine.search(testQueryVector);
      expect(results).toEqual([]);
    });

    it('should return empty array when VSS not available', async () => {
      // Mock VSS not available
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue(null)
        })
      };
      
      const newEngine = new VectorSearchEngine();
      newEngine.initialize(mockDb as any);
      
      const results = await newEngine.search(testQueryVector);
      expect(results).toEqual([]);
    });

    it('should perform basic vector search', async () => {
      // Mock database query results
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue(mockSearchResults)
      });
      
      const mockDb = {
        prepare: vi.fn().mockReturnValue(mockQuery)
      };
      
      const newEngine = new VectorSearchEngine();
      newEngine.initialize(mockDb as any);
      
      // Mock VSS availability
      vi.spyOn(newEngine as any, 'checkVSSAvailability').mockImplementation(() => {
        (newEngine as any).isVSSAvailable = true;
        (newEngine as any).vssExtensionLoaded = true;
      });
      
      const results = await newEngine.search(testQueryVector);
      
      expect(mockQuery).toHaveBeenCalled();
      expect(results).toHaveLength(3);
      expect(results[0]).toHaveProperty('memory_id');
      expect(results[0]).toHaveProperty('similarity');
    });

    it('should apply similarity threshold', async () => {
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue(mockSearchResults)
      });
      
      const mockDb = {
        prepare: vi.fn().mockReturnValue(mockQuery)
      };
      
      const newEngine = new VectorSearchEngine();
      newEngine.initialize(mockDb as any);
      
      // Mock VSS availability
      vi.spyOn(newEngine as any, 'checkVSSAvailability').mockImplementation(() => {
        (newEngine as any).isVSSAvailable = true;
        (newEngine as any).vssExtensionLoaded = true;
      });
      
      const results = await newEngine.search(testQueryVector, { threshold: 0.8 });
      
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('vss_search'),
        expect.any(String),
        expect.any(Number)
      );
    });

    it('should apply limit', async () => {
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue(mockSearchResults)
      });
      
      const mockDb = {
        prepare: vi.fn().mockReturnValue(mockQuery)
      };
      
      const newEngine = new VectorSearchEngine();
      newEngine.initialize(mockDb as any);
      
      // Mock VSS availability
      vi.spyOn(newEngine as any, 'checkVSSAvailability').mockImplementation(() => {
        (newEngine as any).isVSSAvailable = true;
        (newEngine as any).vssExtensionLoaded = true;
      });
      
      const results = await newEngine.search(testQueryVector, { limit: 5 });
      
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT ?'),
        expect.any(String),
        expect.any(Number),
        5
      );
    });

    it('should filter by type', async () => {
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue(mockSearchResults)
      });
      
      const mockDb = {
        prepare: vi.fn().mockReturnValue(mockQuery)
      };
      
      const newEngine = new VectorSearchEngine();
      newEngine.initialize(mockDb as any);
      
      // Mock VSS availability
      vi.spyOn(newEngine as any, 'checkVSSAvailability').mockImplementation(() => {
        (newEngine as any).isVSSAvailable = true;
        (newEngine as any).vssExtensionLoaded = true;
      });
      
      const results = await newEngine.search(testQueryVector, { 
        type: 'episodic'
      });
      
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('AND mi.type = ?'),
        expect.any(String),
        'episodic',
        expect.any(Number)
      );
    });

    it('should include content when requested', async () => {
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue([
          { 
            memory_id: 'test1', 
            similarity: 0.95, 
            content: 'Test content 1', 
            type: 'episodic', 
            importance: 0.5, 
            created_at: '2024-01-01',
            last_accessed: '2024-01-02',
            pinned: false,
            tags: '["test"]'
          }
        ])
      });
      
      const mockDb = {
        prepare: vi.fn().mockReturnValue(mockQuery)
      };
      
      const newEngine = new VectorSearchEngine();
      newEngine.initialize(mockDb as any);
      
      // Mock VSS availability
      vi.spyOn(newEngine as any, 'checkVSSAvailability').mockImplementation(() => {
        (newEngine as any).isVSSAvailable = true;
        (newEngine as any).vssExtensionLoaded = true;
      });
      
      const results = await newEngine.search(testQueryVector, { 
        includeContent: true,
        includeMetadata: true
      });
      
      expect(results[0]).toHaveProperty('content');
      expect(results[0]).toHaveProperty('type');
      expect(results[0]).toHaveProperty('importance');
      expect(results[0]).toHaveProperty('created_at');
      expect(results[0]).toHaveProperty('last_accessed');
      expect(results[0]).toHaveProperty('pinned');
      expect(results[0]).toHaveProperty('tags');
    });

    it('should handle empty search results', async () => {
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue([])
      });
      
      const mockDb = {
        prepare: vi.fn().mockReturnValue(mockQuery)
      };
      
      const newEngine = new VectorSearchEngine();
      newEngine.initialize(mockDb as any);
      
      // Mock VSS availability
      vi.spyOn(newEngine as any, 'checkVSSAvailability').mockImplementation(() => {
        (newEngine as any).isVSSAvailable = true;
        (newEngine as any).vssExtensionLoaded = true;
      });
      
      const results = await newEngine.search(testQueryVector);
      expect(results).toEqual([]);
    });

    it('should handle database errors gracefully', async () => {
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn().mockImplementation(() => {
          throw new Error('Database error');
        })
      });
      
      const mockDb = {
        prepare: vi.fn().mockReturnValue(mockQuery)
      };
      
      const newEngine = new VectorSearchEngine();
      newEngine.initialize(mockDb as any);
      
      // Mock VSS availability
      vi.spyOn(newEngine as any, 'checkVSSAvailability').mockImplementation(() => {
        (newEngine as any).isVSSAvailable = true;
        (newEngine as any).vssExtensionLoaded = true;
      });
      
      const results = await newEngine.search(testQueryVector);
      expect(results).toEqual([]);
    });

    it('should validate vector dimensions', async () => {
      const invalidVector = new Array(100).fill(0.1); // Wrong dimensions
      
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          all: vi.fn().mockReturnValue([])
        })
      };
      
      const newEngine = new VectorSearchEngine();
      newEngine.initialize(mockDb as any);
      
      // Mock VSS availability
      vi.spyOn(newEngine as any, 'checkVSSAvailability').mockImplementation(() => {
        (newEngine as any).isVSSAvailable = true;
        (newEngine as any).vssExtensionLoaded = true;
      });
      
      const results = await newEngine.search(invalidVector);
      expect(results).toEqual([]);
    });
  });

  describe('기본값 처리', () => {
    it('should use default options when none provided', async () => {
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue([])
      });
      
      const mockDb = {
        prepare: vi.fn().mockReturnValue(mockQuery)
      };
      
      const newEngine = new VectorSearchEngine();
      newEngine.initialize(mockDb as any);
      
      // Mock VSS availability
      vi.spyOn(newEngine as any, 'checkVSSAvailability').mockImplementation(() => {
        (newEngine as any).isVSSAvailable = true;
        (newEngine as any).vssExtensionLoaded = true;
      });
      
      await newEngine.search(testQueryVector);
      
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT ?'),
        expect.any(String),
        10   // default limit
      );
    });
  });

  describe('JSON 직렬화', () => {
    it('should serialize query vector to JSON', async () => {
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue([])
      });
      
      const mockDb = {
        prepare: vi.fn().mockReturnValue(mockQuery)
      };
      
      const newEngine = new VectorSearchEngine();
      newEngine.initialize(mockDb as any);
      
      // Mock VSS availability
      vi.spyOn(newEngine as any, 'checkVSSAvailability').mockImplementation(() => {
        (newEngine as any).isVSSAvailable = true;
        (newEngine as any).vssExtensionLoaded = true;
      });
      
      await newEngine.search(testQueryVector);
      
      const callArgs = mockQuery.mock.calls[0];
      const queryVectorJson = callArgs[0];
      expect(queryVectorJson).toBe(JSON.stringify(testQueryVector));
    });
  });

  describe('하이브리드 검색', () => {
    const mockHybridResults = [
      { 
        memory_id: 'test1', 
        vector_similarity: 0.9, 
        text_similarity: 0.8, 
        content: 'Test content 1', 
        type: 'episodic', 
        importance: 0.5, 
        created_at: '2024-01-01',
        last_accessed: '2024-01-02',
        pinned: false,
        tags: '["test"]'
      },
      { 
        memory_id: 'test2', 
        vector_similarity: 0.7, 
        text_similarity: 0.9, 
        content: 'Test content 2', 
        type: 'semantic', 
        importance: 0.7, 
        created_at: '2024-01-02',
        last_accessed: '2024-01-03',
        pinned: true,
        tags: '["demo"]'
      }
    ];

    it('should perform hybrid search successfully', async () => {
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue(mockHybridResults)
      });
      
      const mockDb = {
        prepare: vi.fn().mockReturnValue(mockQuery)
      };
      
      const newEngine = new VectorSearchEngine();
      newEngine.initialize(mockDb as any);
      
      // Mock VSS availability
      vi.spyOn(newEngine as any, 'checkVSSAvailability').mockImplementation(() => {
        (newEngine as any).isVSSAvailable = true;
        (newEngine as any).vssExtensionLoaded = true;
      });
      
      const results = await newEngine.hybridSearch(testQueryVector, testTextQuery);
      
      expect(mockQuery).toHaveBeenCalled();
      expect(results).toHaveLength(2);
      expect(results[0]).toHaveProperty('memory_id');
      expect(results[0]).toHaveProperty('similarity');
      expect(results[0].similarity).toBe(0.9 * 0.6 + 0.8 * 0.4); // 벡터 60% + 텍스트 40%
    });

    it('should return empty array when VSS not available', async () => {
      const newEngine = new VectorSearchEngine();
      const results = await newEngine.hybridSearch(testQueryVector, testTextQuery);
      expect(results).toEqual([]);
    });

    it('should apply type filter in hybrid search', async () => {
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue(mockHybridResults)
      });
      
      const mockDb = {
        prepare: vi.fn().mockReturnValue(mockQuery)
      };
      
      const newEngine = new VectorSearchEngine();
      newEngine.initialize(mockDb as any);
      
      // Mock VSS availability
      vi.spyOn(newEngine as any, 'checkVSSAvailability').mockImplementation(() => {
        (newEngine as any).isVSSAvailable = true;
        (newEngine as any).vssExtensionLoaded = true;
      });
      
      await newEngine.hybridSearch(testQueryVector, testTextQuery, { type: 'episodic' });
      
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('AND mi.type = ?'),
        expect.any(String),
        'episodic',
        testTextQuery,
        'episodic',
        expect.any(Number)
      );
    });
  });

  describe('인덱스 재구성', () => {
    it('should rebuild index successfully', async () => {
      const mockQuery = vi.fn().mockReturnValue({ run: vi.fn() });
      
      const mockDb = {
        prepare: vi.fn().mockReturnValue(mockQuery)
      };
      
      const newEngine = new VectorSearchEngine();
      newEngine.initialize(mockDb as any);
      
      // Mock VSS availability
      vi.spyOn(newEngine as any, 'checkVSSAvailability').mockImplementation(() => {
        (newEngine as any).isVSSAvailable = true;
        (newEngine as any).vssExtensionLoaded = true;
      });
      
      const result = await newEngine.rebuildIndex();
      
      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        'INSERT INTO memory_item_vss(memory_item_vss) VALUES("rebuild")'
      );
    });

    it('should return false when VSS not available', async () => {
      const newEngine = new VectorSearchEngine();
      const result = await newEngine.rebuildIndex();
      expect(result).toBe(false);
    });

    it('should handle rebuild errors gracefully', async () => {
      const mockQuery = vi.fn().mockReturnValue({
        run: vi.fn().mockImplementation(() => {
          throw new Error('Rebuild failed');
        })
      });
      
      const mockDb = {
        prepare: vi.fn().mockReturnValue(mockQuery)
      };
      
      const newEngine = new VectorSearchEngine();
      newEngine.initialize(mockDb as any);
      
      // Mock VSS availability
      vi.spyOn(newEngine as any, 'checkVSSAvailability').mockImplementation(() => {
        (newEngine as any).isVSSAvailable = true;
        (newEngine as any).vssExtensionLoaded = true;
      });
      
      const result = await newEngine.rebuildIndex();
      expect(result).toBe(false);
    });
  });

  describe('성능 테스트', () => {
    it('should perform performance test successfully', async () => {
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue(mockSearchResults)
      });
      
      const mockDb = {
        prepare: vi.fn().mockReturnValue(mockQuery)
      };
      
      const newEngine = new VectorSearchEngine();
      newEngine.initialize(mockDb as any);
      
      // Mock VSS availability
      vi.spyOn(newEngine as any, 'checkVSSAvailability').mockImplementation(() => {
        (newEngine as any).isVSSAvailable = true;
        (newEngine as any).vssExtensionLoaded = true;
      });
      
      const result = await newEngine.performanceTest(testQueryVector, 3);
      
      expect(result).toHaveProperty('averageTime');
      expect(result).toHaveProperty('minTime');
      expect(result).toHaveProperty('maxTime');
      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('successRate');
      expect(result.results).toBe(3);
      expect(result.averageTime).toBeGreaterThan(0);
      expect(result.successRate).toBe(1.0);
    });

    it('should return zero values when VSS not available', async () => {
      const newEngine = new VectorSearchEngine();
      const result = await newEngine.performanceTest(testQueryVector, 3);
      
      expect(result.averageTime).toBe(0);
      expect(result.minTime).toBe(0);
      expect(result.maxTime).toBe(0);
      expect(result.results).toBe(0);
      expect(result.successRate).toBe(0);
    });

    it('should handle performance test with different iterations', async () => {
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue(mockSearchResults)
      });
      
      const mockDb = {
        prepare: vi.fn().mockReturnValue(mockQuery)
      };
      
      const newEngine = new VectorSearchEngine();
      newEngine.initialize(mockDb as any);
      
      // Mock VSS availability
      vi.spyOn(newEngine as any, 'checkVSSAvailability').mockImplementation(() => {
        (newEngine as any).isVSSAvailable = true;
        (newEngine as any).vssExtensionLoaded = true;
      });
      
      const result = await newEngine.performanceTest(testQueryVector, 5);
      
      expect(result.averageTime).toBeGreaterThan(0);
      expect(result.minTime).toBeGreaterThan(0);
      expect(result.maxTime).toBeGreaterThan(0);
      expect(result.successRate).toBe(1.0);
    });
  });

  describe('유틸리티 메서드', () => {
    it('should return correct dimensions', () => {
      expect(vectorSearchEngine.getDimensions()).toBe(1536);
    });

    it('should check availability', () => {
      const isAvailable = vectorSearchEngine.isAvailable();
      expect(typeof isAvailable).toBe('boolean');
    });

    it('should check connection status', () => {
      const isConnected = vectorSearchEngine.isConnected();
      expect(typeof isConnected).toBe('boolean');
    });
  });

  describe('싱글톤 패턴', () => {
    it('should return same instance', () => {
      const instance1 = getVectorSearchEngine();
      const instance2 = getVectorSearchEngine();
      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = getVectorSearchEngine();
      resetVectorSearchEngine();
      const instance2 = getVectorSearchEngine();
      expect(instance1).not.toBe(instance2);
    });

    it('should create independent instances', () => {
      const instance1 = new VectorSearchEngine();
      const instance2 = new VectorSearchEngine();
      expect(instance1).not.toBe(instance2);
    });
  });
});