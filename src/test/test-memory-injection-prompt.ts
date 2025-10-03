import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryInjectionPrompt } from '../tools/memory-injection-prompt.js';
import { getHybridSearchEngine } from '../algorithms/hybrid-search-engine.js';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../utils/database.js';

// Mock hybrid search engine
vi.mock('../algorithms/hybrid-search-engine.js');

describe('MemoryInjectionPrompt', () => {
  let db: Database.Database;
  let memoryInjectionPrompt: MemoryInjectionPrompt;
  let mockHybridSearchEngine: any;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(':memory:');
    DatabaseUtils.initializeDatabase(db);
    
    memoryInjectionPrompt = new MemoryInjectionPrompt();
    
    // Mock hybrid search engine
    mockHybridSearchEngine = {
      search: vi.fn()
    };
    
    vi.mocked(getHybridSearchEngine).mockReturnValue(mockHybridSearchEngine);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    vi.clearAllMocks();
  });

  describe('초기화', () => {
    it('should initialize with correct name and description', () => {
      expect(memoryInjectionPrompt.name).toBe('memory_injection');
      expect(memoryInjectionPrompt.description).toBe('관련 기억을 요약하여 프롬프트에 주입');
    });

    it('should have correct input schema', () => {
      const schema = memoryInjectionPrompt.inputSchema;
      expect(schema.shape.query).toBeDefined();
      expect(schema.shape.token_budget).toBeDefined();
      expect(schema.shape.max_memories).toBeDefined();
    });

    it('should have correct output schema', () => {
      const schema = memoryInjectionPrompt.outputSchema;
      expect(schema.element.shape.role).toBeDefined();
      expect(schema.element.shape.content).toBeDefined();
    });
  });

  describe('기본 실행', () => {
    it('should execute successfully with valid parameters', async () => {
      const mockSearchResults = {
        items: [
          {
            id: 'test1',
            content: 'Test memory 1',
            type: 'episodic',
            importance: 0.5,
            created_at: '2024-01-01'
          },
          {
            id: 'test2',
            content: 'Test memory 2',
            type: 'semantic',
            importance: 0.7,
            created_at: '2024-01-02'
          }
        ]
      };

      mockHybridSearchEngine.search.mockResolvedValue(mockSearchResults);

      const result = await memoryInjectionPrompt.execute(
        {
          query: 'test query',
          token_budget: 1000,
          max_memories: 5
        },
        {
          db,
          services: { hybridSearchEngine: mockHybridSearchEngine }
        }
      );

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('system');
      expect(result[0].content).toContain('관련 장기기억 요약');
      expect(result[0].content).toContain('[episodic] Test memory 1');
      expect(result[0].content).toContain('[semantic] Test memory 2');
    });

    it('should handle empty search results', async () => {
      mockHybridSearchEngine.search.mockResolvedValue({ items: [] });

      const result = await memoryInjectionPrompt.execute(
        {
          query: 'test query',
          token_budget: 1000,
          max_memories: 5
        },
        {
          db,
          services: { hybridSearchEngine: mockHybridSearchEngine }
        }
      );

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('system');
      expect(result[0].content).toBe('관련 장기기억을 찾을 수 없습니다.');
    });

    it('should respect token budget', async () => {
      const mockSearchResults = {
        items: [
          {
            id: 'test1',
            content: 'Very long memory content that exceeds token budget when combined with others',
            type: 'episodic',
            importance: 0.5,
            created_at: '2024-01-01'
          },
          {
            id: 'test2',
            content: 'Another long memory content',
            type: 'semantic',
            importance: 0.7,
            created_at: '2024-01-02'
          }
        ]
      };

      mockHybridSearchEngine.search.mockResolvedValue(mockSearchResults);

      const result = await memoryInjectionPrompt.execute(
        {
          query: 'test query',
          token_budget: 50, // Very small budget
          max_memories: 5
        },
        {
          db,
          services: { hybridSearchEngine: mockHybridSearchEngine }
        }
      );

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('system');
      expect(result[0].content).toContain('관련 장기기억 요약');
      // Should only include memories that fit within token budget
    });

    it('should respect max_memories limit', async () => {
      const mockSearchResults = {
        items: Array.from({ length: 10 }, (_, i) => ({
          id: `test${i}`,
          content: `Test memory ${i}`,
          type: 'episodic',
          importance: 0.5,
          created_at: '2024-01-01'
        }))
      };

      mockHybridSearchEngine.search.mockResolvedValue(mockSearchResults);

      const result = await memoryInjectionPrompt.execute(
        {
          query: 'test query',
          token_budget: 1000,
          max_memories: 3
        },
        {
          db,
          services: { hybridSearchEngine: mockHybridSearchEngine }
        }
      );

      expect(mockHybridSearchEngine.search).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          query: 'test query',
          limit: 3
        })
      );
    });
  });

  describe('에러 처리', () => {
    it('should throw error when database not available', async () => {
      await expect(
        memoryInjectionPrompt.execute(
          {
            query: 'test query',
            token_budget: 1000,
            max_memories: 5
          },
          {
            db: null,
            services: { hybridSearchEngine: mockHybridSearchEngine }
          }
        )
      ).rejects.toThrow('Database connection is not available.');
    });

    it('should throw error when hybrid search engine not available', async () => {
      await expect(
        memoryInjectionPrompt.execute(
          {
            query: 'test query',
            token_budget: 1000,
            max_memories: 5
          },
          {
            db,
            services: {}
          }
        )
      ).rejects.toThrow('HybridSearchEngine service is not available.');
    });

    it('should handle search engine errors', async () => {
      mockHybridSearchEngine.search.mockRejectedValue(new Error('Search failed'));

      await expect(
        memoryInjectionPrompt.execute(
          {
            query: 'test query',
            token_budget: 1000,
            max_memories: 5
          },
          {
            db,
            services: { hybridSearchEngine: mockHybridSearchEngine }
          }
        )
      ).rejects.toThrow('Search failed');
    });
  });

  describe('토큰 추정', () => {
    it('should estimate tokens correctly', () => {
      const testText = 'This is a test sentence with multiple words';
      const estimatedTokens = (memoryInjectionPrompt as any).estimateTokens(testText);
      
      // Should be based on word count (whitespace splitting)
      const expectedTokens = testText.split(/\s+/).length;
      expect(estimatedTokens).toBe(expectedTokens);
    });

    it('should handle empty text', () => {
      const estimatedTokens = (memoryInjectionPrompt as any).estimateTokens('');
      expect(estimatedTokens).toBe(0);
    });

    it('should handle text with multiple spaces', () => {
      const testText = 'word1    word2   word3';
      const estimatedTokens = (memoryInjectionPrompt as any).estimateTokens(testText);
      
      // Should split on multiple whitespace characters
      const expectedTokens = testText.split(/\s+/).length;
      expect(estimatedTokens).toBe(expectedTokens);
    });
  });

  describe('기억 요약', () => {
    it('should format memories correctly', async () => {
      const mockSearchResults = {
        items: [
          {
            id: 'test1',
            content: 'Test memory 1',
            type: 'episodic',
            importance: 0.5,
            created_at: '2024-01-01'
          }
        ]
      };

      mockHybridSearchEngine.search.mockResolvedValue(mockSearchResults);

      const result = await memoryInjectionPrompt.execute(
        {
          query: 'test query',
          token_budget: 1000,
          max_memories: 5
        },
        {
          db,
          services: { hybridSearchEngine: mockHybridSearchEngine }
        }
      );

      expect(result[0].content).toContain('[episodic] Test memory 1');
    });

    it('should handle different memory types', async () => {
      const mockSearchResults = {
        items: [
          {
            id: 'test1',
            content: 'Working memory',
            type: 'working',
            importance: 0.5,
            created_at: '2024-01-01'
          },
          {
            id: 'test2',
            content: 'Semantic memory',
            type: 'semantic',
            importance: 0.7,
            created_at: '2024-01-02'
          },
          {
            id: 'test3',
            content: 'Procedural memory',
            type: 'procedural',
            importance: 0.8,
            created_at: '2024-01-03'
          }
        ]
      };

      mockHybridSearchEngine.search.mockResolvedValue(mockSearchResults);

      const result = await memoryInjectionPrompt.execute(
        {
          query: 'test query',
          token_budget: 1000,
          max_memories: 5
        },
        {
          db,
          services: { hybridSearchEngine: mockHybridSearchEngine }
        }
      );

      expect(result[0].content).toContain('[working] Working memory');
      expect(result[0].content).toContain('[semantic] Semantic memory');
      expect(result[0].content).toContain('[procedural] Procedural memory');
    });
  });

  describe('기본값 처리', () => {
    it('should use default token_budget when not provided', async () => {
      const mockSearchResults = { items: [] };
      mockHybridSearchEngine.search.mockResolvedValue(mockSearchResults);

      await memoryInjectionPrompt.execute(
        {
          query: 'test query'
        },
        {
          db,
          services: { hybridSearchEngine: mockHybridSearchEngine }
        }
      );

      // Should not throw error and use default values
      expect(mockHybridSearchEngine.search).toHaveBeenCalled();
    });

    it('should use default max_memories when not provided', async () => {
      const mockSearchResults = { items: [] };
      mockHybridSearchEngine.search.mockResolvedValue(mockSearchResults);

      await memoryInjectionPrompt.execute(
        {
          query: 'test query',
          token_budget: 1000
        },
        {
          db,
          services: { hybridSearchEngine: mockHybridSearchEngine }
        }
      );

      expect(mockHybridSearchEngine.search).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          limit: 5 // default max_memories
        })
      );
    });
  });
});
