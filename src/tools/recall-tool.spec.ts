import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RecallTool } from './recall-tool.js';
import { z } from 'zod';

// Mock dependencies
vi.mock('../utils/database.js');

describe('RecallTool', () => {
  let recallTool: RecallTool;
  let mockContext: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    recallTool = new RecallTool();
    
    mockContext = {
      db: {
        prepare: vi.fn(),
        exec: vi.fn()
      },
      services: {
        searchEngine: {
          search: vi.fn()
        },
        hybridSearchEngine: {
          search: vi.fn()
        }
      },
      performanceMonitor: {
        recordSearchOperation: vi.fn()
      },
      errorLoggingService: {
        logError: vi.fn()
      }
    };
  });

  describe('생성자', () => {
    it('올바른 도구 정의를 가져야 함', () => {
      const definition = recallTool.getDefinition();
      
      expect(definition.name).toBe('recall');
      expect(definition.description).toBe('기억을 검색합니다');
      expect(definition.inputSchema).toBeDefined();
    });
  });

  describe('스키마 검증', () => {
    it('유효한 입력을 검증해야 함', () => {
      const validInput = {
        query: 'React Hook',
        filters: {
          type: ['episodic', 'semantic'],
          tags: ['react', 'hooks'],
          limit: 10
        }
      };

      const RecallSchema = z.object({
        query: z.string().min(1),
        filters: z.object({
          type: z.array(z.enum(['episodic', 'semantic'])).optional(),
          tags: z.array(z.string()).optional(),
          limit: z.number().min(1).max(50).optional()
        }).optional()
      });

      expect(() => RecallSchema.parse(validInput)).not.toThrow();
    });

    it('잘못된 입력을 거부해야 함', () => {
      const invalidInput = {
        query: '', // 빈 쿼리
        filters: {
          limit: 100 // 범위 초과
        }
      };

      const RecallSchema = z.object({
        query: z.string().min(1),
        filters: z.object({
          limit: z.number().min(1).max(50).optional()
        }).optional()
      });

      expect(() => RecallSchema.parse(invalidInput)).toThrow();
    });
  });

  describe('execute', () => {
    it('기억을 성공적으로 검색해야 함', async () => {
      const mockParams = {
        query: 'React Hook',
        filters: {
          type: ['episodic'],
          limit: 10
        }
      };

      const mockResults = {
        items: [
          {
            id: 'memory-1',
            content: 'React Hook에 대해 학습했다',
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

      mockContext.services.searchEngine.search.mockResolvedValue(mockResults);

      const result = await recallTool.handle(mockParams, mockContext);

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(result.total_count).toBe(1);
      expect(mockContext.performanceMonitor.recordSearchOperation).toHaveBeenCalled();
    });

    it('빈 검색 결과를 처리해야 함', async () => {
      const mockParams = {
        query: '존재하지 않는 내용'
      };

      const mockResults = {
        items: [],
        total_count: 0,
        query_time: 5
      };

      mockContext.services.searchEngine.search.mockResolvedValue(mockResults);

      const result = await recallTool.handle(mockParams, mockContext);

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(0);
      expect(result.total_count).toBe(0);
    });

    it('하이브리드 검색을 사용해야 함', async () => {
      const mockParams = {
        query: 'React Hook',
        use_hybrid: true
      };

      const mockResults = {
        items: [
          {
            id: 'memory-1',
            content: 'React Hook에 대해 학습했다',
            type: 'episodic',
            score: 0.9
          }
        ],
        total_count: 1,
        query_time: 15
      };

      mockContext.services.hybridSearchEngine.search.mockResolvedValue(mockResults);

      const result = await recallTool.handle(mockParams, mockContext);

      expect(result.success).toBe(true);
      expect(mockContext.services.hybridSearchEngine.search).toHaveBeenCalled();
      expect(mockContext.services.searchEngine.search).not.toHaveBeenCalled();
    });

    it('에러가 발생하면 적절히 처리해야 함', async () => {
      const mockParams = {
        query: '테스트 쿼리'
      };

      mockContext.services.searchEngine.search.mockRejectedValue(new Error('Search error'));

      const result = await recallTool.handle(mockParams, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(mockContext.errorLoggingService.logError).toHaveBeenCalled();
    });
  });

  describe('필터링', () => {
    it('타입 필터를 적용해야 함', async () => {
      const mockParams = {
        query: 'React',
        filters: {
          type: ['episodic', 'semantic']
        }
      };

      const mockResults = {
        items: [],
        total_count: 0,
        query_time: 5
      };

      mockContext.services.searchEngine.search.mockResolvedValue(mockResults);

      await recallTool.handle(mockParams, mockContext);

      expect(mockContext.services.searchEngine.search).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          type: ['episodic', 'semantic']
        })
      );
    });

    it('태그 필터를 적용해야 함', async () => {
      const mockParams = {
        query: 'React',
        filters: {
          tags: ['react', 'hooks']
        }
      };

      const mockResults = {
        items: [],
        total_count: 0,
        query_time: 5
      };

      mockContext.services.searchEngine.search.mockResolvedValue(mockResults);

      await recallTool.handle(mockParams, mockContext);

      expect(mockContext.services.searchEngine.search).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          tags: ['react', 'hooks']
        })
      );
    });

    it('제한 수를 적용해야 함', async () => {
      const mockParams = {
        query: 'React',
        filters: {
          limit: 5
        }
      };

      const mockResults = {
        items: [],
        total_count: 0,
        query_time: 5
      };

      mockContext.services.searchEngine.search.mockResolvedValue(mockResults);

      await recallTool.handle(mockParams, mockContext);

      expect(mockContext.services.searchEngine.search).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          limit: 5
        })
      );
    });
  });

  describe('입력 검증', () => {
    it('필수 필드가 누락되면 에러를 던져야 함', async () => {
      const invalidParams = {
        filters: {
          type: ['episodic']
        }
        // query 누락
      };

      await expect(recallTool.handle(invalidParams, mockContext)).rejects.toThrow();
    });

    it('잘못된 타입 필터를 거부해야 함', async () => {
      const invalidParams = {
        query: '테스트',
        filters: {
          type: ['invalid']
        }
      };

      await expect(recallTool.handle(invalidParams, mockContext)).rejects.toThrow();
    });

    it('범위를 벗어난 제한을 거부해야 함', async () => {
      const invalidParams = {
        query: '테스트',
        filters: {
          limit: 100
        }
      };

      await expect(recallTool.handle(invalidParams, mockContext)).rejects.toThrow();
    });
  });

  describe('성능 모니터링', () => {
    it('검색 성능 메트릭을 기록해야 함', async () => {
      const mockParams = {
        query: '성능 테스트 쿼리'
      };

      const mockResults = {
        items: [],
        total_count: 0,
        query_time: 10
      };

      mockContext.services.searchEngine.search.mockResolvedValue(mockResults);

      await recallTool.handle(mockParams, mockContext);

      expect(mockContext.performanceMonitor.recordSearchOperation).toHaveBeenCalledWith(
        'recall',
        expect.any(Number)
      );
    });
  });

  describe('결과 정렬', () => {
    it('점수 순으로 정렬해야 함', async () => {
      const mockParams = {
        query: 'React'
      };

      const mockResults = {
        items: [
          { id: 'memory-1', content: 'React Hook', score: 0.7 },
          { id: 'memory-2', content: 'React Component', score: 0.9 },
          { id: 'memory-3', content: 'React State', score: 0.8 }
        ],
        total_count: 3,
        query_time: 10
      };

      mockContext.services.searchEngine.search.mockResolvedValue(mockResults);

      const result = await recallTool.handle(mockParams, mockContext);

      expect(result.success).toBe(true);
      expect(result.items[0].score).toBeGreaterThanOrEqual(result.items[1].score);
      expect(result.items[1].score).toBeGreaterThanOrEqual(result.items[2].score);
    });
  });
});
