import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MementoClient } from './memento-client.js';
import type { MementoClientOptions } from './types.js';

// Mock axios
vi.mock('axios');
const mockAxios = {
  create: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() }
  }
};

vi.mocked(mockAxios.create).mockReturnValue(mockAxios);

// Mock axios module
vi.mock('axios', () => ({
  default: mockAxios
}));

describe('MementoClient', () => {
  let client: MementoClient;
  let options: MementoClientOptions;

  beforeEach(() => {
    vi.clearAllMocks();
    
    options = {
      serverUrl: 'http://localhost:8080',
      apiKey: 'test-api-key',
      timeout: 5000,
      retries: 3
    };

    client = new MementoClient(options);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('생성자', () => {
    it('기본 옵션으로 생성되어야 함', () => {
      const defaultClient = new MementoClient();
      expect(defaultClient).toBeInstanceOf(MementoClient);
    });

    it('사용자 정의 옵션으로 생성되어야 함', () => {
      expect(client).toBeInstanceOf(MementoClient);
    });

    it('axios 인스턴스를 생성해야 함', () => {
      expect(mockAxios.create).toHaveBeenCalledWith({
        baseURL: 'http://localhost:8080',
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-api-key'
        }
      });
    });
  });

  describe('connect', () => {
    it('서버에 성공적으로 연결되어야 함', async () => {
      mockAxios.get.mockResolvedValue({
        data: { status: 'ok', version: '1.0.0' }
      });

      const result = await client.connect();

      expect(result).toBe(true);
      expect(mockAxios.get).toHaveBeenCalledWith('/health');
    });

    it('연결 실패 시 에러를 던져야 함', async () => {
      mockAxios.get.mockRejectedValue(new Error('Connection failed'));

      await expect(client.connect()).rejects.toThrow('Connection failed');
    });

    it('이미 연결된 상태에서 중복 연결을 방지해야 함', async () => {
      mockAxios.get.mockResolvedValue({
        data: { status: 'ok', version: '1.0.0' }
      });

      await client.connect();
      const result = await client.connect();

      expect(result).toBe(true);
      expect(mockAxios.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('disconnect', () => {
    it('연결을 해제해야 함', async () => {
      mockAxios.get.mockResolvedValue({
        data: { status: 'ok', version: '1.0.0' }
      });

      await client.connect();
      await client.disconnect();

      expect(client.isConnected()).toBe(false);
    });

    it('연결되지 않은 상태에서 disconnect를 호출해도 에러가 발생하지 않아야 함', async () => {
      await expect(client.disconnect()).resolves.not.toThrow();
    });
  });

  describe('isConnected', () => {
    it('초기 상태에서는 false를 반환해야 함', () => {
      expect(client.isConnected()).toBe(false);
    });

    it('연결 후에는 true를 반환해야 함', async () => {
      mockAxios.get.mockResolvedValue({
        data: { status: 'ok', version: '1.0.0' }
      });

      await client.connect();
      expect(client.isConnected()).toBe(true);
    });

    it('연결 해제 후에는 false를 반환해야 함', async () => {
      mockAxios.get.mockResolvedValue({
        data: { status: 'ok', version: '1.0.0' }
      });

      await client.connect();
      await client.disconnect();
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('remember', () => {
    beforeEach(async () => {
      mockAxios.get.mockResolvedValue({
        data: { status: 'ok', version: '1.0.0' }
      });
      await client.connect();
    });

    it('기억을 성공적으로 저장해야 함', async () => {
      const memoryData = {
        content: 'React Hook에 대해 학습했다',
        type: 'episodic' as const,
        importance: 0.8,
        tags: ['react', 'hooks']
      };

      mockAxios.post.mockResolvedValue({
        data: {
          id: 'memory-123',
          content: memoryData.content,
          type: memoryData.type,
          importance: memoryData.importance,
          created_at: '2024-01-01T00:00:00.000Z'
        }
      });

      const result = await client.remember(memoryData);

      expect(result.id).toBe('memory-123');
      expect(result.content).toBe(memoryData.content);
      expect(mockAxios.post).toHaveBeenCalledWith('/api/memories', memoryData);
    });

    it('유효하지 않은 데이터에 대해 에러를 던져야 함', async () => {
      const invalidData = {
        content: '', // 빈 내용
        type: 'episodic' as const
      };

      await expect(client.remember(invalidData)).rejects.toThrow();
    });

    it('서버 에러에 대해 적절한 에러를 던져야 함', async () => {
      const memoryData = {
        content: 'Test memory',
        type: 'episodic' as const
      };

      mockAxios.post.mockRejectedValue({
        response: {
          status: 400,
          data: { error: 'Invalid data' }
        }
      });

      await expect(client.remember(memoryData)).rejects.toThrow();
    });
  });

  describe('recall', () => {
    beforeEach(async () => {
      mockAxios.get.mockResolvedValue({
        data: { status: 'ok', version: '1.0.0' }
      });
      await client.connect();
    });

    it('기억을 성공적으로 검색해야 함', async () => {
      const searchParams = {
        query: 'React Hook',
        limit: 10,
        filters: {
          type: ['episodic'] as const[]
        }
      };

      const mockResults = {
        items: [
          {
            id: 'memory-123',
            content: 'React Hook에 대해 학습했다',
            type: 'episodic',
            importance: 0.8,
            created_at: '2024-01-01T00:00:00.000Z',
            score: 0.95
          }
        ],
        total_count: 1,
        query_time: 50
      };

      mockAxios.post.mockResolvedValue({
        data: mockResults
      });

      const result = await client.recall(searchParams);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('memory-123');
      expect(mockAxios.post).toHaveBeenCalledWith('/api/search', searchParams);
    });

    it('빈 검색 결과를 처리해야 함', async () => {
      const searchParams = {
        query: 'nonexistent',
        limit: 10
      };

      mockAxios.post.mockResolvedValue({
        data: {
          items: [],
          total_count: 0,
          query_time: 10
        }
      });

      const result = await client.recall(searchParams);

      expect(result.items).toHaveLength(0);
      expect(result.total_count).toBe(0);
    });
  });

  describe('pin', () => {
    beforeEach(async () => {
      mockAxios.get.mockResolvedValue({
        data: { status: 'ok', version: '1.0.0' }
      });
      await client.connect();
    });

    it('기억을 성공적으로 고정해야 함', async () => {
      const memoryId = 'memory-123';

      mockAxios.post.mockResolvedValue({
        data: {
          id: memoryId,
          pinned: true,
          message: 'Memory pinned successfully'
        }
      });

      const result = await client.pin(memoryId);

      expect(result.id).toBe(memoryId);
      expect(result.pinned).toBe(true);
      expect(mockAxios.post).toHaveBeenCalledWith(`/api/memories/${memoryId}/pin`);
    });

    it('존재하지 않는 기억 고정 시 에러를 던져야 함', async () => {
      const memoryId = 'nonexistent';

      mockAxios.post.mockRejectedValue({
        response: {
          status: 404,
          data: { error: 'Memory not found' }
        }
      });

      await expect(client.pin(memoryId)).rejects.toThrow();
    });
  });

  describe('unpin', () => {
    beforeEach(async () => {
      mockAxios.get.mockResolvedValue({
        data: { status: 'ok', version: '1.0.0' }
      });
      await client.connect();
    });

    it('기억 고정을 성공적으로 해제해야 함', async () => {
      const memoryId = 'memory-123';

      mockAxios.post.mockResolvedValue({
        data: {
          id: memoryId,
          pinned: false,
          message: 'Memory unpinned successfully'
        }
      });

      const result = await client.unpin(memoryId);

      expect(result.id).toBe(memoryId);
      expect(result.pinned).toBe(false);
      expect(mockAxios.post).toHaveBeenCalledWith(`/api/memories/${memoryId}/unpin`);
    });
  });

  describe('forget', () => {
    beforeEach(async () => {
      mockAxios.get.mockResolvedValue({
        data: { status: 'ok', version: '1.0.0' }
      });
      await client.connect();
    });

    it('기억을 성공적으로 삭제해야 함', async () => {
      const memoryId = 'memory-123';

      mockAxios.delete.mockResolvedValue({
        data: {
          id: memoryId,
          deleted: true,
          message: 'Memory deleted successfully'
        }
      });

      const result = await client.forget(memoryId);

      expect(result.id).toBe(memoryId);
      expect(result.deleted).toBe(true);
      expect(mockAxios.delete).toHaveBeenCalledWith(`/api/memories/${memoryId}`);
    });

    it('하드 삭제를 수행해야 함', async () => {
      const memoryId = 'memory-123';

      mockAxios.delete.mockResolvedValue({
        data: {
          id: memoryId,
          deleted: true,
          hard: true,
          message: 'Memory permanently deleted'
        }
      });

      const result = await client.forget(memoryId, true);

      expect(result.hard).toBe(true);
      expect(mockAxios.delete).toHaveBeenCalledWith(`/api/memories/${memoryId}?hard=true`);
    });
  });

  describe('getMemory', () => {
    beforeEach(async () => {
      mockAxios.get.mockResolvedValue({
        data: { status: 'ok', version: '1.0.0' }
      });
      await client.connect();
    });

    it('특정 기억을 가져와야 함', async () => {
      const memoryId = 'memory-123';
      const mockMemory = {
        id: memoryId,
        content: 'Test memory',
        type: 'episodic',
        importance: 0.5,
        created_at: '2024-01-01T00:00:00.000Z'
      };

      mockAxios.get.mockResolvedValue({
        data: mockMemory
      });

      const result = await client.getMemory(memoryId);

      expect(result).toEqual(mockMemory);
      expect(mockAxios.get).toHaveBeenCalledWith(`/api/memories/${memoryId}`);
    });

    it('존재하지 않는 기억에 대해 에러를 던져야 함', async () => {
      const memoryId = 'nonexistent';

      mockAxios.get.mockRejectedValue({
        response: {
          status: 404,
          data: { error: 'Memory not found' }
        }
      });

      await expect(client.getMemory(memoryId)).rejects.toThrow();
    });
  });

  describe('updateMemory', () => {
    beforeEach(async () => {
      mockAxios.get.mockResolvedValue({
        data: { status: 'ok', version: '1.0.0' }
      });
      await client.connect();
    });

    it('기억을 성공적으로 업데이트해야 함', async () => {
      const memoryId = 'memory-123';
      const updateData = {
        content: 'Updated content',
        importance: 0.9
      };

      const updatedMemory = {
        id: memoryId,
        content: updateData.content,
        importance: updateData.importance,
        updated_at: '2024-01-01T01:00:00.000Z'
      };

      mockAxios.put.mockResolvedValue({
        data: updatedMemory
      });

      const result = await client.updateMemory(memoryId, updateData);

      expect(result).toEqual(updatedMemory);
      expect(mockAxios.put).toHaveBeenCalledWith(`/api/memories/${memoryId}`, updateData);
    });
  });

  describe('hybridSearch', () => {
    beforeEach(async () => {
      mockAxios.get.mockResolvedValue({
        data: { status: 'ok', version: '1.0.0' }
      });
      await client.connect();
    });

    it('하이브리드 검색을 수행해야 함', async () => {
      const searchParams = {
        query: 'React Hook',
        limit: 10,
        vectorWeight: 0.7,
        textWeight: 0.3
      };

      const mockResults = {
        items: [
          {
            id: 'memory-123',
            content: 'React Hook에 대해 학습했다',
            type: 'episodic',
            score: 0.95,
            recall_reason: '하이브리드 검색'
          }
        ],
        total_count: 1,
        query_time: 50,
        search_type: 'hybrid'
      };

      mockAxios.post.mockResolvedValue({
        data: mockResults
      });

      const result = await client.hybridSearch(searchParams);

      expect(result.items).toHaveLength(1);
      expect(result.search_type).toBe('hybrid');
      expect(mockAxios.post).toHaveBeenCalledWith('/api/search/hybrid', searchParams);
    });
  });

  describe('getContext', () => {
    beforeEach(async () => {
      mockAxios.get.mockResolvedValue({
        data: { status: 'ok', version: '1.0.0' }
      });
      await client.connect();
    });

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

      mockAxios.post.mockResolvedValue({
        data: mockContext
      });

      const result = await client.getContext(params);

      expect(result.context).toBe(mockContext.context);
      expect(result.memories_used).toBe(3);
      expect(mockAxios.post).toHaveBeenCalledWith('/api/context', params);
    });
  });

  describe('healthCheck', () => {
    it('서버 상태를 확인해야 함', async () => {
      const mockHealth = {
        status: 'ok',
        version: '1.0.0',
        uptime: 3600,
        memory_usage: 0.5
      };

      mockAxios.get.mockResolvedValue({
        data: mockHealth
      });

      const result = await client.healthCheck();

      expect(result).toEqual(mockHealth);
      expect(mockAxios.get).toHaveBeenCalledWith('/health');
    });
  });

  describe('에러 처리', () => {
    it('연결되지 않은 상태에서 작업 시 에러를 던져야 함', async () => {
      const memoryData = {
        content: 'Test memory',
        type: 'episodic' as const
      };

      await expect(client.remember(memoryData)).rejects.toThrow('Not connected to server');
    });

    it('네트워크 에러를 적절히 처리해야 함', async () => {
      mockAxios.get.mockRejectedValue(new Error('Network error'));

      await expect(client.connect()).rejects.toThrow('Network error');
    });

    it('인증 에러를 적절히 처리해야 함', async () => {
      mockAxios.get.mockRejectedValue({
        response: {
          status: 401,
          data: { error: 'Unauthorized' }
        }
      });

      await expect(client.connect()).rejects.toThrow();
    });
  });

  describe('이벤트 처리', () => {
    it('연결 이벤트를 발생시켜야 함', async () => {
      const eventSpy = vi.fn();
      client.on('connected', eventSpy);

      mockAxios.get.mockResolvedValue({
        data: { status: 'ok', version: '1.0.0' }
      });

      await client.connect();

      expect(eventSpy).toHaveBeenCalled();
    });

    it('연결 해제 이벤트를 발생시켜야 함', async () => {
      const eventSpy = vi.fn();
      client.on('disconnected', eventSpy);

      mockAxios.get.mockResolvedValue({
        data: { status: 'ok', version: '1.0.0' }
      });

      await client.connect();
      await client.disconnect();

      expect(eventSpy).toHaveBeenCalled();
    });

    it('에러 이벤트를 발생시켜야 함', async () => {
      const eventSpy = vi.fn();
      client.on('error', eventSpy);

      mockAxios.get.mockRejectedValue(new Error('Connection failed'));

      try {
        await client.connect();
      } catch (error) {
        // Expected error
      }

      expect(eventSpy).toHaveBeenCalled();
    });
  });
});
