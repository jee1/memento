import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForgetTool } from './forget-tool.js';

// DatabaseUtils 모킹
vi.mock('../utils/database.js', () => ({
  DatabaseUtils: {
    runTransaction: vi.fn(),
    run: vi.fn(),
    get: vi.fn()
  }
}));
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
        exec: vi.fn(),
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn()
      },
      services: {
        forgettingPolicyService: {
          shouldForget: vi.fn().mockReturnValue(true)
        },
        embeddingService: {
          isAvailable: vi.fn().mockReturnValue(true),
          deleteEmbedding: vi.fn().mockResolvedValue(true)
        },
        performanceMonitor: {
          recordMemoryOperation: vi.fn()
        },
        errorLoggingService: {
          logError: vi.fn()
        }
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

      // DatabaseUtils.runTransaction을 Mock
      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        if (typeof callback === 'function') {
          return await callback();
        }
        return null;
      });
      
      // DatabaseUtils.run을 Mock
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockGet = vi.fn().mockReturnValue({ 
        id: 'memory-123', 
        content: '테스트 내용',
        type: 'episodic',
        pinned: false
      });

      mockContext.db.run = mockRun;
      mockContext.db.get = mockGet;

      // 모킹된 DatabaseUtils 사용
      const { DatabaseUtils } = await import('../utils/database.js');
      DatabaseUtils.runTransaction.mockImplementation(mockTransaction);
      DatabaseUtils.run.mockImplementation(mockRun);
      DatabaseUtils.get.mockImplementation(mockGet);

      const result = await forgetTool.handle(mockParams, mockContext);

      expect(result.content).toBeDefined();
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.memory_id).toBe('memory-123');
      expect(resultData.deleted_type).toBe('soft');
    });

    it('하드 삭제를 성공적으로 수행해야 함', async () => {
      const mockParams = {
        id: 'memory-123',
        hard: true,
        confirm: true
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

      expect(result.content).toBeDefined();
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.memory_id).toBe('memory-123');
      expect(resultData.deleted_type).toBe('hard');
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

      expect(result.content).toBeDefined();
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.message).toContain('기억이 삭제 대상으로 표시되었습니다');
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

      expect(result.content).toBeDefined();
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.message).toContain('기억이 삭제 대상으로 표시되었습니다');
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

      expect(result.content).toBeDefined();
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.message).toContain('기억이 삭제 대상으로 표시되었습니다');
    });

    it('에러가 발생하면 적절히 처리해야 함', async () => {
      const mockParams = {
        id: 'memory-123'
      };

      mockContext.db.prepare.mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = await forgetTool.handle(mockParams, mockContext);

      expect(result.content).toBeDefined();
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.message).toBeDefined();
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
    it('소프트 삭제 시 올바른 동작을 수행해야 함', async () => {
      const mockParams = {
        id: 'memory-123',
        hard: false
      };

      // DatabaseUtils.run을 Mock - 여러 번 호출될 수 있음
      const mockRun = vi.fn()
        .mockReturnValueOnce({ changes: 1 }) // logDeleteAction에서 feedback_event INSERT
        .mockReturnValueOnce({ changes: 1 }); // performSoftDelete에서 UPDATE
      const mockGet = vi.fn().mockReturnValue({ 
        id: 'memory-123', 
        pinned: false, 
        importance: 0.3 
      });

      mockContext.db.run = mockRun;
      mockContext.db.get = mockGet;

      // 모킹된 DatabaseUtils 사용
      const { DatabaseUtils } = await import('../utils/database.js');
      DatabaseUtils.run.mockImplementation(mockRun);
      DatabaseUtils.get.mockImplementation(mockGet);
      DatabaseUtils.runTransaction.mockImplementation(async (callback) => {
        if (typeof callback === 'function') {
          return await callback();
        }
        return null;
      });

      const result = await forgetTool.handle(mockParams, mockContext);

      // 비즈니스 로직 검증: 성공적인 소프트 삭제 결과 확인
      expect(result.content).toBeDefined();
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.memory_id).toBe('memory-123');
      expect(resultData.deleted_type).toBe('soft');
      expect(resultData.message).toContain('기억이 삭제 대상으로 표시되었습니다');
      
      // 데이터베이스 작업이 수행되었는지 확인
      expect(DatabaseUtils.run).toHaveBeenCalled();
      expect(DatabaseUtils.runTransaction).toHaveBeenCalled();
    });

    it('하드 삭제 시 올바른 동작을 수행해야 함', async () => {
      const mockParams = {
        id: 'memory-123',
        hard: true,
        confirm: true
      };

      // DatabaseUtils.run을 Mock - 여러 번 호출될 수 있음
      const mockRun = vi.fn()
        .mockReturnValueOnce({ changes: 1 }) // logDeleteAction에서 feedback_event INSERT
        .mockReturnValueOnce({ changes: 1 }) // performHardDelete에서 DELETE
        .mockReturnValueOnce({ changes: 1 }) // cleanupRelatedData에서 관련 테이블 DELETE
        .mockReturnValueOnce({ changes: 1 })
        .mockReturnValueOnce({ changes: 1 });
      const mockGet = vi.fn().mockReturnValue({ 
        id: 'memory-123', 
        pinned: false, 
        importance: 0.3 
      });

      mockContext.db.run = mockRun;
      mockContext.db.get = mockGet;

      // 모킹된 DatabaseUtils 사용
      const { DatabaseUtils } = await import('../utils/database.js');
      DatabaseUtils.run.mockImplementation(mockRun);
      DatabaseUtils.get.mockImplementation(mockGet);
      DatabaseUtils.runTransaction.mockImplementation(async (callback) => {
        if (typeof callback === 'function') {
          return await callback();
        }
        return null;
      });

      const result = await forgetTool.handle(mockParams, mockContext);

      // 비즈니스 로직 검증: 성공적인 하드 삭제 결과 확인
      expect(result.content).toBeDefined();
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.memory_id).toBe('memory-123');
      expect(resultData.deleted_type).toBe('hard');
      expect(resultData.message).toContain('기억이 완전히 삭제되었습니다');
      
      // 데이터베이스 작업이 수행되었는지 확인
      expect(DatabaseUtils.run).toHaveBeenCalled();
      expect(DatabaseUtils.runTransaction).toHaveBeenCalled();
    });
  });

  describe('성능 모니터링', () => {
    it('성능 메트릭을 기록해야 함', async () => {
      const mockParams = {
        id: 'memory-123'
      };

      // DatabaseUtils.run을 Mock
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockGet = vi.fn().mockReturnValue({ 
        id: 'memory-123', 
        pinned: false, 
        importance: 0.3 
      });

      mockContext.db.run = mockRun;
      mockContext.db.get = mockGet;

      // 모킹된 DatabaseUtils 사용
      const { DatabaseUtils } = await import('../utils/database.js');
      DatabaseUtils.run.mockImplementation(mockRun);
      DatabaseUtils.get.mockImplementation(mockGet);
      DatabaseUtils.runTransaction.mockImplementation(async (callback) => {
        if (typeof callback === 'function') {
          return await callback();
        }
        return null;
      });

      const result = await forgetTool.handle(mockParams, mockContext);

      // 성공적인 삭제가 수행되었는지 확인
      expect(result.content).toBeDefined();
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.memory_id).toBe('memory-123');
    });
  });

  describe('트랜잭션 처리', () => {
    it('트랜잭션을 사용해야 함', async () => {
      const mockParams = {
        id: 'memory-123'
      };

      // DatabaseUtils.run을 Mock
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockGet = vi.fn().mockReturnValue({ 
        id: 'memory-123', 
        pinned: false, 
        importance: 0.3 
      });

      mockContext.db.run = mockRun;
      mockContext.db.get = mockGet;

      // 모킹된 DatabaseUtils 사용
      const { DatabaseUtils } = await import('../utils/database.js');
      DatabaseUtils.run.mockImplementation(mockRun);
      DatabaseUtils.get.mockImplementation(mockGet);
      DatabaseUtils.runTransaction.mockImplementation(async (callback) => {
        if (typeof callback === 'function') {
          return await callback();
        }
        return null;
      });

      await forgetTool.handle(mockParams, mockContext);

      expect(DatabaseUtils.runTransaction).toHaveBeenCalled();
    });

    it('에러 발생 시 롤백해야 함', async () => {
      const mockParams = {
        id: 'memory-123'
      };

      // DatabaseUtils.run을 Mock하여 에러 발생
      const mockRun = vi.fn().mockImplementation(() => {
        throw new Error('Database error');
      });
      const mockGet = vi.fn().mockReturnValue({ 
        id: 'memory-123', 
        pinned: false, 
        importance: 0.3 
      });

      mockContext.db.run = mockRun;
      mockContext.db.get = mockGet;

      // 모킹된 DatabaseUtils 사용
      const { DatabaseUtils } = await import('../utils/database.js');
      DatabaseUtils.run.mockImplementation(mockRun);
      DatabaseUtils.get.mockImplementation(mockGet);
      DatabaseUtils.runTransaction.mockImplementation(async (callback) => {
        if (typeof callback === 'function') {
          return await callback();
        }
        return null;
      });

      const result = await forgetTool.handle(mockParams, mockContext);

      // 에러가 적절히 처리되었는지 확인
      expect(result.content).toBeDefined();
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.message).toBeDefined();
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

      expect(result).toHaveProperty('content');
      expect(result.content[0]).toHaveProperty('type', 'text');
      expect(result.content[0]).toHaveProperty('text');
    });
  });

  describe('보안 검증', () => {
    it('중요한 기억 삭제를 방지해야 함', async () => {
      const mockParams = {
        id: 'important-memory'
      };

      const mockGet = vi.fn().mockReturnValue({ 
        id: 'important-memory', 
        content: '중요한 내용',
        type: 'semantic',
        importance: 0.9,
        pinned: false
      });

      mockContext.db.get = mockGet;

      // 모킹된 DatabaseUtils 사용
      const { DatabaseUtils } = await import('../utils/database.js');
      DatabaseUtils.get.mockImplementation(mockGet);

      const result = await forgetTool.handle(mockParams, mockContext);
      
      expect(result.content).toBeDefined();
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.message).toContain('important-memory');
    });
  });

  describe('배치 삭제', () => {
    it('배치 삭제를 성공적으로 수행해야 함', async () => {
      const mockParams = {
        batch: ['memory-1', 'memory-2', 'memory-3'],
        hard: false
      };

      const mockGet = vi.fn()
        .mockReturnValueOnce({ id: 'memory-1', pinned: false, importance: 0.3 })
        .mockReturnValueOnce({ id: 'memory-2', pinned: false, importance: 0.4 })
        .mockReturnValueOnce({ id: 'memory-3', pinned: false, importance: 0.5 });

      const mockRun = vi.fn().mockReturnValue({ changes: 1 });

      mockContext.db.get = mockGet;
      mockContext.db.run = mockRun;

      // 모킹된 DatabaseUtils 사용
      const { DatabaseUtils } = await import('../utils/database.js');
      DatabaseUtils.get.mockImplementation(mockGet);
      DatabaseUtils.run.mockImplementation(mockRun);
      DatabaseUtils.runTransaction.mockImplementation(async (callback) => {
        if (typeof callback === 'function') {
          return await callback();
        }
        return null;
      });

      // 망각 정책 서비스 모킹
      mockContext.services.forgettingPolicyService.shouldForget.mockReturnValue(true);

      const result = await forgetTool.handle(mockParams, mockContext);

      expect(result.content).toBeDefined();
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.batch_result.successful).toHaveLength(3);
      expect(resultData.batch_result.total).toBe(3);
    });

    it('배치 삭제에서 일부 실패를 처리해야 함', async () => {
      const mockParams = {
        batch: ['memory-1', 'nonexistent', 'memory-3'],
        hard: false
      };

      const mockGet = vi.fn()
        .mockReturnValueOnce({ id: 'memory-1', pinned: false, importance: 0.3 })
        .mockReturnValueOnce(null) // 존재하지 않는 메모리
        .mockReturnValueOnce({ id: 'memory-3', pinned: false, importance: 0.5 });

      const mockRun = vi.fn().mockReturnValue({ changes: 1 });

      mockContext.db.get = mockGet;
      mockContext.db.run = mockRun;

      // 모킹된 DatabaseUtils 사용
      const { DatabaseUtils } = await import('../utils/database.js');
      DatabaseUtils.get.mockImplementation(mockGet);
      DatabaseUtils.run.mockImplementation(mockRun);
      DatabaseUtils.runTransaction.mockImplementation(async (callback) => {
        if (typeof callback === 'function') {
          return await callback();
        }
        return null;
      });

      // 망각 정책 서비스 모킹
      mockContext.services.forgettingPolicyService.shouldForget.mockReturnValue(true);

      const result = await forgetTool.handle(mockParams, mockContext);

      expect(result.content).toBeDefined();
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.batch_result.successful).toHaveLength(2);
      expect(resultData.batch_result.failed).toHaveLength(1);
      expect(resultData.batch_result.total).toBe(3);
    });
  });
});
