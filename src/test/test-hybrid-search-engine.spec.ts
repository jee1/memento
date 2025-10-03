import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HybridSearchEngine } from '../algorithms/hybrid-search-engine.js';
import { SearchEngine } from '../algorithms/search-engine.js';
import { MemoryEmbeddingService } from '../services/memory-embedding-service.js';
import { getVectorSearchEngine } from '../algorithms/vector-search-engine.js';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../utils/database.js';

// Mock dependencies
vi.mock('../algorithms/search-engine.js');
vi.mock('../services/memory-embedding-service.js');
vi.mock('../algorithms/vector-search-engine.js');

describe('HybridSearchEngine', () => {
  let db: Database.Database;
  let hybridSearchEngine: HybridSearchEngine;
  let mockSearchEngine: any;
  let mockEmbeddingService: any;
  let mockVectorSearchEngine: any;

  beforeEach(() => {
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
        source TEXT,
        agent_id TEXT,
        user_id TEXT,
        project_id TEXT,
        origin_trace TEXT
      );
      
      CREATE VIRTUAL TABLE memory_item_fts USING fts5(
        content,
        content='memory_item',
        content_rowid='rowid'
      );
      
      CREATE VIRTUAL TABLE memory_item_vec USING vec0(
        embedding float[1536]
      );
    `);

    // Mock search engine
    mockSearchEngine = {
      search: vi.fn()
    };
    vi.mocked(SearchEngine).mockImplementation(() => mockSearchEngine);

    // Mock embedding service
    mockEmbeddingService = {
      isAvailable: vi.fn().mockReturnValue(true),
      generateEmbedding: vi.fn().mockResolvedValue(Array(1536).fill(0.1)),
      searchBySimilarity: vi.fn().mockResolvedValue([]),
      getEmbeddingStats: vi.fn().mockResolvedValue({})
    };
    vi.mocked(MemoryEmbeddingService).mockImplementation(() => mockEmbeddingService);

    // Mock vector search engine
    mockVectorSearchEngine = {
      initialize: vi.fn(),
      getIndexStatus: vi.fn().mockReturnValue({ available: true, tableExists: true, recordCount: 0 }),
      search: vi.fn().mockResolvedValue([])
    };
    vi.mocked(getVectorSearchEngine).mockReturnValue(mockVectorSearchEngine);

    hybridSearchEngine = new HybridSearchEngine();
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    vi.clearAllMocks();
  });

  describe('초기화', () => {
    it('should initialize with correct default weights', () => {
      expect(hybridSearchEngine).toBeDefined();
    });

    it('should have correct default vector and text weights', () => {
      // Access private properties for testing
      const defaultVectorWeight = (hybridSearchEngine as any).defaultVectorWeight;
      const defaultTextWeight = (hybridSearchEngine as any).defaultTextWeight;
      
      expect(defaultVectorWeight).toBe(0.6);
      expect(defaultTextWeight).toBe(0.4);
    });
  });

  describe('기본 검색', () => {
    it('should perform hybrid search successfully', async () => {
      const mockTextResults = {
        items: [
          {
            id: 'test1',
            content: 'Test memory 1',
            type: 'episodic',
            importance: 0.5,
            created_at: '2024-01-01',
            score: 0.8,
            recall_reason: '텍스트 검색 결과'
          }
        ],
        total_count: 1,
        query_time: 10
      };

      const mockVectorResults = [
        {
          memory_id: 'test1',
          similarity: 0.9,
          content: 'Test memory 1',
          type: 'episodic',
          importance: 0.5,
          created_at: '2024-01-01'
        }
      ];

      mockSearchEngine.search.mockResolvedValue(mockTextResults);
      mockVectorSearchEngine.search.mockResolvedValue(mockVectorResults);

      const result = await hybridSearchEngine.search(db, {
        query: 'test query',
        limit: 10
      });

      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('total_count');
      expect(result).toHaveProperty('query_time');
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toHaveProperty('textScore');
      expect(result.items[0]).toHaveProperty('vectorScore');
      expect(result.items[0]).toHaveProperty('finalScore');
    });

    it('should handle empty search results', async () => {
      mockSearchEngine.search.mockResolvedValue({ items: [], total_count: 0, query_time: 5 });
      mockVectorSearchEngine.search.mockResolvedValue([]);

      const result = await hybridSearchEngine.search(db, {
        query: 'nonexistent query',
        limit: 10
      });

      expect(result.items).toHaveLength(0);
      expect(result.total_count).toBe(0);
    });

    it('should use custom weights when provided', async () => {
      const mockTextResults = { items: [], total_count: 0, query_time: 5 };
      const mockVectorResults: any[] = [];

      mockSearchEngine.search.mockResolvedValue(mockTextResults);
      mockVectorSearchEngine.search.mockResolvedValue(mockVectorResults);

      await hybridSearchEngine.search(db, {
        query: 'test query',
        vectorWeight: 0.8,
        textWeight: 0.2,
        limit: 10
      });

      // Should call with custom weights
      expect(mockSearchEngine.search).toHaveBeenCalled();
    });
  });

  describe('적응형 가중치', () => {
    it('should adjust weights for technical terms', async () => {
      const mockTextResults = { items: [], total_count: 0, query_time: 5 };
      const mockVectorResults: any[] = [];

      mockSearchEngine.search.mockResolvedValue(mockTextResults);
      mockVectorSearchEngine.search.mockResolvedValue(mockVectorResults);

      await hybridSearchEngine.search(db, {
        query: 'API',
        limit: 10
      });

      // Technical terms should favor vector search
      expect(mockVectorSearchEngine.search).toHaveBeenCalled();
    });

    it('should adjust weights for phrase queries', async () => {
      const mockTextResults = { items: [], total_count: 0, query_time: 5 };
      const mockVectorResults: any[] = [];

      mockSearchEngine.search.mockResolvedValue(mockTextResults);
      mockVectorSearchEngine.search.mockResolvedValue(mockVectorResults);

      await hybridSearchEngine.search(db, {
        query: 'how to implement authentication',
        limit: 10
      });

      // Phrase queries should favor text search
      expect(mockSearchEngine.search).toHaveBeenCalled();
    });

    it('should adjust weights for short queries', async () => {
      const mockTextResults = { items: [], total_count: 0, query_time: 5 };
      const mockVectorResults: any[] = [];

      mockSearchEngine.search.mockResolvedValue(mockTextResults);
      mockVectorSearchEngine.search.mockResolvedValue(mockVectorResults);

      await hybridSearchEngine.search(db, {
        query: 'test',
        limit: 10
      });

      // Short queries should favor vector search
      expect(mockVectorSearchEngine.search).toHaveBeenCalled();
    });
  });

  describe('결과 결합', () => {
    it('should combine text and vector results correctly', async () => {
      const mockTextResults = {
        items: [
          {
            id: 'test1',
            content: 'Test memory 1',
            type: 'episodic',
            importance: 0.5,
            created_at: '2024-01-01',
            score: 0.8,
            recall_reason: '텍스트 검색 결과'
          }
        ],
        total_count: 1,
        query_time: 10
      };

      const mockVectorResults = [
        {
          memory_id: 'test1',
          similarity: 0.9,
          content: 'Test memory 1',
          type: 'episodic',
          importance: 0.5,
          created_at: '2024-01-01'
        }
      ];

      mockSearchEngine.search.mockResolvedValue(mockTextResults);
      mockVectorSearchEngine.search.mockResolvedValue(mockVectorResults);

      const result = await hybridSearchEngine.search(db, {
        query: 'test query',
        limit: 10
      });

      expect(result.items[0].textScore).toBe(0.8);
      expect(result.items[0].vectorScore).toBe(0.9);
      expect(result.items[0].finalScore).toBe(0.8 * 0.4 + 0.9 * 0.6); // textWeight * textScore + vectorWeight * vectorScore
    });

    it('should handle text-only results', async () => {
      const mockTextResults = {
        items: [
          {
            id: 'test1',
            content: 'Test memory 1',
            type: 'episodic',
            importance: 0.5,
            created_at: '2024-01-01',
            score: 0.8,
            recall_reason: '텍스트 검색 결과'
          }
        ],
        total_count: 1,
        query_time: 10
      };

      mockSearchEngine.search.mockResolvedValue(mockTextResults);
      mockVectorSearchEngine.search.mockResolvedValue([]);

      const result = await hybridSearchEngine.search(db, {
        query: 'test query',
        limit: 10
      });

      expect(result.items[0].textScore).toBe(0.8);
      expect(result.items[0].vectorScore).toBe(0);
      expect(result.items[0].finalScore).toBe(0.8 * 0.4); // Only text score
    });

    it('should handle vector-only results', async () => {
      const mockTextResults = { items: [], total_count: 0, query_time: 5 };
      const mockVectorResults = [
        {
          memory_id: 'test1',
          similarity: 0.9,
          content: 'Test memory 1',
          type: 'episodic',
          importance: 0.5,
          created_at: '2024-01-01'
        }
      ];

      mockSearchEngine.search.mockResolvedValue(mockTextResults);
      mockVectorSearchEngine.search.mockResolvedValue(mockVectorResults);

      const result = await hybridSearchEngine.search(db, {
        query: 'test query',
        limit: 10
      });

      expect(result.items[0].textScore).toBe(0);
      expect(result.items[0].vectorScore).toBe(0.9);
      expect(result.items[0].finalScore).toBe(0.9 * 0.6); // Only vector score
    });
  });

  describe('하이브리드 검색 이유 생성', () => {
    it('should generate correct hybrid reason for combined results', async () => {
      const mockTextResults = {
        items: [
          {
            id: 'test1',
            content: 'Test memory 1',
            type: 'episodic',
            importance: 0.5,
            created_at: '2024-01-01',
            score: 0.8,
            recall_reason: '텍스트 검색 결과'
          }
        ],
        total_count: 1,
        query_time: 10
      };

      const mockVectorResults = [
        {
          memory_id: 'test1',
          similarity: 0.9,
          content: 'Test memory 1',
          type: 'episodic',
          importance: 0.5,
          created_at: '2024-01-01'
        }
      ];

      mockSearchEngine.search.mockResolvedValue(mockTextResults);
      mockVectorSearchEngine.search.mockResolvedValue(mockVectorResults);

      const result = await hybridSearchEngine.search(db, {
        query: 'test query',
        limit: 10
      });

      expect(result.items[0].recall_reason).toContain('텍스트 매칭 우수');
      expect(result.items[0].recall_reason).toContain('의미적 유사도 높음');
      expect(result.items[0].recall_reason).toContain('텍스트+벡터 결합');
    });
  });

  describe('VSS Fallback', () => {
    it('should fallback to embedding service when VSS not available', async () => {
      mockVectorSearchEngine.getIndexStatus.mockReturnValue({ available: false, tableExists: false, recordCount: 0 });
      mockEmbeddingService.searchBySimilarity.mockResolvedValue([
        {
          memory_id: 'test1',
          similarity: 0.8,
          content: 'Test memory 1',
          type: 'episodic',
          importance: 0.5,
          created_at: '2024-01-01'
        }
      ]);

      const mockTextResults = { items: [], total_count: 0, query_time: 5 };
      mockSearchEngine.search.mockResolvedValue(mockTextResults);

      const result = await hybridSearchEngine.search(db, {
        query: 'test query',
        limit: 10
      });

      expect(mockEmbeddingService.searchBySimilarity).toHaveBeenCalled();
      expect(result.items).toHaveLength(1);
    });

    it('should handle embedding service unavailability', async () => {
      mockVectorSearchEngine.getIndexStatus.mockReturnValue({ available: false, tableExists: false, recordCount: 0 });
      mockEmbeddingService.isAvailable.mockReturnValue(false);

      const mockTextResults = {
        items: [
          {
            id: 'test1',
            content: 'Test memory 1',
            type: 'episodic',
            importance: 0.5,
            created_at: '2024-01-01',
            score: 0.8,
            recall_reason: '텍스트 검색 결과'
          }
        ],
        total_count: 1,
        query_time: 10
      };
      mockSearchEngine.search.mockResolvedValue(mockTextResults);

      const result = await hybridSearchEngine.search(db, {
        query: 'test query',
        limit: 10
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].vectorScore).toBe(0);
    });
  });

  describe('검색 통계', () => {
    it('should update search statistics', async () => {
      const mockTextResults = { items: [], total_count: 0, query_time: 5 };
      const mockVectorResults: any[] = [];

      mockSearchEngine.search.mockResolvedValue(mockTextResults);
      mockVectorSearchEngine.search.mockResolvedValue(mockVectorResults);

      await hybridSearchEngine.search(db, {
        query: 'test query',
        limit: 10
      });

      const stats = await hybridSearchEngine.getSearchStats(db);
      expect(stats.searchStats).toBeDefined();
      expect(stats.adaptiveWeights).toBeDefined();
    });

    it('should track search performance', async () => {
      const mockTextResults = { items: [], total_count: 0, query_time: 5 };
      const mockVectorResults: any[] = [];

      mockSearchEngine.search.mockResolvedValue(mockTextResults);
      mockVectorSearchEngine.search.mockResolvedValue(mockVectorResults);

      // Perform multiple searches
      await hybridSearchEngine.search(db, { query: 'query1', limit: 10 });
      await hybridSearchEngine.search(db, { query: 'query2', limit: 10 });

      const stats = await hybridSearchEngine.getSearchStats(db);
      expect(stats.searchStats.size).toBeGreaterThan(0);
    });
  });

  describe('에러 처리', () => {
    it('should handle search engine errors', async () => {
      mockSearchEngine.search.mockRejectedValue(new Error('Search failed'));

      await expect(hybridSearchEngine.search(db, {
        query: 'test query',
        limit: 10
      })).rejects.toThrow('Search failed');
    });

    it('should handle vector search errors gracefully', async () => {
      const mockTextResults = { items: [], total_count: 0, query_time: 5 };
      mockSearchEngine.search.mockResolvedValue(mockTextResults);
      mockVectorSearchEngine.search.mockRejectedValue(new Error('Vector search failed'));

      const result = await hybridSearchEngine.search(db, {
        query: 'test query',
        limit: 10
      });

      // Should still return results from text search
      expect(result.items).toHaveLength(0);
    });
  });

  describe('필터링', () => {
    it('should apply type filters correctly', async () => {
      const mockTextResults = { items: [], total_count: 0, query_time: 5 };
      const mockVectorResults: any[] = [];

      mockSearchEngine.search.mockResolvedValue(mockTextResults);
      mockVectorSearchEngine.search.mockResolvedValue(mockVectorResults);

      await hybridSearchEngine.search(db, {
        query: 'test query',
        filters: {
          type: ['episodic', 'semantic']
        },
        limit: 10
      });

      expect(mockSearchEngine.search).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          filters: expect.objectContaining({
            type: ['episodic', 'semantic']
          })
        })
      );
    });
  });

  describe('임베딩 서비스 가용성', () => {
    it('should check embedding service availability', () => {
      const isAvailable = hybridSearchEngine.isEmbeddingAvailable();
      expect(isAvailable).toBe(true);
    });
  });
});

