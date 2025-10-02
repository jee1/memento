import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PerformanceAlertService, AlertLevel, AlertType, PerformanceAlert, AlertThreshold } from './performance-alert-service.js';
import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Mock fs module
vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn()
}));

// Mock path module
vi.mock('path', () => ({
  join: vi.fn((...args) => args.join('/'))
}));

describe('PerformanceAlertService', () => {
  let service: PerformanceAlertService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PerformanceAlertService('./test-logs');
  });

  afterEach(() => {
    service.cleanup();
  });

  describe('constructor', () => {
    it('should initialize with default settings', () => {
      expect(service).toBeInstanceOf(PerformanceAlertService);
    });

    it('should create log directory if it does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false);
      
      new PerformanceAlertService('./new-logs');
      
      expect(mkdirSync).toHaveBeenCalledWith('./new-logs', { recursive: true });
    });

    it('should handle log directory creation errors gracefully', () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(mkdirSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      // Should not throw
      expect(() => new PerformanceAlertService('./invalid-logs')).not.toThrow();
    });
  });

  describe('checkPerformanceMetric', () => {
    it('should trigger alert when threshold is exceeded', () => {
      const alerts = service.checkPerformanceMetric(
        AlertType.RESPONSE_TIME,
        150, // Exceeds warning threshold of 100
        { component: 'test-component' }
      );

      expect(alerts).toHaveLength(1);
      expect(alerts[0].level).toBe(AlertLevel.WARNING);
      expect(alerts[0].type).toBe(AlertType.RESPONSE_TIME);
      expect(alerts[0].value).toBe(150);
      expect(alerts[0].threshold).toBe(100);
    });

    it('should trigger critical alert when critical threshold is exceeded', () => {
      const alerts = service.checkPerformanceMetric(
        AlertType.RESPONSE_TIME,
        600, // Exceeds critical threshold of 500
        { component: 'test-component' }
      );

      expect(alerts).toHaveLength(1);
      expect(alerts[0].level).toBe(AlertLevel.CRITICAL);
      expect(alerts[0].value).toBe(600);
      expect(alerts[0].threshold).toBe(500);
    });

    it('should not trigger alert when threshold is not exceeded', () => {
      const alerts = service.checkPerformanceMetric(
        AlertType.RESPONSE_TIME,
        50, // Below warning threshold
        { component: 'test-component' }
      );

      expect(alerts).toHaveLength(0);
    });

    it('should respect cooldown period', () => {
      // First alert
      service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150, { component: 'test' });
      
      // Second alert within cooldown (should not trigger)
      const alerts = service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 200, { component: 'test' });

      expect(alerts).toHaveLength(0);
    });

    it('should trigger multiple alerts for different metrics', () => {
      const responseTimeAlerts = service.checkPerformanceMetric(
        AlertType.RESPONSE_TIME,
        150,
        { component: 'test' }
      );

      const memoryAlerts = service.checkPerformanceMetric(
        AlertType.MEMORY_USAGE,
        150,
        { component: 'test' }
      );

      expect(responseTimeAlerts).toHaveLength(1);
      expect(memoryAlerts).toHaveLength(1);
    });

    it('should include context in alert', () => {
      const context = {
        component: 'database-service',
        operation: 'query',
        userId: 'user123',
        sessionId: 'session456'
      };

      const alerts = service.checkPerformanceMetric(
        AlertType.RESPONSE_TIME,
        150,
        context
      );

      expect(alerts[0].context).toEqual(context);
    });
  });

  describe('resolveAlert', () => {
    it('should resolve existing alert', () => {
      // Create an alert first
      service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150, { component: 'test' });
      const activeAlerts = service.getActiveAlerts();
      const alertId = activeAlerts[0].id;

      const result = service.resolveAlert(alertId, 'admin', 'Fixed performance issue');

      expect(result).toBe(true);
      
      const resolvedAlert = service.getActiveAlerts().find(a => a.id === alertId);
      expect(resolvedAlert).toBeUndefined();
    });

    it('should return false for non-existent alert', () => {
      const result = service.resolveAlert('non-existent-id');

      expect(result).toBe(false);
    });

    it('should use default resolvedBy when not provided', () => {
      service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150, { component: 'test' });
      const activeAlerts = service.getActiveAlerts();
      const alertId = activeAlerts[0].id;

      const result = service.resolveAlert(alertId);

      expect(result).toBe(true);
    });
  });

  describe('getAlertStats', () => {
    beforeEach(() => {
      // Create some test alerts
      service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150, { component: 'test' });
      service.checkPerformanceMetric(AlertType.MEMORY_USAGE, 150, { component: 'test' });
      service.checkPerformanceMetric(AlertType.ERROR_RATE, 15, { component: 'test' });
    });

    it('should return alert statistics', () => {
      const stats = service.getAlertStats();

      expect(stats.totalAlerts).toBeGreaterThan(0);
      expect(stats.alertsByLevel).toBeDefined();
      expect(stats.alertsByType).toBeDefined();
      expect(stats.recentAlerts).toBeDefined();
      expect(stats.averageResolutionTime).toBeGreaterThanOrEqual(0);
      expect(stats.activeAlerts).toBeGreaterThan(0);
    });

    it('should filter by time period', () => {
      const stats = service.getAlertStats(1); // Last 1 hour

      expect(stats.totalAlerts).toBeGreaterThanOrEqual(0);
    });

    it('should count alerts by level', () => {
      const stats = service.getAlertStats();

      expect(stats.alertsByLevel[AlertLevel.WARNING]).toBeGreaterThan(0);
      expect(stats.alertsByLevel[AlertLevel.CRITICAL]).toBeGreaterThan(0);
    });

    it('should count alerts by type', () => {
      const stats = service.getAlertStats();

      expect(stats.alertsByType[AlertType.RESPONSE_TIME]).toBeGreaterThan(0);
      expect(stats.alertsByType[AlertType.MEMORY_USAGE]).toBeGreaterThan(0);
    });
  });

  describe('getActiveAlerts', () => {
    it('should return only unresolved alerts', () => {
      service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150, { component: 'test' });
      
      const activeAlerts = service.getActiveAlerts();
      
      expect(activeAlerts.length).toBeGreaterThan(0);
      activeAlerts.forEach(alert => {
        expect(alert.resolved).toBe(false);
      });
    });

    it('should sort by timestamp descending', () => {
      service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150, { component: 'test1' });
      
      // Wait a bit to ensure different timestamps
      setTimeout(() => {
        service.checkPerformanceMetric(AlertType.MEMORY_USAGE, 150, { component: 'test2' });
        
        const activeAlerts = service.getActiveAlerts();
        
        for (let i = 1; i < activeAlerts.length; i++) {
          expect(activeAlerts[i-1].timestamp.getTime()).toBeGreaterThanOrEqual(
            activeAlerts[i].timestamp.getTime()
          );
        }
      }, 10);
    });
  });

  describe('searchAlerts', () => {
    beforeEach(() => {
      // Create test alerts
      service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150, { component: 'test' });
      service.checkPerformanceMetric(AlertType.MEMORY_USAGE, 150, { component: 'test' });
      service.checkPerformanceMetric(AlertType.ERROR_RATE, 15, { component: 'test' });
    });

    it('should return all alerts when no filters applied', () => {
      const results = service.searchAlerts();
      
      expect(results.length).toBeGreaterThan(0);
    });

    it('should filter by level', () => {
      const results = service.searchAlerts({ level: AlertLevel.WARNING });
      
      results.forEach(alert => {
        expect(alert.level).toBe(AlertLevel.WARNING);
      });
    });

    it('should filter by type', () => {
      const results = service.searchAlerts({ type: AlertType.RESPONSE_TIME });
      
      results.forEach(alert => {
        expect(alert.type).toBe(AlertType.RESPONSE_TIME);
      });
    });

    it('should filter by resolved status', () => {
      const unresolvedResults = service.searchAlerts({ resolved: false });
      const resolvedResults = service.searchAlerts({ resolved: true });
      
      unresolvedResults.forEach(alert => {
        expect(alert.resolved).toBe(false);
      });
      
      resolvedResults.forEach(alert => {
        expect(alert.resolved).toBe(true);
      });
    });

    it('should filter by date range', () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

      const results = service.searchAlerts({
        startDate: oneHourAgo,
        endDate: oneHourFromNow
      });

      results.forEach(alert => {
        expect(alert.timestamp).toBeGreaterThanOrEqual(oneHourAgo);
        expect(alert.timestamp).toBeLessThanOrEqual(oneHourFromNow);
      });
    });

    it('should limit results', () => {
      const results = service.searchAlerts({ limit: 2 });
      
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should sort by timestamp descending', () => {
      const results = service.searchAlerts();
      
      for (let i = 1; i < results.length; i++) {
        expect(results[i-1].timestamp.getTime()).toBeGreaterThanOrEqual(
          results[i].timestamp.getTime()
        );
      }
    });
  });

  describe('updateThreshold', () => {
    it('should update existing threshold', () => {
      service.updateThreshold(AlertType.RESPONSE_TIME, AlertLevel.WARNING, {
        threshold: 200,
        operator: 'gt',
        cooldown: 600
      });

      // Test with new threshold
      const alerts = service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150, { component: 'test' });
      
      expect(alerts).toHaveLength(0); // Should not trigger with old threshold
    });

    it('should add new threshold if not exists', () => {
      service.updateThreshold(AlertType.CACHE_PERFORMANCE, AlertLevel.INFO, {
        threshold: 90,
        operator: 'lt',
        cooldown: 300
      });

      // This should create a new threshold
      expect(() => service.updateThreshold(AlertType.CACHE_PERFORMANCE, AlertLevel.INFO, {
        threshold: 90,
        operator: 'lt'
      })).not.toThrow();
    });
  });

  describe('cleanup', () => {
    it('should clear all alerts and reset state', () => {
      service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150, { component: 'test' });
      
      expect(service.getActiveAlerts().length).toBeGreaterThan(0);
      
      service.cleanup();
      
      expect(service.getActiveAlerts().length).toBe(0);
      expect(service.getAlertStats().totalAlerts).toBe(0);
    });
  });

  describe('private methods', () => {
    describe('evaluateThreshold', () => {
      it('should evaluate greater than operator', () => {
        const threshold: AlertThreshold = {
          metric: AlertType.RESPONSE_TIME,
          level: AlertLevel.WARNING,
          threshold: 100,
          operator: 'gt'
        };

        expect((service as any).evaluateThreshold(threshold, 150)).toBe(true);
        expect((service as any).evaluateThreshold(threshold, 50)).toBe(false);
        expect((service as any).evaluateThreshold(threshold, 100)).toBe(false);
      });

      it('should evaluate less than operator', () => {
        const threshold: AlertThreshold = {
          metric: AlertType.THROUGHPUT,
          level: AlertLevel.WARNING,
          threshold: 10,
          operator: 'lt'
        };

        expect((service as any).evaluateThreshold(threshold, 5)).toBe(true);
        expect((service as any).evaluateThreshold(threshold, 15)).toBe(false);
        expect((service as any).evaluateThreshold(threshold, 10)).toBe(false);
      });

      it('should evaluate greater than or equal operator', () => {
        const threshold: AlertThreshold = {
          metric: AlertType.ERROR_RATE,
          level: AlertLevel.WARNING,
          threshold: 5,
          operator: 'gte'
        };

        expect((service as any).evaluateThreshold(threshold, 5)).toBe(true);
        expect((service as any).evaluateThreshold(threshold, 10)).toBe(true);
        expect((service as any).evaluateThreshold(threshold, 3)).toBe(false);
      });

      it('should evaluate less than or equal operator', () => {
        const threshold: AlertThreshold = {
          metric: AlertType.CACHE_PERFORMANCE,
          level: AlertLevel.WARNING,
          threshold: 70,
          operator: 'lte'
        };

        expect((service as any).evaluateThreshold(threshold, 70)).toBe(true);
        expect((service as any).evaluateThreshold(threshold, 50)).toBe(true);
        expect((service as any).evaluateThreshold(threshold, 80)).toBe(false);
      });

      it('should evaluate equal operator', () => {
        const threshold: AlertThreshold = {
          metric: AlertType.RESPONSE_TIME,
          level: AlertLevel.INFO,
          threshold: 100,
          operator: 'eq'
        };

        expect((service as any).evaluateThreshold(threshold, 100)).toBe(true);
        expect((service as any).evaluateThreshold(threshold, 99)).toBe(false);
        expect((service as any).evaluateThreshold(threshold, 101)).toBe(false);
      });
    });

    describe('getMetricName', () => {
      it('should return correct metric names', () => {
        expect((service as any).getMetricName(AlertType.RESPONSE_TIME)).toBe('응답시간');
        expect((service as any).getMetricName(AlertType.MEMORY_USAGE)).toBe('메모리 사용량');
        expect((service as any).getMetricName(AlertType.ERROR_RATE)).toBe('에러율');
        expect((service as any).getMetricName(AlertType.THROUGHPUT)).toBe('처리량');
        expect((service as any).getMetricName(AlertType.DATABASE_PERFORMANCE)).toBe('데이터베이스 성능');
        expect((service as any).getMetricName(AlertType.CACHE_PERFORMANCE)).toBe('캐시 성능');
      });
    });

    describe('generateAlertMessage', () => {
      it('should generate correct alert messages', () => {
        const threshold: AlertThreshold = {
          metric: AlertType.RESPONSE_TIME,
          level: AlertLevel.WARNING,
          threshold: 100,
          operator: 'gt'
        };

        const message = (service as any).generateAlertMessage(threshold, 150);
        
        expect(message).toContain('🟡');
        expect(message).toContain('응답시간');
        expect(message).toContain('초과');
        expect(message).toContain('150');
        expect(message).toContain('100');
      });
    });

    describe('logToFile', () => {
      it('should log alert to file', () => {
        const alert: PerformanceAlert = {
          id: 'test-alert',
          timestamp: new Date(),
          level: AlertLevel.WARNING,
          type: AlertType.RESPONSE_TIME,
          metric: '응답시간',
          value: 150,
          threshold: 100,
          message: 'Test message',
          context: { component: 'test' },
          resolved: false
        };

        (service as any).logToFile(alert);

        expect(appendFileSync).toHaveBeenCalledWith(
          expect.stringContaining('performance-alerts-'),
          expect.stringContaining('test-alert')
        );
      });

      it('should handle file logging errors gracefully', () => {
        vi.mocked(appendFileSync).mockImplementation(() => {
          throw new Error('Write failed');
        });

        const alert: PerformanceAlert = {
          id: 'test-alert',
          timestamp: new Date(),
          level: AlertLevel.WARNING,
          type: AlertType.RESPONSE_TIME,
          metric: '응답시간',
          value: 150,
          threshold: 100,
          message: 'Test message',
          context: { component: 'test' },
          resolved: false
        };

        // Should not throw
        expect(() => (service as any).logToFile(alert)).not.toThrow();
      });
    });

    describe('cleanupOldAlerts', () => {
      it('should clean up old alerts when limit exceeded', () => {
        // Set a low maxAlerts for testing
        (service as any).maxAlerts = 2;
        
        // Create multiple alerts
        for (let i = 0; i < 5; i++) {
          service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150, { component: `test${i}` });
        }

        const stats = service.getAlertStats();
        expect(stats.totalAlerts).toBeLessThanOrEqual(2);
      });
    });
  });
});
