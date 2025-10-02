import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnpinTool } from './unpin-tool.js';
import { z } from 'zod';

// Mock dependencies
vi.mock('../utils/database.js');

describe('UnpinTool', () => {
  let unpinTool: UnpinTool;
  let mockContext: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    unpinTool = new UnpinTool();
    
    mockContext = {
      db: {
        prepare: vi.fn(),
        exec: vi.fn()
      },
      performanceMonitor: {
        recordMemoryOperation: vi.fn()
      },
      errorLoggingService: {
        logError: vi.fn()
      }
    };
  });

  describe('생성자', () => {
    it('올바른 도구 정의를 가져야 함', () => {
      const definition = unpinTool.getDefinition();
      
      expect(definition.name).toBe('unpin');
      expect(definition.description).toBe('기억 고정을 해제합니다');
      expect(definition.inputSchema).toBeDefined();
    });
  });

  describe('스키마 검증', () => {
    it('유효한 입력을 검증해야 함', () => {
      const validInput = {
        id: 'memory-123'
      };

      const UnpinSchema = z.object({
        id: z.string().min(1)
      });

      expect(() => UnpinSchema.parse(validInput)).not.toThrow();
    });

    it('잘못된 입력을 거부해야 함', () => {
      const invalidInput = {
        id: '' // 빈 ID
      };

      const UnpinSchema = z.object({
        id: z.string().min(1)
      });

      expect(() => UnpinSchema.parse(invalidInput)).toThrow();
    });
  });

  describe('execute', () => {
    it('기억 고정을 성공적으로 해제해야 함', async () => {
      const mockParams = {
        id: 'memory-123'
      };

      const mockStmt = {
        run: vi.fn().mockReturnValue({ changes: 1 }),
        get: vi.fn().mockReturnValue({ 
          id: 'memory-123', 
          pinned: false,
          content: '테스트 내용'
        })
      };

      mockContext.db.prepare.mockReturnValue(mockStmt);

      const result = await unpinTool.handle(mockParams, mockContext);

      expect(result.success).toBe(true);
      expect(result.id).toBe('memory-123');
      expect(result.pinned).toBe(false);
      expect(mockContext.performanceMonitor.recordMemoryOperation).toHaveBeenCalled();
    });

    it('존재하지 않는 기억에 대해 에러를 반환해야 함', async () => {
      const mockParams = {
        id: 'nonexistent-memory'
      };

      const mockStmt = {
        run: vi.fn().mockReturnValue({ changes: 0 }),
        get: vi.fn().mockReturnValue(null)
      };

      mockContext.db.prepare.mockReturnValue(mockStmt);

      const result = await unpinTool.handle(mockParams, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Memory not found');
    });

    it('이미 고정 해제된 기억에 대해 경고를 반환해야 함', async () => {
      const mockParams = {
        id: 'already-unpinned-memory'
      };

      const mockStmt = {
        run: vi.fn().mockReturnValue({ changes: 0 }),
        get: vi.fn().mockReturnValue({ 
          id: 'already-unpinned-memory', 
          pinned: false,
          content: '이미 고정 해제된 내용'
        })
      };

      mockContext.db.prepare.mockReturnValue(mockStmt);

      const result = await unpinTool.handle(mockParams, mockContext);

      expect(result.success).toBe(true);
      expect(result.warning).toContain('not pinned');
    });

    it('에러가 발생하면 적절히 처리해야 함', async () => {
      const mockParams = {
        id: 'memory-123'
      };

      mockContext.db.prepare.mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = await unpinTool.handle(mockParams, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(mockContext.errorLoggingService.logError).toHaveBeenCalled();
    });
  });

  describe('입력 검증', () => {
    it('필수 필드가 누락되면 에러를 던져야 함', async () => {
      const invalidParams = {};

      await expect(unpinTool.handle(invalidParams, mockContext)).rejects.toThrow();
    });

    it('잘못된 ID 형식을 거부해야 함', async () => {
      const invalidParams = {
        id: 123 // 숫자 ID
      };

      await expect(unpinTool.handle(invalidParams, mockContext)).rejects.toThrow();
    });
  });

  describe('데이터베이스 쿼리', () => {
    it('올바른 SQL 쿼리를 실행해야 함', async () => {
      const mockParams = {
        id: 'memory-123'
      };

      const mockStmt = {
        run: vi.fn().mockReturnValue({ changes: 1 }),
        get: vi.fn().mockReturnValue({ 
          id: 'memory-123', 
          pinned: false,
          content: '테스트 내용'
        })
      };

      mockContext.db.prepare.mockReturnValue(mockStmt);

      await unpinTool.handle(mockParams, mockContext);

      expect(mockContext.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE memory_item SET pinned = 0')
      );
      expect(mockContext.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, pinned, content FROM memory_item')
      );
    });
  });

  describe('성능 모니터링', () => {
    it('성능 메트릭을 기록해야 함', async () => {
      const mockParams = {
        id: 'memory-123'
      };

      const mockStmt = {
        run: vi.fn().mockReturnValue({ changes: 1 }),
        get: vi.fn().mockReturnValue({ 
          id: 'memory-123', 
          pinned: false,
          content: '테스트 내용'
        })
      };

      mockContext.db.prepare.mockReturnValue(mockStmt);

      await unpinTool.handle(mockParams, mockContext);

      expect(mockContext.performanceMonitor.recordMemoryOperation).toHaveBeenCalledWith(
        'unpin',
        expect.any(Number)
      );
    });
  });

  describe('트랜잭션 처리', () => {
    it('트랜잭션을 사용해야 함', async () => {
      const mockParams = {
        id: 'memory-123'
      };

      const mockStmt = {
        run: vi.fn().mockReturnValue({ changes: 1 }),
        get: vi.fn().mockReturnValue({ 
          id: 'memory-123', 
          pinned: false,
          content: '테스트 내용'
        })
      };

      mockContext.db.prepare.mockReturnValue(mockStmt);

      await unpinTool.handle(mockParams, mockContext);

      expect(mockContext.db.exec).toHaveBeenCalledWith('BEGIN TRANSACTION');
      expect(mockContext.db.exec).toHaveBeenCalledWith('COMMIT');
    });

    it('에러 발생 시 롤백해야 함', async () => {
      const mockParams = {
        id: 'memory-123'
      };

      mockContext.db.prepare.mockImplementation(() => {
        throw new Error('Database error');
      });

      await unpinTool.handle(mockParams, mockContext);

      expect(mockContext.db.exec).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('응답 형식', () => {
    it('올바른 응답 형식을 반환해야 함', async () => {
      const mockParams = {
        id: 'memory-123'
      };

      const mockStmt = {
        run: vi.fn().mockReturnValue({ changes: 1 }),
        get: vi.fn().mockReturnValue({ 
          id: 'memory-123', 
          pinned: false,
          content: '테스트 내용'
        })
      };

      mockContext.db.prepare.mockReturnValue(mockStmt);

      const result = await unpinTool.handle(mockParams, mockContext);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('pinned');
      expect(result.success).toBe(true);
      expect(result.id).toBe('memory-123');
      expect(result.pinned).toBe(false);
    });
  });

  describe('상태 확인', () => {
    it('고정 상태를 올바르게 확인해야 함', async () => {
      const mockParams = {
        id: 'memory-123'
      };

      const mockStmt = {
        run: vi.fn().mockReturnValue({ changes: 1 }),
        get: vi.fn().mockReturnValue({ 
          id: 'memory-123', 
          pinned: false,
          content: '테스트 내용'
        })
      };

      mockContext.db.prepare.mockReturnValue(mockStmt);

      const result = await unpinTool.handle(mockParams, mockContext);

      expect(result.pinned).toBe(false);
    });
  });
});
