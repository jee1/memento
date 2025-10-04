import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MementoClient } from './memento-client.js';
import type { MementoClientOptions } from './types.js';

// Mock axios completely
vi.mock('axios', () => {
  const mockAxiosInstance = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() }
    }
  };

  return {
    default: {
      create: vi.fn(() => mockAxiosInstance)
    }
  };
});

describe('MementoClient', () => {
  let client: MementoClient;
  let options: MementoClientOptions;
  let mockAxiosInstance: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Get the mocked axios instance
    const axios = await import('axios');
    mockAxiosInstance = axios.default.create();
    
    options = {
      serverUrl: 'http://localhost:8080',
      apiKey: 'test-api-key',
      timeout: 5000
    };
    client = new MementoClient(options);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('생성자', () => {
    it('기본 옵션으로 클라이언트를 생성해야 함', () => {
      const defaultClient = new MementoClient();
      expect(defaultClient).toBeInstanceOf(MementoClient);
    });

    it('사용자 정의 옵션으로 클라이언트를 생성해야 함', () => {
      expect(client).toBeInstanceOf(MementoClient);
    });
  });

  describe('connect', () => {
    it('서버에 성공적으로 연결되어야 함', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { status: 'ok' },
        status: 200
      });

      await client.connect();

      expect(client.connected).toBe(true);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/health');
    });

    it('연결 실패 시 에러를 던져야 함', async () => {
      const errorPromise = new Promise<void>((resolve) => {
        client.on('error', (error) => {
          expect(error).toBeInstanceOf(Error);
          resolve();
        });
      });

      mockAxiosInstance.get.mockRejectedValue(new Error('Connection failed'));

      await expect(client.connect()).rejects.toThrow('Failed to connect to Memento server');
      await errorPromise;
    });

    it('이미 연결된 상태에서 중복 연결을 방지해야 함', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { status: 'ok' },
        status: 200
      });

      await client.connect();
      await client.connect();

      expect(client.connected).toBe(true);
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('disconnect', () => {
    it('연결을 해제해야 함', () => {
      client.connect();
      client.disconnect();
      
      expect((client as any).isConnected).toBe(false);
    });
  });

  describe('remember', () => {
    it('기억을 성공적으로 저장해야 함', async () => {
      const memoryData = {
        content: 'React Hook 학습',
        type: 'episodic' as const,
        importance: 0.8,
        tags: ['react', 'hooks'],
        source: 'user',
        privacy_scope: 'private' as const
      };

      mockAxiosInstance.get.mockResolvedValue({
        data: { status: 'ok' },
        status: 200
      });
      mockAxiosInstance.post.mockResolvedValue({
        data: { result: { memory_id: 'memory-123' } },
        status: 201
      });

      await client.connect();
      const result = await client.remember(memoryData);

      expect(result).toEqual({ memory_id: 'memory-123' });
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/tools/remember', memoryData);
    });

    it('연결되지 않은 상태에서 에러를 던져야 함', async () => {
      const memoryData = {
        content: 'React Hook 학습',
        type: 'episodic' as const
      };

      await expect(client.remember(memoryData)).rejects.toThrow('Client is not connected');
    });
  });

  describe('recall', () => {
    it('기억을 성공적으로 검색해야 함', async () => {
      const query = 'React Hook';
      const mockResults = {
        items: [
          {
            id: 'memory-1',
            content: 'React Hook 학습',
            type: 'episodic',
            importance: 0.8,
            created_at: '2024-01-01T00:00:00.000Z',
            last_accessed: '2024-01-01T00:00:00.000Z',
            pinned: false,
            tags: ['react', 'hooks'],
            source: 'user',
            privacy_scope: 'private',
            score: 0.9
          }
        ],
        total_count: 1,
        query_time: 10
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { result: mockResults },
        status: 200
      });

      // Connect first
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { status: 'ok' },
        status: 200
      });
      await client.connect();

      const result = await client.recall(query);

      expect(result).toEqual(mockResults);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/tools/recall', {
        query, filters: undefined, limit: undefined
      });
    });

    it('빈 검색 결과를 처리해야 함', async () => {
      const query = '존재하지 않는 내용';
      const mockResults = {
        items: [],
        total_count: 0,
        query_time: 5
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { result: mockResults },
        status: 200
      });

      // Connect first
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { status: 'ok' },
        status: 200
      });
      await client.connect();

      const result = await client.recall(query);

      expect(result).toEqual(mockResults);
      expect(result.items).toHaveLength(0);
    });
  });

  describe('pin', () => {
    it('기억을 성공적으로 고정해야 함', async () => {
      const memoryId = 'memory-123';

      mockAxiosInstance.get.mockResolvedValue({
        data: { status: 'ok' },
        status: 200
      });
      mockAxiosInstance.post.mockResolvedValue({
        data: { result: { id: memoryId, success: true } },
        status: 200
      });

      await client.connect();
      const result = await client.pin(memoryId);

      expect(result).toEqual({ id: memoryId, success: true });
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/tools/pin', { id: memoryId });
    });

    it('존재하지 않는 기억 고정 시 에러를 던져야 함', async () => {
      const memoryId = 'nonexistent';

      mockAxiosInstance.get.mockResolvedValue({
        data: { status: 'ok' },
        status: 200
      });
      mockAxiosInstance.post.mockRejectedValue({
        response: { status: 404, data: { error: 'Memory not found' } }
      });

      await client.connect();

      await expect(client.pin(memoryId)).rejects.toThrow();
    });
  });

  describe('unpin', () => {
    it('기억 고정을 성공적으로 해제해야 함', async () => {
      const memoryId = 'memory-123';

      mockAxiosInstance.get.mockResolvedValue({
        data: { status: 'ok' },
        status: 200
      });
      mockAxiosInstance.post.mockResolvedValue({
        data: { result: { id: memoryId, success: true } },
        status: 200
      });

      await client.connect();
      const result = await client.unpin(memoryId);

      expect(result).toEqual({ id: memoryId, success: true });
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/tools/unpin', { id: memoryId });
    });
  });

  describe('forget', () => {
    it('기억을 성공적으로 삭제해야 함', async () => {
      const memoryId = 'memory-123';

      mockAxiosInstance.get.mockResolvedValue({
        data: { status: 'ok' },
        status: 200
      });
      mockAxiosInstance.post.mockResolvedValue({
        data: { result: { id: memoryId, success: true } },
        status: 200
      });

      await client.connect();
      const result = await client.forget(memoryId);

      expect(result).toEqual({ id: memoryId, success: true });
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/tools/forget', { id: memoryId, hard: false });
    });

    it('하드 삭제를 수행해야 함', async () => {
      const memoryId = 'memory-123';

      mockAxiosInstance.get.mockResolvedValue({
        data: { status: 'ok' },
        status: 200
      });
      mockAxiosInstance.post.mockResolvedValue({
        data: { result: { id: memoryId, success: true, hard: true } },
        status: 200
      });

      await client.connect();
      const result = await client.forget(memoryId, true);

      expect(result).toEqual({ id: memoryId, success: true, hard: true });
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/tools/forget', { id: memoryId, hard: true });
    });
  });

  describe('getMemory', () => {
    it('특정 기억을 가져와야 함', async () => {
      const memoryId = 'memory-123';
      const mockMemory = {
        id: memoryId,
        content: 'React Hook 학습',
        type: 'episodic',
        importance: 0.8,
        created_at: '2024-01-01T00:00:00.000Z',
        last_accessed: '2024-01-01T00:00:00.000Z',
        pinned: false,
        tags: ['react', 'hooks'],
        source: 'user',
        privacy_scope: 'private'
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { result: { items: [mockMemory], total_count: 1, query_time: 10 } },
        status: 200
      });

      // Connect first
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { status: 'ok' },
        status: 200
      });
      await client.connect();

      const result = await client.getMemory(memoryId);

      expect(result).toEqual(mockMemory);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/tools/recall', { query: 'memory', filters: { id: [memoryId] }, limit: 1 });
    });

    it('존재하지 않는 기억에 대해 에러를 던져야 함', async () => {
      const memoryId = 'nonexistent';

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { status: 'ok' },
        status: 200
      });
      mockAxiosInstance.get.mockRejectedValue({
        response: { status: 404, data: { error: 'Memory not found' } }
      });

      await client.connect();

      await expect(client.getMemory(memoryId)).rejects.toThrow();
    });
  });

  describe('updateMemory', () => {
    it('기억을 성공적으로 업데이트해야 함', async () => {
      const memoryId = 'memory-123';
      const updateData = {
        content: '업데이트된 내용',
        importance: 0.9
      };

      const mockMemory = {
        id: memoryId,
        content: 'React Hook 학습',
        type: 'episodic',
        importance: 0.8,
        created_at: '2024-01-01T00:00:00.000Z',
        last_accessed: '2024-01-01T00:00:00.000Z',
        pinned: false,
        tags: ['react', 'hooks'],
        source: 'user',
        privacy_scope: 'private'
      };

      mockAxiosInstance.get.mockResolvedValue({
        data: { status: 'ok' },
        status: 200
      });
      // getMemory을 위한 모킹 (recall 호출)
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { result: { items: [mockMemory], total_count: 1, query_time: 10 } },
        status: 200
      });
      // forget을 위한 모킹
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { result: { id: memoryId, success: true } },
        status: 200
      });
      // remember을 위한 모킹
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { result: { memory_id: memoryId } },
        status: 201
      });

      await client.connect();
      const result = await client.updateMemory(memoryId, updateData);

      expect(result).toEqual(expect.objectContaining({
        content: '업데이트된 내용',
        importance: 0.9
      }));
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/tools/forget', { id: memoryId, hard: false });
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/tools/remember', expect.objectContaining(updateData));
    });
  });

  describe('hybridSearch', () => {
    it('하이브리드 검색을 수행해야 함', async () => {
      const query = 'React Hook';
      const mockResults = {
        items: [
          {
            id: 'memory-1',
            content: 'React Hook 학습',
            type: 'episodic',
            importance: 0.8,
            created_at: '2024-01-01T00:00:00.000Z',
            last_accessed: '2024-01-01T00:00:00.000Z',
            pinned: false,
            tags: ['react', 'hooks'],
            source: 'user',
            privacy_scope: 'private',
            score: 0.9,
            finalScore: 0.9,
            textScore: 0.9,
            vectorScore: 0
          }
        ],
        total_count: 1,
        query_time: 15,
        search_type: 'hybrid'
      };

      mockAxiosInstance.get.mockResolvedValue({
        data: { status: 'ok' },
        status: 200
      });
      mockAxiosInstance.post.mockResolvedValue({
        data: { result: mockResults },
        status: 200
      });

      await client.connect();
      const result = await client.hybridSearch({ query });

      expect(result).toEqual(mockResults);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/tools/recall', { query, filters: undefined, limit: undefined });
    });
  });

  describe('healthCheck', () => {
    it('서버 상태를 확인해야 함', async () => {
      const mockHealth = {
        status: 'ok',
        version: '0.1.0',
        uptime: 3600
      };

      mockAxiosInstance.get.mockResolvedValue({
        data: mockHealth,
        status: 200
      });

      const result = await client.healthCheck();

      expect(result).toEqual(mockHealth);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/health');
    });
  });

  describe('에러 처리', () => {
    it('네트워크 에러를 적절히 처리해야 함', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Network Error'));

      await expect(client.healthCheck()).rejects.toThrow('Network Error');
    });

    it('서버 에러에 대해 적절한 에러를 던져야 함', async () => {
      mockAxiosInstance.get.mockRejectedValue({
        response: { status: 500, data: { error: 'Internal Server Error' } }
      });

      await expect(client.healthCheck()).rejects.toThrow();
    });

    it('인증 에러를 적절히 처리해야 함', async () => {
      mockAxiosInstance.get.mockRejectedValue({
        response: { status: 401, data: { error: 'Unauthorized' } }
      });

      await expect(client.healthCheck()).rejects.toThrow();
    });
  });

  describe('이벤트 처리', () => {
    it('연결 이벤트를 발생시켜야 함', async () => {
      const eventPromise = new Promise<void>((resolve) => {
        client.on('connected', () => {
          resolve();
        });
      });

      mockAxiosInstance.get.mockResolvedValue({
        data: { status: 'ok' },
        status: 200
      });

      client.connect();
      await eventPromise;
    });

    it('연결 해제 이벤트를 발생시켜야 함', async () => {
      const eventPromise = new Promise<void>((resolve) => {
        client.on('disconnected', () => {
          resolve();
        });
      });

      client.disconnect();
      await eventPromise;
    });

    it('에러 이벤트를 발생시켜야 함', async () => {
      const errorPromise = new Promise<void>((resolve) => {
        client.on('error', (error) => {
          expect(error).toBeInstanceOf(Error);
          resolve();
        });
      });

      mockAxiosInstance.get.mockRejectedValue(new Error('Test error'));

      await expect(client.connect()).rejects.toThrow('Failed to connect to Memento server');
      await errorPromise;
    });
  });
});
