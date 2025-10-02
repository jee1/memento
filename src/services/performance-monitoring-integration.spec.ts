import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PerformanceMonitoringIntegration, MonitoringConfig } from './performance-monitoring-integration.js';
import { PerformanceMonitor } from './performance-monitor.js';
import { PerformanceAlertService, AlertType, AlertLevel } from './performance-alert-service.js';
import Database from 'better-sqlite3';

// Mock dependencies
vi.mock('./performance-monitor.js', () => ({
  PerformanceMonitor: vi.fn().mockImplementation(() => ({
    collectMetrics: vi.fn()
  }))
}));

vi.mock('./performance-alert-service.js', () => ({
  PerformanceAlertService: vi.fn(),
  AlertType: {
    RESPONSE_TIME: 'response_time',
    MEMORY_USAGE: 'memory_usage',
    ERROR_RATE: 'error_rate',
    THROUGHPUT: 'throughput',
    DATABASE_PERFORMANCE: 'database_performance',
    CACHE_PERFORMANCE: 'cache_performance'
  },
  AlertLevel: {
    WARNING: 'warning',
    CRITICAL: 'critical'
  }
}));

describe('PerformanceMonitoringIntegration', () => {
  let integration: PerformanceMonitoringIntegration;
  let mockDb: any;
  let mockAlertService: any;
  let mockPerformanceMonitor: any;
  let config: MonitoringConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockDb = {} as Database.Database;
    mockAlertService = {
      checkPerformanceMetric: vi.fn(),
      updateThreshold: vi.fn(),
      cleanup: vi.fn()
    };
    mockPerformanceMonitor = {
      collectMetrics: vi.fn()
    };

    config = {
      enableRealTimeMonitoring: true,
      monitoringInterval: 1000,
      alertThresholds: {
        responseTime: { warning: 100, critical: 500 },
        memoryUsage: { warning: 100, critical: 200 },
        errorRate: { warning: 5, critical: 10 },
        throughput: { warning: 10, critical: 5 }
      }
    };

    // Mock PerformanceMonitor constructor
    vi.mocked(PerformanceMonitor).mockImplementation(() => mockPerformanceMonitor);
    
    integration = new PerformanceMonitoringIntegration(mockDb, mockAlertService, config);
  });

  afterEach(() => {
    integration.cleanup();
    vi.clearAllTimers();
  });

  describe('constructor', () => {
    it('should initialize with provided dependencies', () => {
      expect(integration).toBeInstanceOf(PerformanceMonitoringIntegration);
      expect(PerformanceMonitor).toHaveBeenCalledWith(mockDb);
    });
  });

  describe('startRealTimeMonitoring', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should start monitoring when enabled', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      integration.startRealTimeMonitoring();
      
      expect(consoleSpy).toHaveBeenCalledWith('🚀 실시간 성능 모니터링 시작');
      expect(integration.getMonitoringStatus().isMonitoring).toBe(true);
      
      consoleSpy.mockRestore();
    });

    it('should not start monitoring when disabled', () => {
      const config = {
        ...integration.getMonitoringStatus().config,
        enableRealTimeMonitoring: false
      };
      
      const newIntegration = new PerformanceMonitoringIntegration(mockDb, mockAlertService, config);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      newIntegration.startRealTimeMonitoring();
      
      expect(consoleSpy).toHaveBeenCalledWith('ℹ️ 실시간 모니터링이 비활성화되어 있습니다');
      expect(newIntegration.getMonitoringStatus().isMonitoring).toBe(false);
      
      consoleSpy.mockRestore();
    });

    it('should warn when already monitoring', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      integration.startRealTimeMonitoring();
      integration.startRealTimeMonitoring(); // Second call
      
      expect(consoleSpy).toHaveBeenCalledWith('⚠️ 실시간 모니터링이 이미 실행 중입니다');
      
      consoleSpy.mockRestore();
    });

    it('should execute monitoring cycle at intervals', async () => {
      const performMonitoringCycleSpy = vi.spyOn(integration as any, 'performMonitoringCycle');
      
      integration.startRealTimeMonitoring();
      
      // Fast-forward time
      vi.advanceTimersByTime(1000);
      
      expect(performMonitoringCycleSpy).toHaveBeenCalled();
    });
  });

  describe('stopRealTimeMonitoring', () => {
    it('should stop monitoring', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      integration.startRealTimeMonitoring();
      integration.stopRealTimeMonitoring();
      
      expect(consoleSpy).toHaveBeenCalledWith('🛑 실시간 성능 모니터링 중지');
      expect(integration.getMonitoringStatus().isMonitoring).toBe(false);
      
      consoleSpy.mockRestore();
    });

    it('should handle stopping when not monitoring', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      integration.stopRealTimeMonitoring();
      
      expect(consoleSpy).toHaveBeenCalledWith('🛑 실시간 성능 모니터링 중지');
      
      consoleSpy.mockRestore();
    });
  });

  describe('performMonitoringCycle', () => {
    it('should check all performance metrics', async () => {
      const mockMetrics = {
        search: {
          averageSearchTime: 150,
          totalSearches: 100,
          cacheHitRate: 0.8
        },
        memory: {
          heapUsed: 100 * 1024 * 1024, // 100MB
          heapTotal: 200 * 1024 * 1024, // 200MB
          rss: 150 * 1024 * 1024 // 150MB
        },
        database: {
          totalMemories: 50,
          queryPerformance: {
            averageQueryTime: 75,
            slowQueries: [{ query: 'slow query', time: 200 }]
          }
        },
        system: {
          uptime: 3600000 // 1 hour
        }
      };

      mockPerformanceMonitor.collectMetrics.mockResolvedValue(mockMetrics);

      await (integration as any).performMonitoringCycle();

      expect(mockAlertService.checkPerformanceMetric).toHaveBeenCalledWith(
        AlertType.RESPONSE_TIME,
        150,
        expect.objectContaining({
          component: 'search_engine',
          operation: 'search',
          totalSearches: 100
        })
      );

      expect(mockAlertService.checkPerformanceMetric).toHaveBeenCalledWith(
        AlertType.MEMORY_USAGE,
        100, // 100MB
        expect.objectContaining({
          component: 'memory_manager',
          heapTotal: 200 * 1024 * 1024,
          rss: 150 * 1024 * 1024
        })
      );

      expect(mockAlertService.checkPerformanceMetric).toHaveBeenCalledWith(
        AlertType.ERROR_RATE,
        expect.any(Number),
        expect.objectContaining({
          component: 'system',
          totalOperations: 150
        })
      );

      expect(mockAlertService.checkPerformanceMetric).toHaveBeenCalledWith(
        AlertType.THROUGHPUT,
        expect.any(Number),
        expect.objectContaining({
          component: 'system',
          totalOperations: 150
        })
      );

      expect(mockAlertService.checkPerformanceMetric).toHaveBeenCalledWith(
        AlertType.DATABASE_PERFORMANCE,
        75,
        expect.objectContaining({
          component: 'database',
          operation: 'query',
          totalMemories: 50
        })
      );

      expect(mockAlertService.checkPerformanceMetric).toHaveBeenCalledWith(
        AlertType.CACHE_PERFORMANCE,
        80, // 0.8 * 100
        expect.objectContaining({
          component: 'cache',
          operation: 'search',
          totalSearches: 100
        })
      );
    });

    it('should handle monitoring errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockPerformanceMonitor.collectMetrics.mockRejectedValue(new Error('Monitoring error'));

      await (integration as any).performMonitoringCycle();

      expect(consoleSpy).toHaveBeenCalledWith('❌ 모니터링 사이클 실행 중 오류:', expect.any(Error));
      
      consoleSpy.mockRestore();
    });

    it('should skip metrics with zero values', async () => {
      const mockMetrics = {
        search: {
          averageSearchTime: 0,
          totalSearches: 0,
          cacheHitRate: 0
        },
        memory: {
          heapUsed: 100 * 1024 * 1024,
          heapTotal: 200 * 1024 * 1024,
          rss: 150 * 1024 * 1024
        },
        database: {
          totalMemories: 0,
          queryPerformance: {
            averageQueryTime: 0,
            slowQueries: []
          }
        },
        system: {
          uptime: 0
        }
      };

      mockPerformanceMonitor.collectMetrics.mockResolvedValue(mockMetrics);

      await (integration as any).performMonitoringCycle();

      // Should not call checkPerformanceMetric for zero values
      expect(mockAlertService.checkPerformanceMetric).not.toHaveBeenCalledWith(
        AlertType.RESPONSE_TIME,
        0,
        expect.any(Object)
      );
    });
  });

  describe('calculateErrorRate', () => {
    it('should calculate error rate correctly', () => {
      const metrics = {
        database: {
          totalMemories: 100,
          queryPerformance: {
            slowQueries: [{ query: 'slow1' }, { query: 'slow2' }] // 2 slow queries
          }
        },
        search: {
          totalSearches: 50
        }
      };

      const errorRate = (integration as any).calculateErrorRate(metrics);
      
      // (2 slow queries / 150 total operations) * 100 = 1.33%
      expect(errorRate).toBeCloseTo(1.33, 1);
    });

    it('should return 0 when no operations', () => {
      const metrics = {
        database: { totalMemories: 0, queryPerformance: { slowQueries: [] } },
        search: { totalSearches: 0 }
      };

      const errorRate = (integration as any).calculateErrorRate(metrics);
      
      expect(errorRate).toBe(0);
    });
  });

  describe('calculateThroughput', () => {
    it('should calculate throughput correctly', () => {
      const metrics = {
        database: { totalMemories: 100 },
        search: { totalSearches: 50 },
        system: { uptime: 3600000 } // 1 hour = 3600 seconds
      };

      const throughput = (integration as any).calculateThroughput(metrics);
      
      // 150 operations / 3600 seconds = 0.042 ops/sec
      expect(throughput).toBeCloseTo(0.042, 3);
    });

    it('should return 0 when uptime is 0', () => {
      const metrics = {
        database: { totalMemories: 100 },
        search: { totalSearches: 50 },
        system: { uptime: 0 }
      };

      const throughput = (integration as any).calculateThroughput(metrics);
      
      expect(throughput).toBe(0);
    });
  });

  describe('performManualCheck', () => {
    it('should perform manual check', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const performMonitoringCycleSpy = vi.spyOn(integration as any, 'performMonitoringCycle');

      await integration.performManualCheck();

      expect(consoleSpy).toHaveBeenCalledWith('🔍 수동 성능 체크 실행');
      expect(performMonitoringCycleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });
  });

  describe('updateAlertThresholds', () => {
    it('should update response time thresholds', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      integration.updateAlertThresholds({
        responseTime: { warning: 200, critical: 1000 }
      });

      expect(mockAlertService.updateThreshold).toHaveBeenCalledWith(
        AlertType.RESPONSE_TIME,
        AlertLevel.WARNING,
        { threshold: 200, operator: 'gt' }
      );
      expect(mockAlertService.updateThreshold).toHaveBeenCalledWith(
        AlertType.RESPONSE_TIME,
        AlertLevel.CRITICAL,
        { threshold: 1000, operator: 'gt' }
      );
      expect(consoleSpy).toHaveBeenCalledWith('✅ 알림 임계값 업데이트 완료');
      
      consoleSpy.mockRestore();
    });

    it('should update memory usage thresholds', () => {
      integration.updateAlertThresholds({
        memoryUsage: { warning: 150, critical: 300 }
      });

      expect(mockAlertService.updateThreshold).toHaveBeenCalledWith(
        AlertType.MEMORY_USAGE,
        AlertLevel.WARNING,
        { threshold: 150, operator: 'gt' }
      );
      expect(mockAlertService.updateThreshold).toHaveBeenCalledWith(
        AlertType.MEMORY_USAGE,
        AlertLevel.CRITICAL,
        { threshold: 300, operator: 'gt' }
      );
    });

    it('should update error rate thresholds', () => {
      integration.updateAlertThresholds({
        errorRate: { warning: 10, critical: 20 }
      });

      expect(mockAlertService.updateThreshold).toHaveBeenCalledWith(
        AlertType.ERROR_RATE,
        AlertLevel.WARNING,
        { threshold: 10, operator: 'gt' }
      );
      expect(mockAlertService.updateThreshold).toHaveBeenCalledWith(
        AlertType.ERROR_RATE,
        AlertLevel.CRITICAL,
        { threshold: 20, operator: 'gt' }
      );
    });

    it('should update throughput thresholds', () => {
      integration.updateAlertThresholds({
        throughput: { warning: 20, critical: 10 }
      });

      expect(mockAlertService.updateThreshold).toHaveBeenCalledWith(
        AlertType.THROUGHPUT,
        AlertLevel.WARNING,
        { threshold: 20, operator: 'lt' }
      );
      expect(mockAlertService.updateThreshold).toHaveBeenCalledWith(
        AlertType.THROUGHPUT,
        AlertLevel.CRITICAL,
        { threshold: 10, operator: 'lt' }
      );
    });

    it('should handle partial threshold updates', () => {
      integration.updateAlertThresholds({
        responseTime: { warning: 200, critical: 1000 }
        // Other thresholds not provided
      });

      expect(mockAlertService.updateThreshold).toHaveBeenCalledTimes(2); // Only response time
    });
  });

  describe('getMonitoringStatus', () => {
    it('should return monitoring status', () => {
      const status = integration.getMonitoringStatus();

      expect(status).toHaveProperty('isMonitoring');
      expect(status).toHaveProperty('config');
      expect(status).toHaveProperty('alertService');
      expect(status.isMonitoring).toBe(false);
      expect(status.config).toBe(config);
      expect(status.alertService).toBe(mockAlertService);
    });
  });

  describe('cleanup', () => {
    it('should cleanup all resources', () => {
      integration.startRealTimeMonitoring();
      integration.cleanup();

      expect(integration.getMonitoringStatus().isMonitoring).toBe(false);
      expect(mockAlertService.cleanup).toHaveBeenCalled();
    });
  });
});
