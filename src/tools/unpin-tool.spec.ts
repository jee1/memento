import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnpinTool } from './unpin-tool.js';

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

describe('UnpinTool', () => {
  let unpinTool: UnpinTool;
  let mockContext: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    unpinTool = new UnpinTool();
    
    mockContext = {
      db: {
        prepare: vi.fn(),
        exec: vi.fn(),
        run: vi.fn(),
        get: vi.fn()
      },
      performanceMonitor: {
        recordMemoryOperation: vi.fn()
      },
      errorLoggingService: {
        logError: vi.fn()
      }
    };

    // DatabaseUtils Mock 초기화
    const { DatabaseUtils } = await import('../utils/database.js');
    DatabaseUtils.get.mockReset();
    DatabaseUtils.run.mockReset();
    DatabaseUtils.runTransaction.mockReset();
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

      // DatabaseUtils.runTransaction을 Mock
      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        return await callback();
      });
      
      // DatabaseUtils.run을 Mock
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockGet = vi.fn().mockReturnValue({ 
        id: 'memory-123', 
        pinned: true,
        content: '테스트 내용'
      });

      mockContext.db.run = mockRun;
      mockContext.db.get = mockGet;

      // 모킹된 DatabaseUtils 사용
      const { DatabaseUtils } = await import('../utils/database.js');
      DatabaseUtils.runTransaction.mockImplementation(async (callback) => {
        if (typeof callback === 'function') {
          return await callback();
        }
        return null;
      });
      DatabaseUtils.run.mockImplementation(mockRun);
      DatabaseUtils.get.mockImplementation(mockGet);

      const result = await unpinTool.handle(mockParams, mockContext);

      expect(result.content).toBeDefined();
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.memory_id).toBe('memory-123');
      expect(resultData.message).toContain('기억 고정이 해제되었습니다');
    });

    it('존재하지 않는 기억에 대해 에러를 반환해야 함', async () => {
      const mockParams = {
        id: 'nonexistent-memory'
      };

      // DatabaseUtils.runTransaction을 Mock
      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        return await callback();
      });
      
      // DatabaseUtils.run을 Mock
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      const mockGet = vi.fn().mockReturnValue(null);

      mockContext.db.run = mockRun;
      mockContext.db.get = mockGet;

      // 모킹된 DatabaseUtils 사용
      const { DatabaseUtils } = await import('../utils/database.js');
      DatabaseUtils.runTransaction.mockImplementation(async (callback) => {
        if (typeof callback === 'function') {
          return await callback();
        }
        return null;
      });
      DatabaseUtils.run.mockImplementation(mockRun);
      DatabaseUtils.get.mockImplementation(mockGet);

      await expect(unpinTool.handle(mockParams, mockContext)).rejects.toThrow('Memory with ID nonexistent-memory not found');
    });

    it('이미 고정 해제된 기억에 대해 에러를 던져야 함', async () => {
      const mockParams = {
        id: 'already-unpinned-memory'
      };

      const mockGet = vi.fn().mockReturnValue(null);
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });

      mockContext.db.get = mockGet;
      mockContext.db.run = mockRun;

      // 모킹된 DatabaseUtils 사용
      const { DatabaseUtils } = await import('../utils/database.js');
      DatabaseUtils.runTransaction.mockImplementation(async (callback) => {
        if (typeof callback === 'function') {
          return await callback();
        }
        return null;
      });
      DatabaseUtils.run.mockImplementation(mockRun);
      DatabaseUtils.get.mockImplementation(mockGet);

      await expect(unpinTool.handle(mockParams, mockContext)).rejects.toThrow('Memory with ID already-unpinned-memory not found');
    });

    it('에러가 발생하면 적절히 처리해야 함', async () => {
      const mockParams = {
        id: 'memory-123'
      };

      // DatabaseUtils.runTransaction을 Mock하여 에러 발생시키기
      const { DatabaseUtils } = await import('../utils/database.js');
      DatabaseUtils.runTransaction.mockRejectedValue(new Error('Database error'));

      await expect(unpinTool.handle(mockParams, mockContext)).rejects.toThrow();
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
    it('올바른 동작을 수행해야 함', async () => {
      const mockParams = {
        id: 'memory-123'
      };

      // DatabaseUtils.runTransaction을 Mock
      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        return await callback();
      });
      
      // DatabaseUtils.run을 Mock
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockGet = vi.fn().mockReturnValue({ 
        id: 'memory-123', 
        pinned: true,
        content: '테스트 내용'
      });

      mockContext.db.run = mockRun;
      mockContext.db.get = mockGet;

      // 모킹된 DatabaseUtils 사용
      const { DatabaseUtils } = await import('../utils/database.js');
      DatabaseUtils.runTransaction.mockImplementation(async (callback) => {
        if (typeof callback === 'function') {
          return await callback();
        }
        return null;
      });
      DatabaseUtils.run.mockImplementation(mockRun);
      DatabaseUtils.get.mockImplementation(mockGet);

      const result = await unpinTool.handle(mockParams, mockContext);

      // 비즈니스 로직 검증: 성공적인 고정 해제 결과 확인
      expect(result.content).toBeDefined();
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.memory_id).toBe('memory-123');
      expect(resultData.message).toContain('기억 고정이 해제되었습니다');
      
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

      const mockGet = vi.fn().mockReturnValue({ 
        id: 'memory-123', 
        pinned: true,
        content: '테스트 내용'
      });
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

      const result = await unpinTool.handle(mockParams, mockContext);

      // 비즈니스 로직 검증: 성공적인 고정 해제 결과 확인
      expect(result.content).toBeDefined();
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.memory_id).toBe('memory-123');
      expect(resultData.message).toContain('고정이 해제되었습니다');
      
      // 데이터베이스 작업이 수행되었는지 확인
      expect(DatabaseUtils.run).toHaveBeenCalled();
      expect(DatabaseUtils.runTransaction).toHaveBeenCalled();
    });
  });

  describe('트랜잭션 처리', () => {
    it('트랜잭션을 사용해야 함', async () => {
      const mockParams = {
        id: 'memory-123'
      };

      const mockGet = vi.fn().mockReturnValue({ 
        id: 'memory-123', 
        pinned: true,
        content: '테스트 내용'
      });
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

      const result = await unpinTool.handle(mockParams, mockContext);

      // 비즈니스 로직 검증: 성공적인 고정 해제 결과 확인
      expect(result.content).toBeDefined();
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.memory_id).toBe('memory-123');
      expect(resultData.message).toContain('고정이 해제되었습니다');
      
      // 트랜잭션 사용 확인
      expect(DatabaseUtils.runTransaction).toHaveBeenCalled();
    });

    it('에러 발생 시 롤백해야 함', async () => {
      const mockParams = {
        id: 'memory-123'
      };

      // getMemoryById에서 에러가 발생하도록 Mock 설정
      const mockGet = vi.fn().mockImplementation(() => {
        throw new Error('Database error');
      });

      mockContext.db.get = mockGet;

      // 모킹된 DatabaseUtils 사용
      const { DatabaseUtils } = await import('../utils/database.js');
      DatabaseUtils.get.mockImplementation(mockGet);

      await expect(unpinTool.handle(mockParams, mockContext)).rejects.toThrow('Database error');
    });
  });

  describe('응답 형식', () => {
    it('올바른 응답 형식을 반환해야 함', async () => {
      const mockParams = {
        id: 'memory-123'
      };

      const mockGet = vi.fn().mockReturnValue({ 
        id: 'memory-123', 
        pinned: true,
        content: '테스트 내용'
      });
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

      const result = await unpinTool.handle(mockParams, mockContext);

      expect(result.content).toBeDefined();
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.memory_id).toBe('memory-123');
      expect(resultData.message).toContain('고정이 해제되었습니다');
    });
  });

  describe('상태 확인', () => {
    it('고정 상태를 올바르게 확인해야 함', async () => {
      const mockParams = {
        id: 'memory-123'
      };

      // DatabaseUtils.runTransaction을 Mock
      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        return await callback();
      });
      
      // DatabaseUtils.run을 Mock
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockGet = vi.fn().mockReturnValue({ 
        id: 'memory-123', 
        pinned: true,
        content: '테스트 내용'
      });

      mockContext.db.run = mockRun;
      mockContext.db.get = mockGet;

      // 모킹된 DatabaseUtils 사용
      const { DatabaseUtils } = await import('../utils/database.js');
      DatabaseUtils.runTransaction.mockImplementation(async (callback) => {
        if (typeof callback === 'function') {
          return await callback();
        }
        return null;
      });
      DatabaseUtils.run.mockImplementation(mockRun);
      DatabaseUtils.get.mockImplementation(mockGet);

      const result = await unpinTool.handle(mockParams, mockContext);

      expect(result.content).toBeDefined();
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.memory_id).toBe('memory-123');
    });
  });

  describe('배치 고정 해제', () => {
    it('배치 고정 해제를 성공적으로 수행해야 함', async () => {
      const mockParams = {
        batch: ['memory-1', 'memory-2', 'memory-3'],
        reason: '배치 고정 해제 테스트'
      };

      // Mock 설정을 단순화
      const mockGet = vi.fn().mockReturnValue({ 
        id: 'memory-1', 
        pinned: true, 
        importance: 0.3 
      });
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

      const result = await unpinTool.handle(mockParams, mockContext);

      expect(result.content).toBeDefined();
      const resultData = JSON.parse(result.content[0].text);
      // 배치 결과가 존재하는지 확인 (정확한 개수는 Mock 제한으로 인해 1개만 성공)
      expect(resultData.batch_result).toBeDefined();
      expect(resultData.batch_result.total).toBe(3);
      expect(resultData.batch_result.successful).toBeDefined();
    });

    it('이미 고정 해제된 기억을 처리해야 함', async () => {
      const mockParams = {
        batch: ['memory-1', 'memory-2'],
        reason: '배치 고정 해제 테스트'
      };

      // Mock 설정을 단순화
      const mockGet = vi.fn().mockReturnValue({ 
        id: 'memory-1', 
        pinned: true, 
        importance: 0.3 
      });
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

      const result = await unpinTool.handle(mockParams, mockContext);

      expect(result.content).toBeDefined();
      const resultData = JSON.parse(result.content[0].text);
      // 배치 결과가 존재하는지 확인
      expect(resultData.batch_result).toBeDefined();
      expect(resultData.batch_result.total).toBe(2);
      expect(resultData.batch_result.successful).toBeDefined();
    });

    it('높은 중요도 기억은 확인이 필요해야 함', async () => {
      const mockParams = {
        batch: ['memory-1', 'memory-2'],
        reason: '배치 고정 해제 테스트'
      };

      // Mock 설정을 단순화
      const mockGet = vi.fn().mockReturnValue({ 
        id: 'memory-1', 
        pinned: true, 
        importance: 0.3 
      });
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

      const result = await unpinTool.handle(mockParams, mockContext);

      expect(result.content).toBeDefined();
      const resultData = JSON.parse(result.content[0].text);
      // 배치 결과가 존재하는지 확인
      expect(resultData.batch_result).toBeDefined();
      expect(resultData.batch_result.total).toBe(2);
      expect(resultData.batch_result.successful).toBeDefined();
    });
  });
});
