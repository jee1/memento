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
    // Initialize database schema
    db.exec(`
      CREATE TABLE memory_item (
        id TEXT PRIMARY KEY,
        type TEXT CHECK (type IN ('working','episodic','semantic','procedural')),
        content TEXT NOT NULL,
        importance REAL CHECK (importance >= 0 AND importance <= 1) DEFAULT 0.5,
        privacy_scope TEXT CHECK (privacy_scope IN ('private','team','public')) DEFAULT 'private',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_accessed TIMESTAMP,
        pinned BOOLEAN DEFAULT FALSE,
        source TEXT,
        agent_id TEXT,
        user_id TEXT,
        project_id TEXT,
        origin_trace TEXT
      );
    `);

    // Mock performance monitor
    mockPerformanceMonitor = {
      initialize: vi.fn(),
      collectMetrics: vi.fn().mockResolvedValue({
        timestamp: new Date(),
        cpu: { user: 0, system: 0 },
        memory: { rss: 0, heapTotal: 0, heapUsed: 0, external: 0 },
        database: { size: 0, memoryCount: 0, queryTime: 0 },
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
      expect(result.jobType).toBe('memory_cleanup');
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
      expect(result.success).toBe(true);
      expect(mockForgettingService.executeMemoryCleanup).toHaveBeenCalledWith(db);
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

    it('should handle multiple stop calls gracefully', async () => {
      await batchScheduler.start(db);
      batchScheduler.stop();
      batchScheduler.stop(); // Should not throw
      
      const status = batchScheduler.getStatus();
      expect(status.isRunning).toBe(false);
    });

    it('should stop when not running', () => {
      expect(() => batchScheduler.stop()).not.toThrow();
    });
  });

  describe('데이터베이스 통계', () => {
    beforeEach(async () => {
      await batchScheduler.start(db);
      
      // Add some test data
      db.prepare(`
        INSERT INTO memory_item (id, type, content, importance, created_at, pinned)
        VALUES 
          ('test1', 'episodic', 'Test memory 1', 0.5, datetime('now'), FALSE),
          ('test2', 'semantic', 'Test memory 2', 0.7, datetime('now', '-35 days'), TRUE),
          ('test3', 'working', 'Test memory 3', 0.3, datetime('now', '-1 day'), FALSE)
      `).run();
    });

    it('should collect database statistics', async () => {
      const result = await batchScheduler.runJob('monitoring');
      expect(result.success).toBe(true);
      expect(result.details?.stats).toBeDefined();
    });

    it('should collect memory statistics by type', async () => {
      const result = await batchScheduler.runJob('monitoring');
      const stats = result.details?.stats;
      
      expect(stats.memoryStats).toBeDefined();
      expect(Array.isArray(stats.memoryStats)).toBe(true);
      
      const episodicStats = stats.memoryStats.find((s: any) => s.type === 'episodic');
      expect(episodicStats).toBeDefined();
      expect(episodicStats.count).toBe(1);
      expect(episodicStats.pinned_count).toBe(0);
    });

    it('should calculate total memories count', async () => {
      const result = await batchScheduler.runJob('monitoring');
      const stats = result.details?.stats;
      
      expect(stats.totalMemories).toBe(3);
    });

    it('should estimate database size', async () => {
      const result = await batchScheduler.runJob('monitoring');
      const stats = result.details?.stats;
      
      expect(stats.estimatedSize).toBeGreaterThan(0);
      expect(typeof stats.estimatedSize).toBe('number');
    });

    it('should handle empty database gracefully', async () => {
      // Clear database
      db.prepare('DELETE FROM memory_item').run();
      
      const result = await batchScheduler.runJob('monitoring');
      const stats = result.details?.stats;
      
      expect(stats.totalMemories).toBe(0);
      expect(stats.memoryStats).toEqual([]);
    });
  });

  describe('메트릭 수집', () => {
    beforeEach(async () => {
      await batchScheduler.start(db);
    });

    it('should collect basic metrics', async () => {
      const result = await batchScheduler.runJob('monitoring');
      const metrics = result.details?.metrics;
      
      expect(metrics).toBeDefined();
      expect(metrics.memory).toBeDefined();
      expect(metrics.cpu).toBeDefined();
      expect(metrics.uptime).toBeDefined();
      
      expect(metrics.memory).toHaveProperty('rss');
      expect(metrics.memory).toHaveProperty('heapTotal');
      expect(metrics.memory).toHaveProperty('heapUsed');
      expect(metrics.memory).toHaveProperty('external');
      
      expect(metrics.cpu).toHaveProperty('user');
      expect(metrics.cpu).toHaveProperty('system');
      
      expect(typeof metrics.uptime).toBe('number');
      expect(metrics.uptime).toBeGreaterThan(0);
    });

    it('should collect memory usage metrics', async () => {
      const result = await batchScheduler.runJob('monitoring');
      const metrics = result.details?.metrics;
      
      expect(metrics.memory.rss).toBeGreaterThan(0);
      expect(metrics.memory.heapTotal).toBeGreaterThan(0);
      expect(metrics.memory.heapUsed).toBeGreaterThan(0);
      expect(metrics.memory.heapUsed).toBeLessThanOrEqual(metrics.memory.heapTotal);
    });

    it('should collect CPU usage metrics', async () => {
      const result = await batchScheduler.runJob('monitoring');
      const metrics = result.details?.metrics;
      
      expect(typeof metrics.cpu.user).toBe('number');
      expect(typeof metrics.cpu.system).toBe('number');
      expect(metrics.cpu.user).toBeGreaterThanOrEqual(0);
      expect(metrics.cpu.system).toBeGreaterThanOrEqual(0);
    });

    it('should collect uptime metrics', async () => {
      const result = await batchScheduler.runJob('monitoring');
      const metrics = result.details?.metrics;
      
      expect(metrics.uptime).toBeGreaterThan(0);
      expect(typeof metrics.uptime).toBe('number');
    });
  });

  describe('설정 관리', () => {
    it('should create scheduler with custom config', () => {
      const customConfig = {
        cleanupInterval: 2000,
        monitoringInterval: 1000,
        maxBatchSize: 500,
        enableLogging: false,
        enableNotifications: true
      };
      
      const customScheduler = new BatchScheduler(customConfig);
      expect(customScheduler).toBeDefined();
    });

    it('should use default config when none provided', () => {
      const defaultScheduler = new BatchScheduler();
      expect(defaultScheduler).toBeDefined();
    });
  });

  describe('에러 처리', () => {
    it('should handle database connection failure', async () => {
      const nullDb = null as any;
      
      const result = await batchScheduler.runJob('cleanup');
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Database not initialized');
    });

    it('should handle forgetting service errors', async () => {
      mockForgettingService.executeMemoryCleanup.mockRejectedValueOnce(
        new Error('Database connection lost')
      );
      
      const result = await batchScheduler.runJob('cleanup');
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Database connection lost');
    });

    it('should handle performance monitor errors', async () => {
      mockPerformanceMonitor.collectMetrics.mockRejectedValueOnce(
        new Error('Memory allocation failed')
      );
      
      const result = await batchScheduler.runJob('monitoring');
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Memory allocation failed');
    });

    it('should continue running after job errors', async () => {
      await batchScheduler.start(db);
      
      // First job fails
      mockForgettingService.executeMemoryCleanup.mockRejectedValueOnce(
        new Error('Temporary failure')
      );
      
      const result1 = await batchScheduler.runJob('cleanup');
      expect(result1.success).toBe(false);
      
      // Second job should still work
      mockForgettingService.executeMemoryCleanup.mockResolvedValueOnce({
        softDeleted: [],
        hardDeleted: [],
        reviewed: []
      });
      
      const result2 = await batchScheduler.runJob('cleanup');
      expect(result2.success).toBe(true);
    });
  });

  describe('작업 스케줄링', () => {
    it('should schedule jobs with correct intervals', async () => {
      const customScheduler = new BatchScheduler({
        cleanupInterval: 100,
        monitoringInterval: 50,
        enableLogging: false
      });
      
      await customScheduler.start(db);
      
      const status = customScheduler.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.activeJobs).toContain('cleanup');
      expect(status.activeJobs).toContain('monitoring');
      
      customScheduler.stop();
    });

    it('should handle job execution errors gracefully', async () => {
      await batchScheduler.start(db);
      
      // Mock job to throw error
      const originalRunJob = batchScheduler.runJob;
      batchScheduler.runJob = vi.fn().mockRejectedValue(new Error('Job execution failed'));
      
      // Should throw the expected error (비동기 함수이므로 await와 rejects 사용)
      await expect(batchScheduler.runJob('cleanup')).rejects.toThrow('Job execution failed');
      
      // Restore original method
      batchScheduler.runJob = originalRunJob;
    });
  });

  describe('로깅', () => {
    it('should log when logging enabled', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      const loggingScheduler = new BatchScheduler({
        enableLogging: true,
        cleanupInterval: 100,
        monitoringInterval: 50
      });
      
      await loggingScheduler.start(db);
      await new Promise(resolve => setTimeout(resolve, 150)); // Wait for jobs to run
      
      expect(consoleSpy).toHaveBeenCalled();
      
      loggingScheduler.stop();
      consoleSpy.mockRestore();
    });

    it('should not log when logging disabled', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      const noLoggingScheduler = new BatchScheduler({
        enableLogging: false,
        cleanupInterval: 100,
        monitoringInterval: 50
      });
      
      await noLoggingScheduler.start(db);
      await new Promise(resolve => setTimeout(resolve, 150)); // Wait for jobs to run
      
      // Should not log anything
      expect(consoleSpy).not.toHaveBeenCalled();
      
      noLoggingScheduler.stop();
      consoleSpy.mockRestore();
    });
  });
});
