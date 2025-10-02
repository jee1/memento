import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryManager } from './memory-manager.js';
import { MementoClient } from './memento-client.js';
import type { MemoryItem, CreateMemoryParams, SearchFilters } from './types.js';

// Mock MementoClient
const mockClient = {
  remember: vi.fn(),
  recall: vi.fn(),
  getMemory: vi.fn(),
  updateMemory: vi.fn(),
  pin: vi.fn(),
  unpin: vi.fn(),
  forget: vi.fn(),
  hybridSearch: vi.fn(),
  getContext: vi.fn(),
  isConnected: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  healthCheck: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn()
};

vi.mock('./memento-client.js', () => ({
  MementoClient: vi.fn().mockImplementation(() => mockClient)
}));

describe('MemoryManager', () => {
  let memoryManager: MemoryManager;
  let mockMementoClient: MementoClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMementoClient = new MementoClient({});
    memoryManager = new MemoryManager(mockMementoClient);
  });

  describe('생성자', () => {
    it('MementoClient를 받아서 생성되어야 함', () => {
      expect(memoryManager).toBeInstanceOf(MemoryManager);
    });
  });

  describe('create', () => {
    it('기억을 성공적으로 생성해야 함', async () => {
      const createParams: CreateMemoryParams = {
        content: 'React Hook 학습',
        type: 'episodic',
        tags: ['react', 'frontend']
      };

      const mockRememberResult = {
        memory_id: 'memory-123',
        message: 'Memory created successfully'
      };

      const mockMemory: MemoryItem = {
        id: 'memory-123',
        content: 'React Hook 학습',
        type: 'episodic',
        importance: 0.5,
        created_at: '2024-01-01T00:00:00.000Z',
        last_accessed: '2024-01-01T00:00:00.000Z',
        pinned: false,
        tags: ['react', 'frontend'],
        source: 'user',
        privacy_scope: 'private'
      };

      mockClient.remember.mockResolvedValue(mockRememberResult);
      mockClient.getMemory.mockResolvedValue(mockMemory);

      const result = await memoryManager.create(createParams);

      expect(result).toEqual(mockMemory);
      expect(mockClient.remember).toHaveBeenCalledWith(createParams);
      expect(mockClient.getMemory).toHaveBeenCalledWith('memory-123');
    });

    it('기억 생성 실패 시 에러를 던져야 함', async () => {
      const createParams: CreateMemoryParams = {
        content: 'Test memory',
        type: 'episodic'
      };

      mockClient.remember.mockRejectedValue(new Error('Creation failed'));

      await expect(memoryManager.create(createParams)).rejects.toThrow('Creation failed');
    });
  });

  describe('get', () => {
    it('특정 기억을 가져와야 함', async () => {
      const memoryId = 'memory-123';
      const mockMemory: MemoryItem = {
        id: memoryId,
        content: 'Test memory',
        type: 'episodic',
        importance: 0.5,
        created_at: '2024-01-01T00:00:00.000Z',
        last_accessed: '2024-01-01T00:00:00.000Z',
        pinned: false,
        tags: [],
        source: 'user',
        privacy_scope: 'private'
      };

      mockClient.getMemory.mockResolvedValue(mockMemory);

      const result = await memoryManager.get(memoryId);

      expect(result).toEqual(mockMemory);
      expect(mockClient.getMemory).toHaveBeenCalledWith(memoryId);
    });
  });

  describe('update', () => {
    it('기억을 성공적으로 업데이트해야 함', async () => {
      const memoryId = 'memory-123';
      const updateParams = {
        content: 'Updated content',
        importance: 0.8
      };

      const updatedMemory: MemoryItem = {
        id: memoryId,
        content: 'Updated content',
        type: 'episodic',
        importance: 0.8,
        created_at: '2024-01-01T00:00:00.000Z',
        last_accessed: '2024-01-01T01:00:00.000Z',
        pinned: false,
        tags: [],
        source: 'user',
        privacy_scope: 'private'
      };

      mockClient.updateMemory.mockResolvedValue(updatedMemory);

      const result = await memoryManager.update(memoryId, updateParams);

      expect(result).toEqual(updatedMemory);
      expect(mockClient.updateMemory).toHaveBeenCalledWith(memoryId, updateParams);
    });
  });

  describe('delete', () => {
    it('기억을 성공적으로 삭제해야 함', async () => {
      const memoryId = 'memory-123';

      mockClient.forget.mockResolvedValue({
        id: memoryId,
        deleted: true,
        message: 'Memory deleted successfully'
      });

      const result = await memoryManager.delete(memoryId);

      expect(result.deleted).toBe(true);
      expect(mockClient.forget).toHaveBeenCalledWith(memoryId, false);
    });

    it('하드 삭제를 수행해야 함', async () => {
      const memoryId = 'memory-123';

      mockClient.forget.mockResolvedValue({
        id: memoryId,
        deleted: true,
        hard: true,
        message: 'Memory permanently deleted'
      });

      const result = await memoryManager.delete(memoryId, true);

      expect(result.hard).toBe(true);
      expect(mockClient.forget).toHaveBeenCalledWith(memoryId, true);
    });
  });

  describe('search', () => {
    it('기억을 성공적으로 검색해야 함', async () => {
      const searchParams = {
        query: 'React Hook',
        limit: 10,
        filters: {
          type: ['episodic'] as const[]
        }
      };

      const mockSearchResult = {
        items: [
          {
            id: 'memory-123',
            content: 'React Hook 학습',
            type: 'episodic',
            importance: 0.8,
            created_at: '2024-01-01T00:00:00.000Z',
            last_accessed: '2024-01-01T00:00:00.000Z',
            pinned: false,
            tags: ['react'],
            source: 'user',
            privacy_scope: 'private' as const,
            score: 0.95
          }
        ],
        total_count: 1,
        query_time: 50
      };

      mockClient.recall.mockResolvedValue(mockSearchResult);

      const result = await memoryManager.search(searchParams);

      expect(result).toEqual(mockSearchResult);
      expect(mockClient.recall).toHaveBeenCalledWith(searchParams);
    });

    it('빈 검색 결과를 처리해야 함', async () => {
      const searchParams = {
        query: 'nonexistent',
        limit: 10
      };

      const mockSearchResult = {
        items: [],
        total_count: 0,
        query_time: 10
      };

      mockClient.recall.mockResolvedValue(mockSearchResult);

      const result = await memoryManager.search(searchParams);

      expect(result.items).toHaveLength(0);
      expect(result.total_count).toBe(0);
    });
  });

  describe('hybridSearch', () => {
    it('하이브리드 검색을 수행해야 함', async () => {
      const searchParams = {
        query: 'React Hook',
        limit: 10,
        vectorWeight: 0.7,
        textWeight: 0.3
      };

      const mockHybridResult = {
        items: [
          {
            id: 'memory-123',
            content: 'React Hook 학습',
            type: 'episodic',
            importance: 0.8,
            created_at: '2024-01-01T00:00:00.000Z',
            last_accessed: '2024-01-01T00:00:00.000Z',
            pinned: false,
            tags: ['react'],
            source: 'user',
            privacy_scope: 'private' as const,
            score: 0.95,
            recall_reason: '하이브리드 검색'
          }
        ],
        total_count: 1,
        query_time: 50,
        search_type: 'hybrid'
      };

      mockClient.hybridSearch.mockResolvedValue(mockHybridResult);

      const result = await memoryManager.hybridSearch(searchParams);

      expect(result).toEqual(mockHybridResult);
      expect(mockClient.hybridSearch).toHaveBeenCalledWith(searchParams);
    });
  });

  describe('pin', () => {
    it('기억을 성공적으로 고정해야 함', async () => {
      const memoryId = 'memory-123';

      mockClient.pin.mockResolvedValue({
        id: memoryId,
        pinned: true,
        message: 'Memory pinned successfully'
      });

      const result = await memoryManager.pin(memoryId);

      expect(result.pinned).toBe(true);
      expect(mockClient.pin).toHaveBeenCalledWith(memoryId);
    });
  });

  describe('unpin', () => {
    it('기억 고정을 성공적으로 해제해야 함', async () => {
      const memoryId = 'memory-123';

      mockClient.unpin.mockResolvedValue({
        id: memoryId,
        pinned: false,
        message: 'Memory unpinned successfully'
      });

      const result = await memoryManager.unpin(memoryId);

      expect(result.pinned).toBe(false);
      expect(mockClient.unpin).toHaveBeenCalledWith(memoryId);
    });
  });

  describe('getContext', () => {
    it('컨텍스트를 성공적으로 가져와야 함', async () => {
      const params = {
        query: 'React Hook',
        tokenBudget: 1000
      };

      const mockContext = {
        context: 'React Hook에 대한 관련 기억들...',
        memories_used: 3,
        token_count: 850
      };

      mockClient.getContext.mockResolvedValue(mockContext);

      const result = await memoryManager.getContext(params);

      expect(result).toEqual(mockContext);
      expect(mockClient.getContext).toHaveBeenCalledWith(params);
    });
  });

  describe('getAll', () => {
    it('모든 기억을 가져와야 함', async () => {
      const mockMemories = {
        items: [
          {
            id: 'memory-1',
            content: 'Memory 1',
            type: 'episodic',
            importance: 0.5,
            created_at: '2024-01-01T00:00:00.000Z',
            last_accessed: '2024-01-01T00:00:00.000Z',
            pinned: false,
            tags: [],
            source: 'user',
            privacy_scope: 'private' as const
          },
          {
            id: 'memory-2',
            content: 'Memory 2',
            type: 'semantic',
            importance: 0.8,
            created_at: '2024-01-01T01:00:00.000Z',
            last_accessed: '2024-01-01T01:00:00.000Z',
            pinned: true,
            tags: ['important'],
            source: 'user',
            privacy_scope: 'private' as const
          }
        ],
        total_count: 2,
        query_time: 10
      };

      mockClient.recall.mockResolvedValue(mockMemories);

      const result = await memoryManager.getAll();

      expect(result).toEqual(mockMemories);
      expect(mockClient.recall).toHaveBeenCalledWith({ query: '', limit: 100 });
    });

    it('사용자 정의 필터로 모든 기억을 가져와야 함', async () => {
      const filters: SearchFilters = {
        type: ['episodic'],
        limit: 50
      };

      const mockMemories = {
        items: [],
        total_count: 0,
        query_time: 5
      };

      mockClient.recall.mockResolvedValue(mockMemories);

      const result = await memoryManager.getAll(filters);

      expect(result).toEqual(mockMemories);
      expect(mockClient.recall).toHaveBeenCalledWith({ query: '', ...filters });
    });
  });

  describe('getByType', () => {
    it('특정 타입의 기억들을 가져와야 함', async () => {
      const type = 'episodic';
      const limit = 20;

      const mockMemories = {
        items: [
          {
            id: 'memory-1',
            content: 'Episodic memory 1',
            type: 'episodic',
            importance: 0.5,
            created_at: '2024-01-01T00:00:00.000Z',
            last_accessed: '2024-01-01T00:00:00.000Z',
            pinned: false,
            tags: [],
            source: 'user',
            privacy_scope: 'private' as const
          }
        ],
        total_count: 1,
        query_time: 10
      };

      mockClient.recall.mockResolvedValue(mockMemories);

      const result = await memoryManager.getByType(type, limit);

      expect(result).toEqual(mockMemories);
      expect(mockClient.recall).toHaveBeenCalledWith({
        query: '',
        filters: { type: [type] },
        limit
      });
    });
  });

  describe('getPinned', () => {
    it('고정된 기억들을 가져와야 함', async () => {
      const mockMemories = {
        items: [
          {
            id: 'memory-1',
            content: 'Pinned memory 1',
            type: 'episodic',
            importance: 0.9,
            created_at: '2024-01-01T00:00:00.000Z',
            last_accessed: '2024-01-01T00:00:00.000Z',
            pinned: true,
            tags: ['important'],
            source: 'user',
            privacy_scope: 'private' as const
          }
        ],
        total_count: 1,
        query_time: 10
      };

      mockClient.recall.mockResolvedValue(mockMemories);

      const result = await memoryManager.getPinned();

      expect(result).toEqual(mockMemories);
      expect(mockClient.recall).toHaveBeenCalledWith({
        query: '',
        filters: { pinned: true },
        limit: 100
      });
    });
  });

  describe('getRecent', () => {
    it('최근 기억들을 가져와야 함', async () => {
      const days = 7;
      const limit = 10;

      const mockMemories = {
        items: [
          {
            id: 'memory-1',
            content: 'Recent memory 1',
            type: 'episodic',
            importance: 0.5,
            created_at: '2024-01-01T00:00:00.000Z',
            last_accessed: '2024-01-01T00:00:00.000Z',
            pinned: false,
            tags: [],
            source: 'user',
            privacy_scope: 'private' as const
          }
        ],
        total_count: 1,
        query_time: 10
      };

      mockClient.recall.mockResolvedValue(mockMemories);

      const result = await memoryManager.getRecent(days, limit);

      expect(result).toEqual(mockMemories);
      expect(mockClient.recall).toHaveBeenCalledWith({
        query: '',
        filters: {
          time_from: expect.any(String)
        },
        limit
      });
    });
  });

  describe('getByTags', () => {
    it('특정 태그의 기억들을 가져와야 함', async () => {
      const tags = ['react', 'frontend'];
      const limit = 20;

      const mockMemories = {
        items: [
          {
            id: 'memory-1',
            content: 'React memory',
            type: 'episodic',
            importance: 0.5,
            created_at: '2024-01-01T00:00:00.000Z',
            last_accessed: '2024-01-01T00:00:00.000Z',
            pinned: false,
            tags: ['react', 'frontend'],
            source: 'user',
            privacy_scope: 'private' as const
          }
        ],
        total_count: 1,
        query_time: 10
      };

      mockClient.recall.mockResolvedValue(mockMemories);

      const result = await memoryManager.getByTags(tags, limit);

      expect(result).toEqual(mockMemories);
      expect(mockClient.recall).toHaveBeenCalledWith({
        query: '',
        filters: { tags },
        limit
      });
    });
  });

  describe('count', () => {
    it('기억 개수를 반환해야 함', async () => {
      const mockSearchResult = {
        items: [],
        total_count: 42,
        query_time: 10
      };

      mockClient.recall.mockResolvedValue(mockSearchResult);

      const result = await memoryManager.count();

      expect(result).toBe(42);
      expect(mockClient.recall).toHaveBeenCalledWith({
        query: '',
        limit: 1
      });
    });

    it('필터가 있을 때 필터된 기억 개수를 반환해야 함', async () => {
      const filters: SearchFilters = {
        type: ['episodic']
      };

      const mockSearchResult = {
        items: [],
        total_count: 25,
        query_time: 5
      };

      mockClient.recall.mockResolvedValue(mockSearchResult);

      const result = await memoryManager.count(filters);

      expect(result).toBe(25);
      expect(mockClient.recall).toHaveBeenCalledWith({
        query: '',
        ...filters,
        limit: 1
      });
    });
  });

  describe('isConnected', () => {
    it('클라이언트 연결 상태를 반환해야 함', () => {
      mockClient.isConnected.mockReturnValue(true);

      const result = memoryManager.isConnected();

      expect(result).toBe(true);
      expect(mockClient.isConnected).toHaveBeenCalled();
    });
  });

  describe('connect', () => {
    it('클라이언트에 연결해야 함', async () => {
      mockClient.connect.mockResolvedValue(true);

      const result = await memoryManager.connect();

      expect(result).toBe(true);
      expect(mockClient.connect).toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('클라이언트 연결을 해제해야 함', async () => {
      mockClient.disconnect.mockResolvedValue();

      await memoryManager.disconnect();

      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });
});
