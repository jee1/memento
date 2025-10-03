import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getBatchScheduler, BatchScheduler } from '../services/batch-scheduler.js';
import { getPerformanceMonitor } from '../services/performance-monitor.js';
import { ForgettingPolicyService } from '../services/forgetting-policy-service.js';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../utils/database.js';

// Mock dependencies
import { vi } from 'vitest';
vi.mock('../services/performance-monitor.js');
vi.mock('../services/forgetting-policy-service.js');

describe('BatchScheduler', () => {
  let db: Database.Database;
  let batchScheduler: BatchScheduler;
  let mockPerformanceMonitor: any;
  let mockForgettingService: any;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(':memory:');
    DatabaseUtils.initializeDatabase(db);

    // Mock performance monitor
    mockPerformanceMonitor = {
      initialize: vi.fn(),
      collectMetrics: vi.fn().mockResolvedValue({
        timestamp: new Date().toISOString(),
        cpu: { user: 0, system: 0, idle: 0 },
        memory: { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 },
        database: { totalMemories: 0, size: 0, queryTime: 0 },
        uptime: 0
      }),
      getActiveAlerts: vi.fn().mockReturnValue([])
    };

    // Mock forgetting service
    mockForgettingService = {
      executeMemoryCleanup: vi.fn().mockResolvedValue({
        softDeleted: [],
        hardDeleted: [],
        reviewed: []
      })
    };

    // Setup mocks
    vi.mocked(getPerformanceMonitor).mockReturnValue(mockPerformanceMonitor);
    vi.mocked(ForgettingPolicyService).mockImplementation(() => mockForgettingService);

    batchScheduler = getBatchScheduler({
      cleanupInterval: 1000, // 1초 for testing
      monitoringInterval: 500, // 0.5초 for testing
      enableLogging: false
    });
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    batchScheduler.stop();
  });

  describe('초기화', () => {
    it('should initialize successfully', async () => {
      await expect(batchScheduler.start(db)).resolves.not.toThrow();
      expect(mockPerformanceMonitor.initialize).toHaveBeenCalledWith(db);
    });

    it('should not start if already running', async () => {
      await batchScheduler.start(db);
      await expect(batchScheduler.start(db)).rejects.toThrow('BatchScheduler is already running');
    });
  });

  describe('상태 관리', () => {
    it('should return correct status when not running', () => {
      const status = batchScheduler.getStatus();
      expect(status.isRunning).toBe(false);
      expect(status.activeJobs).toEqual([]);
    });

    it('should return correct status when running', async () => {
      await batchScheduler.start(db);
      const status = batchScheduler.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.activeJobs).toContain('cleanup');
      expect(status.activeJobs).toContain('monitoring');
    });
  });

  describe('작업 실행', () => {
    beforeEach(async () => {
      await batchScheduler.start(db);
    });

    it('should run cleanup job successfully', async () => {
      const result = await batchScheduler.runJob('cleanup');
      expect(result.jobType).toBe('cleanup');
      expect(result.success).toBe(true);
      expect(mockForgettingService.executeMemoryCleanup).toHaveBeenCalledWith(db);
    });

    it('should run monitoring job successfully', async () => {
      const result = await batchScheduler.runJob('monitoring');
      expect(result.jobType).toBe('monitoring');
      expect(result.success).toBe(true);
      expect(mockPerformanceMonitor.collectMetrics).toHaveBeenCalled();
    });

    it('should handle unknown job type', async () => {
      await expect(batchScheduler.runJob('unknown' as any)).rejects.toThrow('Unknown job type: unknown');
    });
  });

  describe('메모리 정리', () => {
    beforeEach(async () => {
      await batchScheduler.start(db);
    });

    it('should execute memory cleanup with correct parameters', async () => {
      const result = await batchScheduler.runJob('cleanup');
      expect(mockForgettingService.executeMemoryCleanup).toHaveBeenCalledWith(db);
      expect(result.success).toBe(true);
    });

    it('should handle cleanup errors gracefully', async () => {
      mockForgettingService.executeMemoryCleanup.mockRejectedValueOnce(new Error('Cleanup failed'));
      const result = await batchScheduler.runJob('cleanup');
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Cleanup failed');
    });
  });

  describe('성능 모니터링', () => {
    beforeEach(async () => {
      await batchScheduler.start(db);
    });

    it('should collect performance metrics', async () => {
      const result = await batchScheduler.runJob('monitoring');
      expect(mockPerformanceMonitor.collectMetrics).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should handle monitoring errors gracefully', async () => {
      mockPerformanceMonitor.collectMetrics.mockRejectedValueOnce(new Error('Monitoring failed'));
      const result = await batchScheduler.runJob('monitoring');
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Monitoring failed');
    });
  });

  describe('중지', () => {
    it('should stop all jobs', async () => {
      await batchScheduler.start(db);
      batchScheduler.stop();
      
      const status = batchScheduler.getStatus();
      expect(status.isRunning).toBe(false);
      expect(status.activeJobs).toEqual([]);
    });
  });

  describe('데이터베이스 통계', () => {
    beforeEach(async () => {
      await batchScheduler.start(db);
      
      // Add some test data
      DatabaseUtils.runQuery(db, `
        INSERT INTO memory_item (id, type, content, importance, created_at)
        VALUES ('test1', 'episodic', 'Test memory 1', 0.5, datetime('now'))
      `);
    });

    it('should collect database statistics', async () => {
      const result = await batchScheduler.runJob('monitoring');
      expect(result.success).toBe(true);
      expect(result.details?.stats).toBeDefined();
    });
  });
});
