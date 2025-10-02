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
        importance: 0.8,
        tags: ['react', 'hooks']
      };

      const mockMemory: MemoryItem = {
        id: 'memory-123',
        content: createParams.content,
        type: createParams.type,
        importance: createParams.importance,
        created_at: '2024-01-01T00:00:00.000Z',
        last_accessed: '2024-01-01T00:00:00.000Z',
        pinned: false,
        tags: createParams.tags,
        source: 'user',
        privacy_scope: 'private'
      };

      mockClient.remember.mockResolvedValue({ memory_id: 'memory-123' });
      mockClient.getMemory.mockResolvedValue(mockMemory);

      const result = await memoryManager.create(createParams);

      expect(result).toEqual(mockMemory);
      expect(mockClient.remember).toHaveBeenCalledWith(createParams);
      expect(mockClient.getMemory).toHaveBeenCalledWith('memory-123');
    });
  });

  describe('get', () => {
    it('기억을 성공적으로 가져와야 함', async () => {
      const memoryId = 'memory-123';
      const mockMemory: MemoryItem = {
        id: memoryId,
        content: 'Test memory',
        type: 'episodic',
        importance: 0.5,
        created_at: '2024-01-01T00:00:00.000Z',
        last_accessed: '2024-01-01T00:00:00.000Z',
        pinned: false,
        tags: ['test'],
        source: 'user',
        privacy_scope: 'private'
      };

      mockClient.getMemory.mockResolvedValue(mockMemory);

      const result = await memoryManager.get(memoryId);

      expect(result).toEqual(mockMemory);
      expect(mockClient.getMemory).toHaveBeenCalledWith(memoryId);
    });

    it('존재하지 않는 기억에 대해 null을 반환해야 함', async () => {
      const memoryId = 'nonexistent';

      mockClient.getMemory.mockResolvedValue(null);

      const result = await memoryManager.get(memoryId);

      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('기억을 성공적으로 업데이트해야 함', async () => {
      const memoryId = 'memory-123';
      const updateParams = {
        content: 'Updated content',
        importance: 0.9
      };

      const updatedMemory: MemoryItem = {
        id: memoryId,
        content: updateParams.content,
        type: 'episodic',
        importance: updateParams.importance,
        created_at: '2024-01-01T00:00:00.000Z',
        last_accessed: '2024-01-01T00:00:00.000Z',
        pinned: false,
        tags: ['test'],
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
        success: true,
        message: 'Memory deleted successfully'
      });

      const result = await memoryManager.delete(memoryId);

      expect(result).toBe(true);
      expect(mockClient.forget).toHaveBeenCalledWith(memoryId, false);
    });

    it('하드 삭제를 수행해야 함', async () => {
      const memoryId = 'memory-123';

      mockClient.forget.mockResolvedValue({
        id: memoryId,
        success: true,
        hard: true,
        message: 'Memory permanently deleted'
      });

      const result = await memoryManager.delete(memoryId, true);

      expect(result).toBe(true);
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
            content: 'React Hook에 대해 학습했다',
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

      const result = await memoryManager.search(searchParams.query, {
        filters: searchParams.filters,
        limit: searchParams.limit
      });

      expect(result).toEqual(mockSearchResult);
      expect(mockClient.recall).toHaveBeenCalledWith(
        searchParams.query,
        searchParams.filters,
        searchParams.limit
      );
    });
  });

  describe('searchByTags', () => {
    it('태그로 검색을 수행해야 함', async () => {
      const tags = ['react', 'hooks'];
      const limit = 10;

      const mockSearchResult = {
        items: [
          {
            id: 'memory-123',
            content: 'React Hook에 대해 학습했다',
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
        query_time: 30
      };

      mockClient.recall.mockResolvedValue(mockSearchResult);

      const result = await memoryManager.searchByTags(tags, limit);

      expect(result).toEqual(mockSearchResult);
      expect(mockClient.recall).toHaveBeenCalledWith('*', { tags }, limit);
    });
  });

  describe('searchByType', () => {
    it('타입으로 검색을 수행해야 함', async () => {
      const type = 'episodic';
      const limit = 10;

      const mockSearchResult = {
        items: [
          {
            id: 'memory-123',
            content: 'Episodic memory',
            type: 'episodic',
            importance: 0.8,
            created_at: '2024-01-01T00:00:00.000Z',
            last_accessed: '2024-01-01T00:00:00.000Z',
            pinned: false,
            tags: [],
            source: 'user',
            privacy_scope: 'private' as const,
            score: 0.95
          }
        ],
        total_count: 1,
        query_time: 25
      };

      mockClient.recall.mockResolvedValue(mockSearchResult);

      const result = await memoryManager.searchByType(type, limit);

      expect(result).toEqual(mockSearchResult);
      expect(mockClient.recall).toHaveBeenCalledWith('*', { type: [type] }, limit);
    });
  });

  describe('pin', () => {
    it('기억을 성공적으로 고정해야 함', async () => {
      const memoryId = 'memory-123';

      mockClient.pin.mockResolvedValue({
        id: memoryId,
        success: true,
        message: 'Memory pinned successfully'
      });

      const result = await memoryManager.pin(memoryId);

      expect(result).toBe(true);
      expect(mockClient.pin).toHaveBeenCalledWith(memoryId);
    });
  });

  describe('unpin', () => {
    it('기억 고정을 성공적으로 해제해야 함', async () => {
      const memoryId = 'memory-123';

      mockClient.unpin.mockResolvedValue({
        id: memoryId,
        success: true,
        message: 'Memory unpinned successfully'
      });

      const result = await memoryManager.unpin(memoryId);

      expect(result).toBe(true);
      expect(mockClient.unpin).toHaveBeenCalledWith(memoryId);
    });
  });

  describe('getStats', () => {
    it('통계를 반환해야 함', async () => {
      const mockStats = {
        total_memories: 100,
        by_type: {
          working: 10,
          episodic: 30,
          semantic: 40,
          procedural: 20
        },
        by_privacy: {
          private: 80,
          team: 15,
          public: 5
        },
        pinned_count: 5,
        recent_count: 25
      };

      // Memory Manager의 getStats는 내부적으로 여러 검색을 수행하므로
      // 각 검색에 대한 mock을 설정
      const mockSearchResult = {
        items: [
          {
            id: 'memory-1',
            content: 'Test memory',
            type: 'episodic',
            importance: 0.5,
            created_at: '2024-01-01T00:00:00.000Z',
            last_accessed: '2024-01-01T00:00:00.000Z',
            pinned: false,
            tags: ['test'],
            source: 'user',
            privacy_scope: 'private' as const,
            score: 0.8
          }
        ],
        total_count: 1,
        query_time: 10
      };

      mockClient.recall.mockResolvedValue(mockSearchResult);

      const result = await memoryManager.getStats();

      expect(result).toBeDefined();
      expect(typeof result.total).toBe('number');
    });
  });
});