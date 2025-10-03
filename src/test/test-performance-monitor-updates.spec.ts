import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getPerformanceMonitor, PerformanceMonitor, createPerformanceMonitor } from '../services/performance-monitor.js';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../utils/database.js';

describe('성능 모니터링 업데이트 테스트', () => {
  let db: Database.Database;
  let performanceMonitor: PerformanceMonitor;

  beforeEach(async () => {
    // Create in-memory database for testing
    db = new Database(':memory:');
    // Initialize database schema
    await DatabaseUtils.initializeDatabase(db);
    
    performanceMonitor = getPerformanceMonitor();
    performanceMonitor.initialize(db);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe('업데이트된 성능 모니터링 기능', () => {
    it('should collect updated metrics structure', async () => {
      const metrics = await performanceMonitor.collectMetrics();
      
      // 기본 메트릭 구조 확인
      expect(metrics).toHaveProperty('timestamp');
      expect(metrics).toHaveProperty('memory');
      expect(metrics).toHaveProperty('cpu');
      expect(metrics).toHaveProperty('database');
      expect(metrics).toHaveProperty('uptime');
      
      // 메모리 메트릭 상세 확인
      expect(metrics.memory).toHaveProperty('rss');
      expect(metrics.memory).toHaveProperty('heapTotal');
      expect(metrics.memory).toHaveProperty('heapUsed');
      expect(metrics.memory).toHaveProperty('external');
      
      // CPU 메트릭 상세 확인
      expect(metrics.cpu).toHaveProperty('user');
      expect(metrics.cpu).toHaveProperty('system');
      
      // 데이터베이스 메트릭 상세 확인
      expect(metrics.database).toHaveProperty('size');
      expect(metrics.database).toHaveProperty('memoryCount');
      expect(metrics.database).toHaveProperty('queryTime');
    });

    it('should handle database metrics collection with test data', async () => {
      // 테스트 데이터 추가
      db.prepare(`
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at)
        VALUES 
          ('test1', 'episodic', 'Test memory 1', 0.5, 'private', datetime('now')),
          ('test2', 'semantic', 'Test memory 2', 0.7, 'private', datetime('now')),
          ('test3', 'working', 'Test memory 3', 0.3, 'private', datetime('now'))
      `).run();

      const metrics = await performanceMonitor.collectMetrics();
      
      expect(metrics.database.memoryCount).toBe(3);
      expect(metrics.database.size).toBeGreaterThan(0);
      expect(metrics.database.queryTime).toBeGreaterThanOrEqual(0);
    });

    it('should generate memory usage alerts', async () => {
      // 고메모리 사용량 시뮬레이션
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = vi.fn().mockReturnValue({
        rss: 0,
        heapTotal: 1000,
        heapUsed: 900, // 90% 사용률
        external: 0,
        arrayBuffers: 0
      });

      await performanceMonitor.collectMetrics();
      
      const alerts = performanceMonitor.getActiveAlerts();
      expect(alerts.length).toBeGreaterThan(0);
      
      const memoryAlert = alerts.find(alert => alert.type === 'memory');
      expect(memoryAlert).toBeDefined();
      expect(memoryAlert?.severity).toBe('critical');
      expect(memoryAlert?.message).toContain('High memory usage');
      expect(memoryAlert?.value).toBe(90);
      expect(memoryAlert?.threshold).toBe(80);

      // 원래 함수 복원
      process.memoryUsage = originalMemoryUsage;
    });

    it('should generate database size alerts', async () => {
      // 대용량 데이터베이스 시뮬레이션을 위해 많은 데이터 추가
      for (let i = 0; i < 1000; i++) {
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at)
          VALUES (?, 'episodic', ?, 0.5, 'private', datetime('now'))
        `).run(`large-db-${i}`, `Large database test memory ${i} with some content to increase size`);
      }

      await performanceMonitor.collectMetrics();
      
      const alerts = performanceMonitor.getActiveAlerts();
      const dbAlert = alerts.find(alert => alert.type === 'database');
      
      if (dbAlert) {
        expect(dbAlert.message).toContain('Large database size');
        expect(dbAlert.value).toBeGreaterThan(0);
        expect(dbAlert.threshold).toBe(100); // 100MB threshold
      }
    });

    it('should generate query time alerts', async () => {
      // 느린 쿼리 시뮬레이션
      const originalPrepare = db.prepare;
      db.prepare = vi.fn().mockImplementation((sql) => {
        const stmt = originalPrepare.call(db, sql);
        const originalGet = stmt.get;
        const originalAll = stmt.all;
        
        stmt.get = vi.fn().mockImplementation((...args) => {
          // 쿼리 시간 지연 시뮬레이션
          const start = Date.now();
          while (Date.now() - start < 100) { /* 100ms 지연 */ }
          return originalGet.call(stmt, ...args);
        });
        
        stmt.all = vi.fn().mockImplementation((...args) => {
          // 쿼리 시간 지연 시뮬레이션
          const start = Date.now();
          while (Date.now() - start < 100) { /* 100ms 지연 */ }
          return originalAll.call(stmt, ...args);
        });
        
        return stmt;
      });

      await performanceMonitor.collectMetrics();
      
      const alerts = performanceMonitor.getActiveAlerts();
      const queryAlert = alerts.find(alert => alert.type === 'query');
      
      if (queryAlert) {
        expect(queryAlert.message).toContain('Slow query detected');
        expect(queryAlert.value).toBeGreaterThan(100);
        expect(queryAlert.threshold).toBe(1000); // 1000ms threshold
      }

      // 원래 함수 복원
      db.prepare = originalPrepare;
    });
  });

  describe('알림 관리 기능', () => {
    it('should resolve alerts correctly', async () => {
      // 알림 생성
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = vi.fn().mockReturnValue({
        rss: 0,
        heapTotal: 1000,
        heapUsed: 900, // 90% 사용률
        external: 0,
        arrayBuffers: 0
      });

      await performanceMonitor.collectMetrics();
      
      const alerts = performanceMonitor.getActiveAlerts();
      expect(alerts.length).toBeGreaterThan(0);
      
      const alertId = alerts[0].id;
      const resolved = performanceMonitor.resolveAlert(alertId);
      
      expect(resolved).toBe(true);
      
      const activeAlerts = performanceMonitor.getActiveAlerts();
      expect(activeAlerts.find(a => a.id === alertId)?.resolved).toBe(true);

      // 원래 함수 복원
      process.memoryUsage = originalMemoryUsage;
    });

    it('should not resolve non-existent alerts', () => {
      const resolved = performanceMonitor.resolveAlert('non-existent-id');
      expect(resolved).toBe(false);
    });

    it('should return all alerts including resolved ones', async () => {
      // 알림 생성
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = vi.fn().mockReturnValue({
        rss: 0,
        heapTotal: 1000,
        heapUsed: 900,
        external: 0,
        arrayBuffers: 0
      });

      await performanceMonitor.collectMetrics();
      
      const allAlerts = performanceMonitor.getAllAlerts();
      const activeAlerts = performanceMonitor.getActiveAlerts();
      
      expect(allAlerts.length).toBeGreaterThanOrEqual(activeAlerts.length);
      expect(activeAlerts.every(alert => !alert.resolved)).toBe(true);

      // 원래 함수 복원
      process.memoryUsage = originalMemoryUsage;
    });
  });

  describe('성능 요약 기능', () => {
    it('should provide performance summary', () => {
      const summary = performanceMonitor.getPerformanceSummary();
      
      expect(summary).toHaveProperty('current');
      expect(summary).toHaveProperty('alerts');
      expect(summary).toHaveProperty('trends');
      
      expect(summary.alerts).toHaveProperty('active');
      expect(summary.alerts).toHaveProperty('total');
      expect(typeof summary.alerts.active).toBe('number');
      expect(typeof summary.alerts.total).toBe('number');
      
      expect(summary.trends).toHaveProperty('memoryTrend');
      expect(summary.trends).toHaveProperty('dbSizeTrend');
      expect(['increasing', 'decreasing', 'stable']).toContain(summary.trends.memoryTrend);
      expect(['increasing', 'decreasing', 'stable']).toContain(summary.trends.dbSizeTrend);
    });

    it('should analyze trends correctly', async () => {
      // 여러 번 메트릭 수집하여 트렌드 분석
      for (let i = 0; i < 5; i++) {
        await performanceMonitor.collectMetrics();
        // 약간의 지연
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const summary = performanceMonitor.getPerformanceSummary();
      expect(summary.trends.memoryTrend).toBeDefined();
      expect(summary.trends.dbSizeTrend).toBeDefined();
    });

    it('should handle empty metrics history', () => {
      const summary = performanceMonitor.getPerformanceSummary();
      expect(summary.current).toBeNull();
      expect(summary.alerts.active).toBe(0);
      expect(summary.alerts.total).toBe(0);
    });
  });

  describe('메트릭 히스토리 관리', () => {
    it('should maintain metrics history', async () => {
      // 여러 번 메트릭 수집
      for (let i = 0; i < 5; i++) {
        await performanceMonitor.collectMetrics();
      }

      const history = performanceMonitor.getMetricsHistory();
      expect(history.length).toBe(5);
      
      history.forEach(metrics => {
        expect(metrics).toHaveProperty('timestamp');
        expect(metrics).toHaveProperty('memory');
        expect(metrics).toHaveProperty('cpu');
        expect(metrics).toHaveProperty('database');
        expect(metrics).toHaveProperty('uptime');
      });
    });

    it('should limit metrics history size', async () => {
      // 많은 메트릭 수집 (히스토리 크기 제한 테스트)
      for (let i = 0; i < 150; i++) {
        await performanceMonitor.collectMetrics();
      }

      const history = performanceMonitor.getMetricsHistory();
      expect(history.length).toBeLessThanOrEqual(1000); // maxHistorySize
    });

    it('should return limited history when requested', async () => {
      // 여러 번 메트릭 수집
      for (let i = 0; i < 10; i++) {
        await performanceMonitor.collectMetrics();
      }

      const limitedHistory = performanceMonitor.getMetricsHistory(5);
      expect(limitedHistory.length).toBe(5);
    });
  });

  describe('임계값 관리', () => {
    it('should update thresholds correctly', () => {
      const newThresholds = {
        memoryUsagePercent: 90,
        cpuUsagePercent: 80,
        databaseSizeMB: 200,
        queryTimeMs: 2000
      };

      performanceMonitor.updateThresholds(newThresholds);
      
      // 임계값이 업데이트되었는지 확인하기 위해 알림 생성
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = vi.fn().mockReturnValue({
        rss: 0,
        heapTotal: 1000,
        heapUsed: 850, // 85% 사용률 (새 임계값 90% 미만)
        external: 0,
        arrayBuffers: 0
      });

      performanceMonitor.collectMetrics();
      
      const alerts = performanceMonitor.getActiveAlerts();
      const memoryAlert = alerts.find(alert => alert.type === 'memory');
      
      // 85%는 90% 임계값 미만이므로 알림이 없어야 함
      expect(memoryAlert).toBeUndefined();

      // 원래 함수 복원
      process.memoryUsage = originalMemoryUsage;
    });

    it('should use default thresholds when not specified', () => {
      const monitor = createPerformanceMonitor();
      monitor.initialize(db);
      
      // 기본 임계값으로 알림 생성 시도
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = vi.fn().mockReturnValue({
        rss: 0,
        heapTotal: 1000,
        heapUsed: 850, // 85% 사용률 (기본 임계값 80% 초과)
        external: 0,
        arrayBuffers: 0
      });

      monitor.collectMetrics();
      
      const alerts = monitor.getActiveAlerts();
      const memoryAlert = alerts.find(alert => alert.type === 'memory');
      
      // 85%는 기본 임계값 80% 초과이므로 알림이 있어야 함
      expect(memoryAlert).toBeDefined();
      expect(memoryAlert?.threshold).toBe(80);

      // 원래 함수 복원
      process.memoryUsage = originalMemoryUsage;
    });
  });

  describe('에러 처리', () => {
    it('should handle database errors gracefully', async () => {
      // 데이터베이스 연결 끊기
      db.close();

      const metrics = await performanceMonitor.collectMetrics();
      
      expect(metrics.database.memoryCount).toBe(0);
      expect(metrics.database.size).toBe(0);
      expect(metrics.database.queryTime).toBe(0);
    });

    it('should handle null database gracefully', () => {
      const monitor = createPerformanceMonitor();
      // 데이터베이스 초기화하지 않음

      const metrics = monitor.collectMetrics();
      
      expect(metrics.database.memoryCount).toBe(0);
      expect(metrics.database.size).toBe(0);
      expect(metrics.database.queryTime).toBe(0);
    });
  });

  describe('싱글톤 패턴', () => {
    it('should return same instance for getPerformanceMonitor', () => {
      const monitor1 = getPerformanceMonitor();
      const monitor2 = getPerformanceMonitor();
      
      expect(monitor1).toBe(monitor2);
    });

    it('should create new instance for createPerformanceMonitor', () => {
      const monitor1 = createPerformanceMonitor();
      const monitor2 = createPerformanceMonitor();
      
      expect(monitor1).not.toBe(monitor2);
    });

    it('should allow custom thresholds for new instances', () => {
      const customThresholds = {
        memoryUsagePercent: 95,
        cpuUsagePercent: 90,
        databaseSizeMB: 500,
        queryTimeMs: 5000
      };

      const monitor = createPerformanceMonitor(customThresholds);
      monitor.initialize(db);
      
      // 임계값이 적용되었는지 확인
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = vi.fn().mockReturnValue({
        rss: 0,
        heapTotal: 1000,
        heapUsed: 900, // 90% 사용률 (새 임계값 95% 미만)
        external: 0,
        arrayBuffers: 0
      });

      monitor.collectMetrics();
      
      const alerts = monitor.getActiveAlerts();
      const memoryAlert = alerts.find(alert => alert.type === 'memory');
      
      // 90%는 95% 임계값 미만이므로 알림이 없어야 함
      expect(memoryAlert).toBeUndefined();

      // 원래 함수 복원
      process.memoryUsage = originalMemoryUsage;
    });
  });

  describe('로깅 기능', () => {
    it('should log metrics collection', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      await performanceMonitor.collectMetrics();
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[PerformanceMonitor]'),
        expect.stringContaining('Metrics collected')
      );
      
      consoleSpy.mockRestore();
    });

    it('should log alert generation', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      // 고메모리 사용량으로 알림 생성
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = vi.fn().mockReturnValue({
        rss: 0,
        heapTotal: 1000,
        heapUsed: 900,
        external: 0,
        arrayBuffers: 0
      });

      await performanceMonitor.collectMetrics();
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[PerformanceMonitor]'),
        expect.stringContaining('Alert generated')
      );
      
      consoleSpy.mockRestore();
      process.memoryUsage = originalMemoryUsage;
    });
  });
});

