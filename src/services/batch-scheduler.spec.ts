import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BatchScheduler, createBatchScheduler, resetBatchScheduler } from './batch-scheduler.js';
import Database from 'better-sqlite3';
import { ForgettingPolicyService } from './forgetting-policy-service.js';
import { getPerformanceMonitor } from './performance-monitor.js';

// Mock dependencies
vi.mock('better-sqlite3');
vi.mock('./forgetting-policy-service.js');
vi.mock('./performance-monitor.js');

describe('BatchScheduler', () => {
  let batchScheduler: BatchScheduler;
  let mockDb: any;
  let mockForgettingService: any;
  let mockPerformanceMonitor: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock database
    mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({ count: 10 }),
        all: vi.fn().mockReturnValue([])
      })
    };
    vi.mocked(Database).mockImplementation(() => mockDb);

    // Mock forgetting service
    mockForgettingService = {
      executeMemoryCleanup: vi.fn().mockResolvedValue({
        totalProcessed: 5,
        softDeleted: [],
        hardDeleted: [],
        reviewed: []
      })
    };
    vi.mocked(ForgettingPolicyService).mockImplementation(() => mockForgettingService);

    // Mock performance monitor
    mockPerformanceMonitor = {
      initialize: vi.fn(),
      collectMetrics: vi.fn().mockResolvedValue({
        memory: { heapUsed: 1000000, heapTotal: 2000000 },
        database: { size: 5000000, queryTime: 10 }
      }),
      getActiveAlerts: vi.fn().mockReturnValue([])
    };
    vi.mocked(getPerformanceMonitor).mockReturnValue(mockPerformanceMonitor);

    batchScheduler = createBatchScheduler();
  });

  afterEach(() => {
    resetBatchScheduler();
    vi.restoreAllMocks();
  });

  describe('생성자', () => {
    it('기본 설정으로 초기화되어야 함', () => {
      const scheduler = createBatchScheduler();
      const status = scheduler.getStatus();
      
      expect(status.isRunning).toBe(false);
      expect(status.config.cleanupInterval).toBe(60 * 60 * 1000); // 1시간
      expect(status.config.monitoringInterval).toBe(5 * 60 * 1000); // 5분
      expect(status.config.healthCheckInterval).toBe(30 * 1000); // 30초
      expect(status.config.maxBatchSize).toBe(1000);
      expect(status.config.enableLogging).toBe(true);
      expect(status.config.maxConcurrentJobs).toBe(3);
    });

    it('사용자 정의 설정으로 초기화되어야 함', () => {
      const customConfig = {
        cleanupInterval: 30 * 60 * 1000, // 30분
        maxBatchSize: 500,
        enableLogging: false
      };
      
      const scheduler = createBatchScheduler(customConfig);
      const status = scheduler.getStatus();
      
      expect(status.config.cleanupInterval).toBe(30 * 60 * 1000);
      expect(status.config.maxBatchSize).toBe(500);
      expect(status.config.enableLogging).toBe(false);
    });
  });

  describe('설정 검증', () => {
    it('유효하지 않은 cleanupInterval에 대해 에러를 던져야 함', () => {
      expect(() => {
        createBatchScheduler({ cleanupInterval: 30000 }); // 30초는 너무 짧음
      }).toThrow('cleanupInterval must be at least 1 minute');
    });

    it('유효하지 않은 monitoringInterval에 대해 에러를 던져야 함', () => {
      expect(() => {
        createBatchScheduler({ monitoringInterval: 5000 }); // 5초는 너무 짧음
      }).toThrow('monitoringInterval must be at least 10 seconds');
    });

    it('유효하지 않은 maxBatchSize에 대해 에러를 던져야 함', () => {
      expect(() => {
        createBatchScheduler({ maxBatchSize: 0 });
      }).toThrow('maxBatchSize must be at least 1');
    });

    it('유효하지 않은 maxConcurrentJobs에 대해 에러를 던져야 함', () => {
      expect(() => {
        createBatchScheduler({ maxConcurrentJobs: 0 });
      }).toThrow('maxConcurrentJobs must be at least 1');
    });

    it('유효하지 않은 jobTimeout에 대해 에러를 던져야 함', () => {
      expect(() => {
        createBatchScheduler({ jobTimeout: 500 }); // 0.5초는 너무 짧음
      }).toThrow('jobTimeout must be at least 1 second');
    });
  });

  describe('스케줄러 시작/중지', () => {
    it('스케줄러를 시작할 수 있어야 함', async () => {
      await batchScheduler.start(mockDb);
      
      const status = batchScheduler.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.activeJobs).toContain('cleanup');
      expect(status.activeJobs).toContain('monitoring');
      expect(status.activeJobs).toContain('healthcheck');
    });

    it('이미 실행 중인 스케줄러를 다시 시작하면 에러를 던져야 함', async () => {
      await batchScheduler.start(mockDb);
      
      await expect(batchScheduler.start(mockDb)).rejects.toThrow('BatchScheduler is already running');
    });

    it('스케줄러를 중지할 수 있어야 함', async () => {
      await batchScheduler.start(mockDb);
      await batchScheduler.stop();
      
      const status = batchScheduler.getStatus();
      expect(status.isRunning).toBe(false);
    });

    it('이미 중지된 스케줄러를 중지해도 에러가 발생하지 않아야 함', async () => {
      await expect(batchScheduler.stop()).resolves.not.toThrow();
    });
  });

  describe('작업 실행', () => {
    beforeEach(async () => {
      await batchScheduler.start(mockDb);
    });

    it('메모리 정리 작업을 실행할 수 있어야 함', async () => {
      const result = await batchScheduler.runJob('cleanup');
      
      expect(result.jobType).toBe('memory_cleanup');
      expect(result.success).toBe(true);
      expect(result.processed).toBe(5);
      expect(mockForgettingService.executeMemoryCleanup).toHaveBeenCalledWith(mockDb);
    });

    it('모니터링 작업을 실행할 수 있어야 함', async () => {
      const result = await batchScheduler.runJob('monitoring');
      
      expect(result.jobType).toBe('monitoring');
      expect(result.success).toBe(true);
      expect(mockPerformanceMonitor.collectMetrics).toHaveBeenCalled();
    });

    it('헬스체크 작업을 실행할 수 있어야 함', async () => {
      const result = await batchScheduler.runJob('healthcheck');
      
      expect(result.jobType).toBe('healthcheck');
      expect(result.success).toBe(true);
      expect(mockDb.prepare).toHaveBeenCalledWith('SELECT 1');
    });

    it('알 수 없는 작업 타입에 대해 에러를 던져야 함', async () => {
      await expect(batchScheduler.runJob('unknown' as any)).rejects.toThrow('Unknown job type: unknown');
    });
  });

  describe('에러 처리', () => {
    beforeEach(async () => {
      await batchScheduler.start(mockDb);
    });

    it('데이터베이스가 없을 때 메모리 정리 작업이 실패해야 함', async () => {
      const scheduler = createBatchScheduler();
      const result = await scheduler.runJob('cleanup');
      
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Database not initialized');
    });

    it('메모리 정리 작업에서 에러가 발생하면 적절히 처리되어야 함', async () => {
      mockForgettingService.executeMemoryCleanup.mockRejectedValue(new Error('Cleanup failed'));
      
      const result = await batchScheduler.runJob('cleanup');
      
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Cleanup failed');
    });

    it('모니터링 작업에서 에러가 발생하면 적절히 처리되어야 함', async () => {
      mockPerformanceMonitor.collectMetrics.mockRejectedValue(new Error('Metrics collection failed'));
      
      const result = await batchScheduler.runJob('monitoring');
      
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Metrics collection failed');
    });

    it('헬스체크 작업에서 에러가 발생하면 적절히 처리되어야 함', async () => {
      mockDb.prepare.mockImplementation(() => {
        throw new Error('Database connection failed');
      });
      
      const result = await batchScheduler.runJob('healthcheck');
      
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Database connection failed');
    });
  });

  describe('상태 조회', () => {
    it('상태를 올바르게 반환해야 함', async () => {
      await batchScheduler.start(mockDb);
      
      const status = batchScheduler.getStatus();
      
      expect(status.isRunning).toBe(true);
      expect(status.activeJobs).toHaveLength(3);
      expect(status.uptime).toBeGreaterThanOrEqual(0); // 0 이상이면 됨
      expect(status.config).toBeDefined();
    });

    it('상세 통계를 올바르게 반환해야 함', async () => {
      await batchScheduler.start(mockDb);
      
      const stats = batchScheduler.getDetailedStats();
      
      expect(stats.status.isRunning).toBe(true);
      expect(stats.health.memoryUsage).toBeGreaterThan(0);
      expect(stats.health.runningJobs).toBeGreaterThanOrEqual(0); // 0 이상이면 됨
      expect(stats.jobs).toHaveLength(3);
    });
  });

  describe('설정 업데이트', () => {
    it('설정을 업데이트할 수 있어야 함', () => {
      const newConfig = {
        maxBatchSize: 2000,
        enableLogging: false
      };
      
      batchScheduler.updateConfig(newConfig);
      
      const status = batchScheduler.getStatus();
      expect(status.config.maxBatchSize).toBe(2000);
      expect(status.config.enableLogging).toBe(false);
    });

    it('유효하지 않은 설정으로 업데이트하면 에러를 던져야 함', () => {
      expect(() => {
        batchScheduler.updateConfig({ maxBatchSize: 0 });
      }).toThrow('maxBatchSize must be at least 1');
    });
  });

  describe('작업 관리', () => {
    beforeEach(async () => {
      await batchScheduler.start(mockDb);
    });

    it('특정 작업을 중지할 수 있어야 함', () => {
      const result = batchScheduler.stopJob('cleanup');
      
      expect(result).toBe(true);
      
      const status = batchScheduler.getStatus();
      expect(status.activeJobs).not.toContain('cleanup');
    });

    it('존재하지 않는 작업을 중지하면 false를 반환해야 함', () => {
      const result = batchScheduler.stopJob('nonexistent');
      
      expect(result).toBe(false);
    });

    it('작업을 재시작할 수 있어야 함', () => {
      // 먼저 작업이 실행 중인지 확인
      const statusBefore = batchScheduler.getStatus();
      expect(statusBefore.activeJobs).toContain('cleanup');
      
      // 작업 중지
      const stopResult = batchScheduler.stopJob('cleanup');
      expect(stopResult).toBe(true);
      
      // 중지 후 상태 확인
      const statusAfterStop = batchScheduler.getStatus();
      expect(statusAfterStop.activeJobs).not.toContain('cleanup');
      
      // 작업 재시작 (restartJob은 내부적으로 stopJob을 호출하지 않음)
      const result = batchScheduler.restartJob('cleanup');
      expect(result).toBe(true);
      
      // 재시작 후 상태 확인
      const statusAfterRestart = batchScheduler.getStatus();
      expect(statusAfterRestart.activeJobs).toContain('cleanup');
    });
  });

  describe('로깅', () => {
    it('로깅이 비활성화되면 로그를 출력하지 않아야 함', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      const scheduler = createBatchScheduler({ enableLogging: false });
      scheduler.updateConfig({ enableLogging: false });
      
      // 로깅이 비활성화된 상태에서 설정 업데이트
      scheduler.updateConfig({ maxBatchSize: 1500 });
      
      expect(consoleSpy).not.toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });
  });
});
