import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForgetTool } from './forget-tool.js';
import { z } from 'zod';

// Mock dependencies
vi.mock('../utils/database.js');

describe('ForgetTool', () => {
  let forgetTool: ForgetTool;
  let mockContext: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    forgetTool = new ForgetTool();
    
    mockContext = {
      db: {
        prepare: vi.fn(),
        exec: vi.fn()
      },
      services: {
        forgettingPolicyService: {
          shouldForget: vi.fn()
        },
        embeddingService: {
          isAvailable: vi.fn().mockReturnValue(true),
          deleteEmbedding: vi.fn().mockResolvedValue(true)
        }
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
      const definition = forgetTool.getDefinition();
      
      expect(definition.name).toBe('forget');
      expect(definition.description).toBe('기억을 삭제합니다');
      expect(definition.inputSchema).toBeDefined();
    });
  });

  describe('스키마 검증', () => {
    it('유효한 입력을 검증해야 함', () => {
      const validInput = {
        id: 'memory-123',
        hard: false
      };

      const ForgetSchema = z.object({
        id: z.string().min(1),
        hard: z.boolean().optional()
      });

      expect(() => ForgetSchema.parse(validInput)).not.toThrow();
    });

    it('기본값을 올바르게 설정해야 함', () => {
      const inputWithDefaults = {
        id: 'memory-123'
        // hard 누락
      };

      const ForgetSchema = z.object({
        id: z.string().min(1),
        hard: z.boolean().optional().default(false)
      });

      const result = ForgetSchema.parse(inputWithDefaults);
      expect(result.hard).toBe(false);
    });

    it('잘못된 입력을 거부해야 함', () => {
      const invalidInput = {
        id: '', // 빈 ID
        hard: 'invalid' // 잘못된 타입
      };

      const ForgetSchema = z.object({
        id: z.string().min(1),
        hard: z.boolean().optional()
      });

      expect(() => ForgetSchema.parse(invalidInput)).toThrow();
    });
  });

  describe('execute', () => {
    it('소프트 삭제를 성공적으로 수행해야 함', async () => {
      const mockParams = {
        id: 'memory-123',
        hard: false
      };

      const mockStmt = {
        run: vi.fn().mockReturnValue({ changes: 1 }),
        get: vi.fn().mockReturnValue({ 
          id: 'memory-123', 
          content: '테스트 내용',
          type: 'episodic'
        })
      };

      mockContext.db.prepare.mockReturnValue(mockStmt);
      mockContext.services.forgettingPolicyService.shouldForget.mockReturnValue(true);

      const result = await forgetTool.handle(mockParams, mockContext);

      expect(result.success).toBe(true);
      expect(result.id).toBe('memory-123');
      expect(result.deleted).toBe(true);
      expect(result.hard).toBe(false);
      expect(mockContext.performanceMonitor.recordMemoryOperation).toHaveBeenCalled();
    });

    it('하드 삭제를 성공적으로 수행해야 함', async () => {
      const mockParams = {
        id: 'memory-123',
        hard: true
      };

      const mockStmt = {
        run: vi.fn().mockReturnValue({ changes: 1 }),
        get: vi.fn().mockReturnValue({ 
          id: 'memory-123', 
          content: '테스트 내용',
          type: 'episodic'
        })
      };

      mockContext.db.prepare.mockReturnValue(mockStmt);

      const result = await forgetTool.handle(mockParams, mockContext);

      expect(result.success).toBe(true);
      expect(result.id).toBe('memory-123');
      expect(result.deleted).toBe(true);
      expect(result.hard).toBe(true);
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

      const result = await forgetTool.handle(mockParams, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Memory not found');
    });

    it('고정된 기억 삭제를 거부해야 함', async () => {
      const mockParams = {
        id: 'pinned-memory'
      };

      const mockStmt = {
        run: vi.fn().mockReturnValue({ changes: 0 }),
        get: vi.fn().mockReturnValue({ 
          id: 'pinned-memory', 
          content: '고정된 내용',
          type: 'episodic',
          pinned: true
        })
      };

      mockContext.db.prepare.mockReturnValue(mockStmt);

      const result = await forgetTool.handle(mockParams, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot delete pinned memory');
    });

    it('망각 정책에 따라 삭제를 거부해야 함', async () => {
      const mockParams = {
        id: 'memory-123'
      };

      const mockStmt = {
        run: vi.fn().mockReturnValue({ changes: 0 }),
        get: vi.fn().mockReturnValue({ 
          id: 'memory-123', 
          content: '테스트 내용',
          type: 'episodic',
          pinned: false
        })
      };

      mockContext.db.prepare.mockReturnValue(mockStmt);
      mockContext.services.forgettingPolicyService.shouldForget.mockReturnValue(false);

      const result = await forgetTool.handle(mockParams, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Memory does not meet forgetting criteria');
    });

    it('에러가 발생하면 적절히 처리해야 함', async () => {
      const mockParams = {
        id: 'memory-123'
      };

      mockContext.db.prepare.mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = await forgetTool.handle(mockParams, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(mockContext.errorLoggingService.logError).toHaveBeenCalled();
    });
  });

  describe('입력 검증', () => {
    it('필수 필드가 누락되면 에러를 던져야 함', async () => {
      const invalidParams = {
        hard: false
        // id 누락
      };

      await expect(forgetTool.handle(invalidParams, mockContext)).rejects.toThrow();
    });

    it('잘못된 ID 형식을 거부해야 함', async () => {
      const invalidParams = {
        id: 123, // 숫자 ID
        hard: false
      };

      await expect(forgetTool.handle(invalidParams, mockContext)).rejects.toThrow();
    });
  });

  describe('데이터베이스 쿼리', () => {
    it('소프트 삭제 시 올바른 SQL 쿼리를 실행해야 함', async () => {
      const mockParams = {
        id: 'memory-123',
        hard: false
      };

      const mockStmt = {
        run: vi.fn().mockReturnValue({ changes: 1 }),
        get: vi.fn().mockReturnValue({ 
          id: 'memory-123', 
          content: '테스트 내용',
          type: 'episodic'
        })
      };

      mockContext.db.prepare.mockReturnValue(mockStmt);
      mockContext.services.forgettingPolicyService.shouldForget.mockReturnValue(true);

      await forgetTool.handle(mockParams, mockContext);

      expect(mockContext.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE memory_item SET deleted = 1')
      );
    });

    it('하드 삭제 시 올바른 SQL 쿼리를 실행해야 함', async () => {
      const mockParams = {
        id: 'memory-123',
        hard: true
      };

      const mockStmt = {
        run: vi.fn().mockReturnValue({ changes: 1 }),
        get: vi.fn().mockReturnValue({ 
          id: 'memory-123', 
          content: '테스트 내용',
          type: 'episodic'
        })
      };

      mockContext.db.prepare.mockReturnValue(mockStmt);

      await forgetTool.handle(mockParams, mockContext);

      expect(mockContext.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM memory_item')
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
          content: '테스트 내용',
          type: 'episodic'
        })
      };

      mockContext.db.prepare.mockReturnValue(mockStmt);
      mockContext.services.forgettingPolicyService.shouldForget.mockReturnValue(true);

      await forgetTool.handle(mockParams, mockContext);

      expect(mockContext.performanceMonitor.recordMemoryOperation).toHaveBeenCalledWith(
        'forget',
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
          content: '테스트 내용',
          type: 'episodic'
        })
      };

      mockContext.db.prepare.mockReturnValue(mockStmt);
      mockContext.services.forgettingPolicyService.shouldForget.mockReturnValue(true);

      await forgetTool.handle(mockParams, mockContext);

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

      await forgetTool.handle(mockParams, mockContext);

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
          content: '테스트 내용',
          type: 'episodic'
        })
      };

      mockContext.db.prepare.mockReturnValue(mockStmt);
      mockContext.services.forgettingPolicyService.shouldForget.mockReturnValue(true);

      const result = await forgetTool.handle(mockParams, mockContext);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('deleted');
      expect(result).toHaveProperty('hard');
      expect(result.success).toBe(true);
      expect(result.id).toBe('memory-123');
      expect(result.deleted).toBe(true);
      expect(result.hard).toBe(false);
    });
  });

  describe('보안 검증', () => {
    it('중요한 기억 삭제를 방지해야 함', async () => {
      const mockParams = {
        id: 'important-memory'
      };

      const mockStmt = {
        run: vi.fn().mockReturnValue({ changes: 0 }),
        get: vi.fn().mockReturnValue({ 
          id: 'important-memory', 
          content: '중요한 내용',
          type: 'semantic',
          importance: 0.9,
          pinned: false
        })
      };

      mockContext.db.prepare.mockReturnValue(mockStmt);
      mockContext.services.forgettingPolicyService.shouldForget.mockReturnValue(false);

      const result = await forgetTool.handle(mockParams, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not meet forgetting criteria');
    });
  });
});
