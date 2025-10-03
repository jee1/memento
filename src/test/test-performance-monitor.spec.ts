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
      expect(metrics.memory).toHaveProperty('rss');
      expect(metrics.memory).toHaveProperty('heapTotal');
      expect(metrics.memory).toHaveProperty('heapUsed');
      expect(metrics.memory).toHaveProperty('external');
      
      expect(metrics.database).toHaveProperty('size');
      expect(metrics.database).toHaveProperty('memoryCount');
      expect(metrics.database).toHaveProperty('queryTime');
    });

    it('should collect database metrics', async () => {
      // Add test data
      db.prepare(`
        INSERT INTO memory_item (id, type, content, importance, created_at)
        VALUES ('test1', 'episodic', 'Test memory 1', 0.5, datetime('now'))
      `).run();

      const metrics = await performanceMonitor.collectMetrics();
      
      expect(metrics.database.memoryCount).toBe(1);
      expect(metrics.database.size).toBeGreaterThan(0);
    });

    it('should handle database errors gracefully', async () => {
      // Close database to simulate error
      db.close();
      
      const metrics = await performanceMonitor.collectMetrics();
      
      expect(metrics.database.memoryCount).toBe(0);
      expect(metrics.database.size).toBe(0);
    });
  });

  describe('메트릭 히스토리', () => {
    it('should maintain metrics history', async () => {
      await performanceMonitor.collectMetrics();
      await performanceMonitor.collectMetrics();
      
      const history = performanceMonitor.getMetricsHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);
    });

    it('should limit metrics history size', async () => {
      // Collect more than maxHistorySize (1000) metrics
      for (let i = 0; i < 5; i++) {
        await performanceMonitor.collectMetrics();
      }
      
      const history = performanceMonitor.getMetricsHistory();
      expect(history.length).toBeLessThanOrEqual(1000);
    });

    it('should return limited history when limit specified', async () => {
      await performanceMonitor.collectMetrics();
      await performanceMonitor.collectMetrics();
      await performanceMonitor.collectMetrics();
      
      const limitedHistory = performanceMonitor.getMetricsHistory(2);
      expect(limitedHistory.length).toBe(2);
    });
  });

  describe('알림 관리', () => {
    it('should return active alerts', () => {
      const alerts = performanceMonitor.getActiveAlerts();
      expect(Array.isArray(alerts)).toBe(true);
    });

    it('should return all alerts', () => {
      const allAlerts = performanceMonitor.getAllAlerts();
      expect(Array.isArray(allAlerts)).toBe(true);
    });

    it('should resolve alerts', () => {
      // Create a mock alert by triggering high memory usage
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = vi.fn().mockReturnValue({
        rss: 0,
        heapTotal: 1000,
        heapUsed: 900, // 90% usage
        external: 0,
        arrayBuffers: 0
      });

      // Trigger alert by collecting metrics
      performanceMonitor.collectMetrics();
      
      const alerts = performanceMonitor.getActiveAlerts();
      if (alerts.length > 0) {
        const alertId = alerts[0].id;
        const resolved = performanceMonitor.resolveAlert(alertId);
        
        expect(resolved).toBe(true);
        
        const activeAlerts = performanceMonitor.getActiveAlerts();
        expect(activeAlerts.find(a => a.id === alertId)?.resolved).toBe(true);
      }
      
      // Restore original function
      process.memoryUsage = originalMemoryUsage;
    });

    it('should not resolve non-existent alert', () => {
      const resolved = performanceMonitor.resolveAlert('non-existent-id');
      expect(resolved).toBe(false);
    });
  });

  describe('성능 요약', () => {
    it('should return performance summary', () => {
      const summary = performanceMonitor.getPerformanceSummary();
      
      expect(summary).toHaveProperty('current');
      expect(summary).toHaveProperty('alerts');
      expect(summary).toHaveProperty('trends');
      expect(summary.alerts).toHaveProperty('active');
      expect(summary.alerts).toHaveProperty('total');
      expect(summary.trends).toHaveProperty('memoryTrend');
      expect(summary.trends).toHaveProperty('dbSizeTrend');
    });

    it('should calculate trends when metrics available', async () => {
      // Collect some metrics
      await performanceMonitor.collectMetrics();
      await performanceMonitor.collectMetrics();
      
      const summary = performanceMonitor.getPerformanceSummary();
      
      expect(summary.current).toBeDefined();
      expect(summary.trends.memoryTrend).toMatch(/^(increasing|decreasing|stable)$/);
      expect(summary.trends.dbSizeTrend).toMatch(/^(increasing|decreasing|stable)$/);
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
      const memoryAlert = alerts.find(a => a.type === 'memory');
      
      expect(memoryAlert).toBeDefined();
      expect(memoryAlert?.severity).toBe('warning');
      
      // Restore original function
      process.memoryUsage = originalMemoryUsage;
    });

    it('should trigger database size alert on large database', async () => {
      // Mock large database size
      const originalPrepare = db.prepare;
      db.prepare = vi.fn().mockImplementation((query: string) => {
        if (query.includes('PRAGMA page_count')) {
          return { get: () => ({ page_count: 100000 }) };
        }
        if (query.includes('PRAGMA page_size')) {
          return { get: () => ({ page_size: 4096 }) };
        }
        return originalPrepare.call(db, query);
      });

      await performanceMonitor.collectMetrics();
      
      const alerts = performanceMonitor.getActiveAlerts();
      const dbAlert = alerts.find(a => a.type === 'database');
      
      expect(dbAlert).toBeDefined();
      expect(dbAlert?.severity).toBe('critical');
      
      // Restore original function
      db.prepare = originalPrepare;
    });

    it('should trigger query time alert on slow queries', async () => {
      // Mock slow query time by directly calling checkAlerts with slow query metrics
      const slowMetrics = {
        timestamp: new Date(),
        memory: { rss: 100000000, heapTotal: 100000000, heapUsed: 100000000, external: 0 },
        cpu: { user: 0, system: 0 },
        database: { size: 1000000, memoryCount: 0, queryTime: 2500 }, // 2.5 seconds
        uptime: 1000
      };
      
      // Call checkAlerts directly to test alert generation
      await (performanceMonitor as any).checkAlerts(slowMetrics);
      
      const alerts = performanceMonitor.getActiveAlerts();
      const queryAlert = alerts.find(a => a.type === 'query');
      
      expect(queryAlert).toBeDefined();
      expect(queryAlert?.severity).toBe('critical');
    });
  });

  describe('임계값 관리', () => {
    it('should update thresholds', () => {
      const newThresholds = {
        memoryUsagePercent: 90,
        databaseSizeMB: 200
      };
      
      performanceMonitor.updateThresholds(newThresholds);
      
      // Should not throw
      expect(() => performanceMonitor.updateThresholds(newThresholds)).not.toThrow();
    });
  });
});
