import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContextInjector, type ContextInjectionOptions } from './context-injector.js';
import { MementoClient } from './memento-client.js';
import type { SearchResult, MemoryItem } from './types.js';

// Mock MementoClient
const mockClient = {
  hybridSearch: vi.fn(),
  getContext: vi.fn(),
  isConnected: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn()
};

vi.mock('./memento-client.js', () => ({
  MementoClient: vi.fn().mockImplementation(() => mockClient)
}));

describe('ContextInjector', () => {
  let contextInjector: ContextInjector;
  let mockMementoClient: MementoClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMementoClient = new MementoClient({});
    contextInjector = new ContextInjector(mockMementoClient);
  });

  describe('생성자', () => {
    it('MementoClient를 받아서 생성되어야 함', () => {
      expect(contextInjector).toBeInstanceOf(ContextInjector);
    });
  });

  describe('inject', () => {
    it('기본 옵션으로 컨텍스트를 주입해야 함', async () => {
      const query = 'React Hook에 대해 질문';
      const mockSearchResult: SearchResult = {
        items: [
          {
            id: 'memory-1',
            content: 'React Hook 학습 내용',
            type: 'episodic',
            importance: 0.8,
            created_at: '2024-01-01T00:00:00.000Z',
            last_accessed: '2024-01-01T00:00:00.000Z',
            pinned: false,
            tags: ['react', 'hooks'],
            source: 'user',
            privacy_scope: 'private',
            score: 0.95
          }
        ],
        total_count: 1,
        query_time: 50
      };

      mockClient.hybridSearch.mockResolvedValue(mockSearchResult);

      const result = await contextInjector.inject({ query });

      expect(result.context).toContain('React Hook 학습 내용');
      expect(result.memories_used).toBe(1);
      expect(result.token_count).toBeGreaterThan(0);
      expect(mockClient.hybridSearch).toHaveBeenCalledWith({
        query,
        limit: 10,
        vectorWeight: 0.7,
        textWeight: 0.3
      });
    });

    it('사용자 정의 옵션으로 컨텍스트를 주입해야 함', async () => {
      const query = 'TypeScript 타입 시스템';
      const options: ContextInjectionOptions = {
        maxResults: 5,
        tokenBudget: 500,
        contextType: 'task',
        memoryTypes: ['semantic'],
        recentDays: 30,
        importanceThreshold: 0.7,
        pinnedOnly: false
      };

      const mockSearchResult: SearchResult = {
        items: [
          {
            id: 'memory-1',
            content: 'TypeScript 타입 시스템 설명',
            type: 'semantic',
            importance: 0.9,
            created_at: '2024-01-01T00:00:00.000Z',
            last_accessed: '2024-01-01T00:00:00.000Z',
            pinned: true,
            tags: ['typescript', 'types'],
            source: 'user',
            privacy_scope: 'private',
            score: 0.98
          }
        ],
        total_count: 1,
        query_time: 30
      };

      mockClient.hybridSearch.mockResolvedValue(mockSearchResult);

      const result = await contextInjector.inject({ query, ...options });

      expect(result.context).toContain('TypeScript 타입 시스템 설명');
      expect(result.memories_used).toBe(1);
      expect(mockClient.hybridSearch).toHaveBeenCalledWith({
        query,
        limit: 5,
        vectorWeight: 0.7,
        textWeight: 0.3,
        filters: {
          type: ['semantic'],
          pinned: false,
          time_from: expect.any(String),
          importance_min: 0.7
        }
      });
    });

    it('검색 결과가 없을 때 빈 컨텍스트를 반환해야 함', async () => {
      const query = '존재하지 않는 내용';
      const mockSearchResult: SearchResult = {
        items: [],
        total_count: 0,
        query_time: 10
      };

      mockClient.hybridSearch.mockResolvedValue(mockSearchResult);

      const result = await contextInjector.inject({ query });

      expect(result.context).toBe('');
      expect(result.memories_used).toBe(0);
      expect(result.token_count).toBe(0);
    });

    it('토큰 예산을 초과하지 않도록 컨텍스트를 압축해야 함', async () => {
      const query = '긴 내용에 대한 질문';
      const options: ContextInjectionOptions = {
        tokenBudget: 100 // 매우 작은 토큰 예산
      };

      const mockSearchResult: SearchResult = {
        items: [
          {
            id: 'memory-1',
            content: '매우 긴 내용이 포함된 기억입니다. 이 내용은 토큰 예산을 초과할 수 있습니다. 하지만 ContextInjector는 이를 적절히 압축하여 토큰 예산 내에서 컨텍스트를 생성해야 합니다.',
            type: 'episodic',
            importance: 0.8,
            created_at: '2024-01-01T00:00:00.000Z',
            last_accessed: '2024-01-01T00:00:00.000Z',
            pinned: false,
            tags: ['long'],
            source: 'user',
            privacy_scope: 'private',
            score: 0.9
          }
        ],
        total_count: 1,
        query_time: 20
      };

      mockClient.hybridSearch.mockResolvedValue(mockSearchResult);

      const result = await contextInjector.inject({ query, ...options });

      expect(result.token_count).toBeLessThanOrEqual(100);
      expect(result.context).toBeDefined();
    });

    it('중요도 순으로 기억을 정렬해야 함', async () => {
      const query = '정렬 테스트';
      const mockSearchResult: SearchResult = {
        items: [
          {
            id: 'memory-1',
            content: '중요도 0.5',
            type: 'episodic',
            importance: 0.5,
            created_at: '2024-01-01T00:00:00.000Z',
            last_accessed: '2024-01-01T00:00:00.000Z',
            pinned: false,
            tags: [],
            source: 'user',
            privacy_scope: 'private',
            score: 0.8
          },
          {
            id: 'memory-2',
            content: '중요도 0.9',
            type: 'episodic',
            importance: 0.9,
            created_at: '2024-01-01T00:00:00.000Z',
            last_accessed: '2024-01-01T00:00:00.000Z',
            pinned: false,
            tags: [],
            source: 'user',
            privacy_scope: 'private',
            score: 0.7
          }
        ],
        total_count: 2,
        query_time: 30
      };

      mockClient.hybridSearch.mockResolvedValue(mockSearchResult);

      const result = await contextInjector.inject({ query });

      expect(result.context).toContain('중요도 0.9');
      expect(result.context.indexOf('중요도 0.9')).toBeLessThan(result.context.indexOf('중요도 0.5'));
    });
  });

  describe('injectForConversation', () => {
    it('대화용 컨텍스트를 주입해야 함', async () => {
      const query = '대화 내용';
      const mockSearchResult: SearchResult = {
        items: [
          {
            id: 'memory-1',
            content: '대화 관련 기억',
            type: 'episodic',
            importance: 0.8,
            created_at: '2024-01-01T00:00:00.000Z',
            last_accessed: '2024-01-01T00:00:00.000Z',
            pinned: false,
            tags: ['conversation'],
            source: 'user',
            privacy_scope: 'private',
            score: 0.9
          }
        ],
        total_count: 1,
        query_time: 25
      };

      mockClient.hybridSearch.mockResolvedValue(mockSearchResult);

      const result = await contextInjector.injectForConversation(query);

      expect(result.context).toContain('대화 관련 기억');
      expect(result.context_type).toBe('conversation');
    });
  });

  describe('injectForTask', () => {
    it('작업용 컨텍스트를 주입해야 함', async () => {
      const query = '작업 내용';
      const mockSearchResult: SearchResult = {
        items: [
          {
            id: 'memory-1',
            content: '작업 관련 기억',
            type: 'procedural',
            importance: 0.9,
            created_at: '2024-01-01T00:00:00.000Z',
            last_accessed: '2024-01-01T00:00:00.000Z',
            pinned: false,
            tags: ['task'],
            source: 'user',
            privacy_scope: 'private',
            score: 0.95
          }
        ],
        total_count: 1,
        query_time: 20
      };

      mockClient.hybridSearch.mockResolvedValue(mockSearchResult);

      const result = await contextInjector.injectForTask(query);

      expect(result.context).toContain('작업 관련 기억');
      expect(result.context_type).toBe('task');
    });
  });

  describe('injectGeneral', () => {
    it('일반용 컨텍스트를 주입해야 함', async () => {
      const query = '일반 질문';
      const mockSearchResult: SearchResult = {
        items: [
          {
            id: 'memory-1',
            content: '일반 기억',
            type: 'semantic',
            importance: 0.7,
            created_at: '2024-01-01T00:00:00.000Z',
            last_accessed: '2024-01-01T00:00:00.000Z',
            pinned: false,
            tags: ['general'],
            source: 'user',
            privacy_scope: 'private',
            score: 0.8
          }
        ],
        total_count: 1,
        query_time: 15
      };

      mockClient.hybridSearch.mockResolvedValue(mockSearchResult);

      const result = await contextInjector.injectGeneral(query);

      expect(result.context).toContain('일반 기억');
      expect(result.context_type).toBe('general');
    });
  });

  describe('getRelevantMemories', () => {
    it('관련 기억들을 반환해야 함', async () => {
      const query = '관련 기억 검색';
      const limit = 5;

      const mockSearchResult: SearchResult = {
        items: [
          {
            id: 'memory-1',
            content: '관련 기억 1',
            type: 'episodic',
            importance: 0.8,
            created_at: '2024-01-01T00:00:00.000Z',
            last_accessed: '2024-01-01T00:00:00.000Z',
            pinned: false,
            tags: ['relevant'],
            source: 'user',
            privacy_scope: 'private',
            score: 0.9
          }
        ],
        total_count: 1,
        query_time: 30
      };

      mockClient.hybridSearch.mockResolvedValue(mockSearchResult);

      const result = await contextInjector.getRelevantMemories(query, limit);

      expect(result).toEqual(mockSearchResult.items);
      expect(mockClient.hybridSearch).toHaveBeenCalledWith({
        query,
        limit,
        vectorWeight: 0.7,
        textWeight: 0.3
      });
    });
  });

  describe('compressMemories', () => {
    it('기억들을 토큰 예산에 맞게 압축해야 함', () => {
      const memories: MemoryItem[] = [
        {
          id: 'memory-1',
          content: '첫 번째 기억입니다. 이 기억은 매우 긴 내용을 포함하고 있습니다.',
          type: 'episodic',
          importance: 0.8,
          created_at: '2024-01-01T00:00:00.000Z',
          last_accessed: '2024-01-01T00:00:00.000Z',
          pinned: false,
          tags: ['long'],
          source: 'user',
          privacy_scope: 'private'
        },
        {
          id: 'memory-2',
          content: '두 번째 기억입니다.',
          type: 'episodic',
          importance: 0.9,
          created_at: '2024-01-01T00:00:00.000Z',
          last_accessed: '2024-01-01T00:00:00.000Z',
          pinned: false,
          tags: ['short'],
          source: 'user',
          privacy_scope: 'private'
        }
      ];

      const tokenBudget = 50; // 매우 작은 토큰 예산
      const result = contextInjector.compressMemories(memories, tokenBudget);

      expect(result.token_count).toBeLessThanOrEqual(tokenBudget);
      expect(result.memories_used).toBeGreaterThan(0);
      expect(result.context).toBeDefined();
    });

    it('빈 기억 배열에 대해 빈 컨텍스트를 반환해야 함', () => {
      const memories: MemoryItem[] = [];
      const tokenBudget = 100;

      const result = contextInjector.compressMemories(memories, tokenBudget);

      expect(result.context).toBe('');
      expect(result.memories_used).toBe(0);
      expect(result.token_count).toBe(0);
    });
  });

  describe('estimateTokens', () => {
    it('텍스트의 토큰 수를 추정해야 함', () => {
      const text = 'Hello world! This is a test.';
      const tokens = contextInjector.estimateTokens(text);

      expect(tokens).toBeGreaterThan(0);
      expect(typeof tokens).toBe('number');
    });

    it('빈 텍스트에 대해 0을 반환해야 함', () => {
      const text = '';
      const tokens = contextInjector.estimateTokens(text);

      expect(tokens).toBe(0);
    });

    it('긴 텍스트에 대해 적절한 토큰 수를 반환해야 함', () => {
      const text = 'a'.repeat(1000); // 1000자 텍스트
      const tokens = contextInjector.estimateTokens(text);

      expect(tokens).toBeGreaterThan(100);
      expect(tokens).toBeLessThan(1000);
    });
  });

  describe('formatMemoryForContext', () => {
    it('기억을 컨텍스트 형식으로 포맷해야 함', () => {
      const memory: MemoryItem = {
        id: 'memory-1',
        content: 'React Hook 학습 내용',
        type: 'episodic',
        importance: 0.8,
        created_at: '2024-01-01T00:00:00.000Z',
        last_accessed: '2024-01-01T00:00:00.000Z',
        pinned: true,
        tags: ['react', 'hooks'],
        source: 'user',
        privacy_scope: 'private'
      };

      const formatted = contextInjector.formatMemoryForContext(memory);

      expect(formatted).toContain('React Hook 학습 내용');
      expect(formatted).toContain('episodic');
      expect(formatted).toContain('react');
      expect(formatted).toContain('hooks');
    });

    it('고정된 기억에 대해 특별한 표시를 해야 함', () => {
      const memory: MemoryItem = {
        id: 'memory-1',
        content: '중요한 기억',
        type: 'episodic',
        importance: 0.9,
        created_at: '2024-01-01T00:00:00.000Z',
        last_accessed: '2024-01-01T00:00:00.000Z',
        pinned: true,
        tags: ['important'],
        source: 'user',
        privacy_scope: 'private'
      };

      const formatted = contextInjector.formatMemoryForContext(memory);

      expect(formatted).toContain('📌'); // 고정 표시
    });
  });

  describe('isConnected', () => {
    it('클라이언트 연결 상태를 반환해야 함', () => {
      mockClient.isConnected.mockReturnValue(true);

      const result = contextInjector.isConnected();

      expect(result).toBe(true);
      expect(mockClient.isConnected).toHaveBeenCalled();
    });
  });
});
