import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getPerformanceMonitor, PerformanceMonitor } from '../services/performance-monitor.js';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../utils/database.js';

describe('PerformanceMonitor', () => {
  let db: Database.Database;
  let performanceMonitor: PerformanceMonitor;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(':memory:');
    DatabaseUtils.initializeDatabase(db);
    
    performanceMonitor = getPerformanceMonitor();
    performanceMonitor.initialize(db);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe('초기화', () => {
    it('should initialize successfully', () => {
      expect(() => performanceMonitor.initialize(db)).not.toThrow();
    });

    it('should reset state on initialization', () => {
      performanceMonitor.initialize(db);
      const alerts = performanceMonitor.getActiveAlerts();
      expect(alerts).toEqual([]);
    });
  });

  describe('메트릭 수집', () => {
    it('should collect basic metrics', async () => {
      const metrics = await performanceMonitor.collectMetrics();
      
      expect(metrics).toHaveProperty('timestamp');
      expect(metrics).toHaveProperty('cpu');
      expect(metrics).toHaveProperty('memory');
      expect(metrics).toHaveProperty('database');
      expect(metrics).toHaveProperty('uptime');
      
      expect(metrics.cpu).toHaveProperty('user');
      expect(metrics.cpu).toHaveProperty('system');
      expect(metrics.cpu).toHaveProperty('idle');
      
      expect(metrics.memory).toHaveProperty('rss');
      expect(metrics.memory).toHaveProperty('heapTotal');
      expect(metrics.memory).toHaveProperty('heapUsed');
      expect(metrics.memory).toHaveProperty('external');
      expect(metrics.memory).toHaveProperty('arrayBuffers');
      
      expect(metrics.database).toHaveProperty('totalMemories');
      expect(metrics.database).toHaveProperty('size');
      expect(metrics.database).toHaveProperty('queryTime');
    });

    it('should collect database metrics', async () => {
      // Add test data
      DatabaseUtils.runQuery(db, `
        INSERT INTO memory_item (id, type, content, importance, created_at)
        VALUES ('test1', 'episodic', 'Test memory 1', 0.5, datetime('now'))
      `);

      const metrics = await performanceMonitor.collectMetrics();
      
      expect(metrics.database.totalMemories).toBe(1);
      expect(metrics.database.size).toBeGreaterThan(0);
    });

    it('should handle database errors gracefully', async () => {
      // Close database to simulate error
      db.close();
      
      const metrics = await performanceMonitor.collectMetrics();
      
      expect(metrics.database.totalMemories).toBe(0);
      expect(metrics.database.size).toBe(0);
    });
  });

  describe('쿼리 시간 기록', () => {
    it('should record query times', () => {
      performanceMonitor.recordQueryTime(100);
      performanceMonitor.recordQueryTime(200);
      performanceMonitor.recordQueryTime(300);
      
      // Should not throw
      expect(() => performanceMonitor.recordQueryTime(150)).not.toThrow();
    });

    it('should maintain max query times limit', () => {
      // Record more than MAX_QUERY_TIMES (100)
      for (let i = 0; i < 150; i++) {
        performanceMonitor.recordQueryTime(i);
      }
      
      // Should not throw
      expect(() => performanceMonitor.recordQueryTime(999)).not.toThrow();
    });
  });

  describe('알림 관리', () => {
    it('should return active alerts', () => {
      const alerts = performanceMonitor.getActiveAlerts();
      expect(Array.isArray(alerts)).toBe(true);
    });

    it('should resolve alerts', () => {
      // Create a mock alert by triggering high memory usage
      const mockMetrics = {
        timestamp: new Date().toISOString(),
        cpu: { user: 0, system: 0, idle: 0 },
        memory: { rss: 0, heapTotal: 1000, heapUsed: 900, external: 0, arrayBuffers: 0 },
        database: { totalMemories: 0, size: 0, queryTime: 0 },
        uptime: 0
      };

      // Trigger alert by calling checkAlerts directly
      (performanceMonitor as any).checkAlerts(mockMetrics);
      
      const alerts = performanceMonitor.getActiveAlerts();
      expect(alerts.length).toBeGreaterThan(0);
      
      const alertId = alerts[0].id;
      const resolved = performanceMonitor.resolveAlert(alertId);
      
      expect(resolved).toBe(true);
      
      const activeAlerts = performanceMonitor.getActiveAlerts();
      expect(activeAlerts.find(a => a.id === alertId)?.resolved).toBe(true);
    });

    it('should not resolve non-existent alert', () => {
      const resolved = performanceMonitor.resolveAlert('non-existent-id');
      expect(resolved).toBe(false);
    });
  });

  describe('성능 요약', () => {
    it('should return performance summary', () => {
      const summary = performanceMonitor.getPerformanceSummary();
      
      expect(summary).toHaveProperty('activeAlertsCount');
      expect(summary).toHaveProperty('criticalAlertsCount');
      expect(typeof summary.activeAlertsCount).toBe('number');
      expect(typeof summary.criticalAlertsCount).toBe('number');
    });

    it('should calculate averages when metrics available', async () => {
      // Collect some metrics
      await performanceMonitor.collectMetrics();
      await performanceMonitor.collectMetrics();
      
      const summary = performanceMonitor.getPerformanceSummary();
      
      expect(summary.averageCpuUsage).toBeDefined();
      expect(summary.averageMemoryUsage).toBeDefined();
      expect(summary.averageDbSize).toBeDefined();
      expect(summary.averageQueryTime).toBeDefined();
    });
  });

  describe('알림 규칙', () => {
    it('should trigger memory alert on high usage', async () => {
      // Mock high memory usage
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = vi.fn().mockReturnValue({
        rss: 0,
        heapTotal: 1000,
        heapUsed: 900, // 90% usage
        external: 0,
        arrayBuffers: 0
      });

      await performanceMonitor.collectMetrics();
      
      const alerts = performanceMonitor.getActiveAlerts();
      const memoryAlert = alerts.find(a => a.metric === 'memory.heapUsed');
      
      expect(memoryAlert).toBeDefined();
      expect(memoryAlert?.severity).toBe('critical');
      
      // Restore original function
      process.memoryUsage = originalMemoryUsage;
    });

    it('should trigger query time alert on slow queries', async () => {
      // Record slow query times
      performanceMonitor.recordQueryTime(150); // Above threshold of 100
      performanceMonitor.recordQueryTime(200);
      
      await performanceMonitor.collectMetrics();
      
      const alerts = performanceMonitor.getActiveAlerts();
      const queryAlert = alerts.find(a => a.metric === 'database.queryTime');
      
      expect(queryAlert).toBeDefined();
      expect(queryAlert?.severity).toBe('warning');
    });
  });

  describe('메트릭 히스토리', () => {
    it('should maintain metrics history', async () => {
      await performanceMonitor.collectMetrics();
      await performanceMonitor.collectMetrics();
      await performanceMonitor.collectMetrics();
      
      const summary = performanceMonitor.getPerformanceSummary();
      expect(summary.lastMetrics).toBeDefined();
    });

    it('should limit metrics history size', async () => {
      // Collect more than MAX_METRICS_HISTORY (100) metrics
      for (let i = 0; i < 150; i++) {
        await performanceMonitor.collectMetrics();
      }
      
      // Should not throw and should maintain reasonable history size
      const summary = performanceMonitor.getPerformanceSummary();
      expect(summary.lastMetrics).toBeDefined();
    });
  });
});
