import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getVectorSearchEngine, VectorSearchEngine } from '../algorithms/vector-search-engine.js';
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
    }
  };
});

describe('VectorSearchEngine', () => {
  let db: Database.Database;
  let vectorSearchEngine: VectorSearchEngine;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(':memory:');
    DatabaseUtils.initializeDatabase(db);
    
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
      expect(status).toHaveProperty('dimensions');
      expect(typeof status.available).toBe('boolean');
      expect(typeof status.dimensions).toBe('number');
    });
  });

  describe('인덱스 상태', () => {
    it('should return correct dimensions', () => {
      const status = vectorSearchEngine.getIndexStatus();
      expect(status.dimensions).toBe(1536); // Default embedding dimensions
    });
  });

  describe('벡터 검색', () => {
    const testQueryVector = Array(1536).fill(0.1);
    const mockSearchResults = [
      { memory_id: 'test1', similarity: 0.95 },
      { memory_id: 'test2', similarity: 0.87 },
      { memory_id: 'test3', similarity: 0.76 }
    ];

    beforeEach(() => {
      // Setup mock VSS search results
      mockVssSearchRbf.mockReturnValue(0.95);
      mockVssSearch.mockReturnValue(0.95);
    });

    it('should return empty array when not initialized', async () => {
      const newEngine = getVectorSearchEngine();
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
      
      const newEngine = getVectorSearchEngine();
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
      
      const newEngine = getVectorSearchEngine();
      newEngine.initialize(mockDb as any);
      
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
      
      const newEngine = getVectorSearchEngine();
      newEngine.initialize(mockDb as any);
      
      const results = await newEngine.search(testQueryVector, { threshold: 0.8 });
      
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE similarity >= ?'),
        expect.any(String),
        0.8,
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
      
      const newEngine = getVectorSearchEngine();
      newEngine.initialize(mockDb as any);
      
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
      
      const newEngine = getVectorSearchEngine();
      newEngine.initialize(mockDb as any);
      
      const results = await newEngine.search(testQueryVector, { 
        type: ['episodic', 'semantic'] 
      });
      
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('AND vss.rowid IN'),
        expect.any(String),
        expect.any(Number),
        'episodic',
        'semantic',
        expect.any(Number)
      );
    });

    it('should include content when requested', async () => {
      const mockSearchQuery = vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue(mockSearchResults)
      });
      
      const mockContentQuery = vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue([
          { id: 'test1', content: 'Test content 1', type: 'episodic', importance: 0.5, created_at: '2024-01-01' },
          { id: 'test2', content: 'Test content 2', type: 'semantic', importance: 0.7, created_at: '2024-01-02' }
        ])
      });
      
      const mockDb = {
        prepare: vi.fn()
          .mockReturnValueOnce(mockSearchQuery)
          .mockReturnValueOnce(mockContentQuery)
      };
      
      const newEngine = getVectorSearchEngine();
      newEngine.initialize(mockDb as any);
      
      const results = await newEngine.search(testQueryVector, { 
        includeContent: true 
      });
      
      expect(results[0]).toHaveProperty('content');
      expect(results[0]).toHaveProperty('type');
      expect(results[0]).toHaveProperty('importance');
      expect(results[0]).toHaveProperty('created_at');
    });

    it('should handle empty search results', async () => {
      const mockQuery = vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue([])
      });
      
      const mockDb = {
        prepare: vi.fn().mockReturnValue(mockQuery)
      };
      
      const newEngine = getVectorSearchEngine();
      newEngine.initialize(mockDb as any);
      
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
      
      const newEngine = getVectorSearchEngine();
      newEngine.initialize(mockDb as any);
      
      const results = await newEngine.search(testQueryVector);
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
      
      const newEngine = getVectorSearchEngine();
      newEngine.initialize(mockDb as any);
      
      await newEngine.search(testQueryVector);
      
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT ?'),
        expect.any(String),
        0.7, // default threshold
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
      
      const newEngine = getVectorSearchEngine();
      newEngine.initialize(mockDb as any);
      
      await newEngine.search(testQueryVector);
      
      const callArgs = mockQuery.mock.calls[0];
      const queryVectorJson = callArgs[0];
      expect(queryVectorJson).toBe(JSON.stringify(testQueryVector));
    });
  });
});
