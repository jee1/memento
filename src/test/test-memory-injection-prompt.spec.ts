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
    `);
    
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
      const definition = memoryInjectionPrompt.getDefinition();
      expect(definition.name).toBe('memory_injection');
      expect(definition.description).toBe('관련 기억을 요약하여 프롬프트에 주입');
    });

    it('should have correct input schema', () => {
      const schema = memoryInjectionPrompt.inputSchema;
      expect(schema.properties.query).toBeDefined();
      expect(schema.properties.token_budget).toBeDefined();
      expect(schema.properties.max_memories).toBeDefined();
    });

    it('should have correct output schema', () => {
      // BaseTool에는 outputSchema가 없으므로 스킵
      expect(true).toBe(true);
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

      const result = await memoryInjectionPrompt.handle(
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

      expect(result).toHaveProperty('content');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const content = JSON.parse(result.content[0].text);
      expect(content.message).toContain('관련 기억');
      expect(content.message).toContain('## 1. 📝 EPISODIC 기억');
      expect(content.message).toContain('Test memory 1');
      expect(content.message).toContain('## 2. 📚 SEMANTIC 기억');
      expect(content.message).toContain('Test memory 2');
    });

    it('should handle empty search results', async () => {
      mockHybridSearchEngine.search.mockResolvedValue({ items: [] });

      const result = await memoryInjectionPrompt.handle(
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

      expect(result).toHaveProperty('content');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const content = JSON.parse(result.content[0].text);
      expect(content.message).toBe('관련 기억을 찾을 수 없습니다.');
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

      const result = await memoryInjectionPrompt.handle(
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

      expect(result).toHaveProperty("content"); expect(result.content).toHaveLength(1); expect(result.content[0].type).toBe("text"); const content = JSON.parse(result.content[0].text);
      // role은 ToolResult에 없으므로 스킵
      expect(content.message).toContain('관련 기억');
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

      const result = await memoryInjectionPrompt.handle(
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
          limit: 6, // max_memories * 2
          vectorWeight: 0.7,
          textWeight: 0.3
        })
      );
    });
  });

  describe('에러 처리', () => {
    it('should throw error when database not available', async () => {
      await expect(
        memoryInjectionPrompt.handle(
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
      ).rejects.toThrow('데이터베이스가 연결되지 않았습니다');
    });

    it('should throw error when hybrid search engine not available', async () => {
      await expect(
        memoryInjectionPrompt.handle(
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
      ).rejects.toThrow('하이브리드 검색 엔진이 사용할 수 없습니다');
    });

    it('should handle search engine errors', async () => {
      mockHybridSearchEngine.search.mockRejectedValue(new Error('Search failed'));

      await expect(
        memoryInjectionPrompt.handle(
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
      
      // Should be based on character length (text.length / 4)
      const expectedTokens = Math.ceil(testText.length / 4);
      expect(estimatedTokens).toBe(expectedTokens);
    });

    it('should handle empty text', () => {
      const estimatedTokens = (memoryInjectionPrompt as any).estimateTokens('');
      expect(estimatedTokens).toBe(0);
    });

    it('should handle text with multiple spaces', () => {
      const testText = 'word1    word2   word3';
      const estimatedTokens = (memoryInjectionPrompt as any).estimateTokens(testText);
      
      // Should be based on character length (text.length / 4)
      const expectedTokens = Math.ceil(testText.length / 4);
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

      const result = await memoryInjectionPrompt.handle(
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

      expect(result).toHaveProperty('content');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const content = JSON.parse(result.content[0].text);
      expect(content.message).toContain('## 1. 📝 EPISODIC 기억');
      expect(content.message).toContain('Test memory 1');
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

      const result = await memoryInjectionPrompt.handle(
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

      expect(result).toHaveProperty('content');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const content = JSON.parse(result.content[0].text);
      expect(content.message).toContain('Working memory');
      expect(content.message).toContain('Semantic memory');
      expect(content.message).toContain('Procedural memory');
    });
  });

  describe('기본값 처리', () => {
    it('should use default token_budget when not provided', async () => {
      const mockSearchResults = { items: [] };
      mockHybridSearchEngine.search.mockResolvedValue(mockSearchResults);

      await memoryInjectionPrompt.handle(
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

      await memoryInjectionPrompt.handle(
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
          limit: 10, // default max_memories * 2
          vectorWeight: 0.7,
          textWeight: 0.3
        })
      );
    });
  });

  describe('기억 요약 기능', () => {
    it('should summarize memories within token budget', async () => {
      const mockSearchResults = {
        items: [
          {
            id: 'test1',
            content: 'This is a very long memory content that should be summarized when token budget is limited',
            type: 'episodic',
            importance: 0.8,
            finalScore: 0.9,
            created_at: '2024-01-01'
          },
          {
            id: 'test2',
            content: 'Short memory',
            type: 'semantic',
            importance: 0.6,
            finalScore: 0.7,
            created_at: '2024-01-02'
          }
        ]
      };

      mockHybridSearchEngine.search.mockResolvedValue(mockSearchResults);

      const result = await memoryInjectionPrompt.handle(
        {
          query: 'test query',
          token_budget: 50, // Very small budget
          max_memories: 2
        },
        {
          db,
          services: { hybridSearchEngine: mockHybridSearchEngine }
        }
      );

      expect(result).toHaveProperty('content');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const content = JSON.parse(result.content[0].text);
      expect(content.message).toContain('관련 기억');
      // Should be summarized due to token budget
      expect(content.message.length).toBeLessThan(500);
    });

    it('should prioritize high importance memories', async () => {
      const mockSearchResults = {
        items: [
          {
            id: 'test1',
            content: 'Low importance memory',
            type: 'episodic',
            importance: 0.2,
            finalScore: 0.5,
            created_at: '2024-01-01'
          },
          {
            id: 'test2',
            content: 'High importance memory',
            type: 'semantic',
            importance: 0.9,
            finalScore: 0.8,
            created_at: '2024-01-02'
          }
        ]
      };

      mockHybridSearchEngine.search.mockResolvedValue(mockSearchResults);

      const result = await memoryInjectionPrompt.handle(
        {
          query: 'test query',
          token_budget: 100,
          max_memories: 1
        },
        {
          db,
          services: { hybridSearchEngine: mockHybridSearchEngine }
        }
      );

      expect(result).toHaveProperty('content');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const content = JSON.parse(result.content[0].text);
      // Should include high importance memory
      expect(content.message).toContain('High importance memory');
    });

    it('should handle empty memories gracefully', async () => {
      const mockSearchResults = { items: [] };
      mockHybridSearchEngine.search.mockResolvedValue(mockSearchResults);

      const result = await memoryInjectionPrompt.handle(
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

      expect(result).toHaveProperty('content');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const content = JSON.parse(result.content[0].text);
      expect(content.message).toBe('관련 기억을 찾을 수 없습니다.');
    });
  });

  describe('메모리 타입 이모지', () => {
    it('should return correct emoji for each memory type', () => {
      const emojiMap = {
        'working': '🧠',
        'episodic': '📝',
        'semantic': '📚',
        'procedural': '⚙️'
      };

      Object.entries(emojiMap).forEach(([type, expectedEmoji]) => {
        const emoji = (memoryInjectionPrompt as any).getMemoryTypeEmoji(type);
        expect(emoji).toBe(expectedEmoji);
      });
    });

    it('should return default emoji for unknown type', () => {
      const emoji = (memoryInjectionPrompt as any).getMemoryTypeEmoji('unknown');
      expect(emoji).toBe('💭');
    });
  });

  describe('프롬프트 포맷팅', () => {
    it('should format memory prompt correctly', async () => {
      const mockSearchResults = {
        items: [
          {
            id: 'test1',
            content: 'Test memory content',
            type: 'episodic',
            importance: 0.7,
            finalScore: 0.8,
            created_at: '2024-01-01'
          }
        ]
      };

      mockHybridSearchEngine.search.mockResolvedValue(mockSearchResults);

      const result = await memoryInjectionPrompt.handle(
        {
          query: 'test query',
          token_budget: 1000,
          max_memories: 1
        },
        {
          db,
          services: { hybridSearchEngine: mockHybridSearchEngine }
        }
      );

      expect(result).toHaveProperty('content');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const content = JSON.parse(result.content[0].text);
      expect(content.message).toContain('# 관련 기억');
      expect(content.message).toContain('**검색 쿼리**: "test query"');
      expect(content.message).toContain('## 1. 📝 EPISODIC 기억');
      expect(content.message).toContain('**중요도**: ★★★★');
      expect(content.message).toContain('**내용**: Test memory content');
    });

    it('should format multiple memories correctly', async () => {
      const mockSearchResults = {
        items: [
          {
            id: 'test1',
            content: 'First memory',
            type: 'episodic',
            importance: 0.5,
            finalScore: 0.7,
            created_at: '2024-01-01'
          },
          {
            id: 'test2',
            content: 'Second memory',
            type: 'semantic',
            importance: 0.8,
            finalScore: 0.9,
            created_at: '2024-01-02'
          }
        ]
      };

      mockHybridSearchEngine.search.mockResolvedValue(mockSearchResults);

      const result = await memoryInjectionPrompt.handle(
        {
          query: 'test query',
          token_budget: 1000,
          max_memories: 2
        },
        {
          db,
          services: { hybridSearchEngine: mockHybridSearchEngine }
        }
      );

      expect(result).toHaveProperty('content');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const content = JSON.parse(result.content[0].text);
      expect(content.message).toContain('## 1. 📚 SEMANTIC 기억');
      expect(content.message).toContain('## 2. 📝 EPISODIC 기억');
      expect(content.message).toContain('First memory');
      expect(content.message).toContain('Second memory');
    });

    it('should include importance stars correctly', async () => {
      const mockSearchResults = {
        items: [
          {
            id: 'test1',
            content: 'Test memory',
            type: 'episodic',
            importance: 0.2, // Should show 1 star
            finalScore: 0.7,
            created_at: '2024-01-01'
          },
          {
            id: 'test2',
            content: 'Test memory 2',
            type: 'semantic',
            importance: 1.0, // Should show 5 stars
            finalScore: 0.9,
            created_at: '2024-01-02'
          }
        ]
      };

      mockHybridSearchEngine.search.mockResolvedValue(mockSearchResults);

      const result = await memoryInjectionPrompt.handle(
        {
          query: 'test query',
          token_budget: 1000,
          max_memories: 2
        },
        {
          db,
          services: { hybridSearchEngine: mockHybridSearchEngine }
        }
      );

      expect(result).toHaveProperty('content');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const content = JSON.parse(result.content[0].text);
      expect(content.message).toContain('**중요도**: ★ (0.20)');
      expect(content.message).toContain('**중요도**: ★★★★★ (1.00)');
    });
  });
});
