import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PerformanceMonitor, type PerformanceMetrics } from './performance-monitor.js';
import { DatabaseUtils } from '../utils/database.js';
import Database from 'better-sqlite3';

// Mock dependencies
vi.mock('../utils/database.js', () => ({
  DatabaseUtils: {
    getDatabase: vi.fn(),
    runQuery: vi.fn(),
    runTransaction: vi.fn()
  }
}));

vi.mock('better-sqlite3', () => ({
  default: vi.fn()
}));

describe('PerformanceMonitor', () => {
  let performanceMonitor: PerformanceMonitor;
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock database
    mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue({ count: 0 }),
        run: vi.fn()
      }),
      exec: vi.fn(),
      close: vi.fn()
    };

    vi.mocked(DatabaseUtils.getDatabase).mockReturnValue(mockDb);
    vi.mocked(Database).mockImplementation(() => mockDb);

    performanceMonitor = new PerformanceMonitor();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('생성자', () => {
    it('성능 모니터가 올바르게 초기화되어야 함', () => {
      expect(performanceMonitor).toBeInstanceOf(PerformanceMonitor);
    });
  });

  describe('collectMetrics', () => {
    it('기본 메트릭을 수집해야 함', async () => {
      const metrics = await performanceMonitor.collectMetrics();

      expect(metrics).toHaveProperty('database');
      expect(metrics).toHaveProperty('search');
      expect(metrics).toHaveProperty('memory');
      expect(metrics).toHaveProperty('system');
      expect(metrics).toHaveProperty('timestamp');
    });

    it('데이터베이스 메트릭을 수집해야 함', async () => {
      // Mock database queries - getDatabaseMetrics에서 실행하는 순서대로 모킹
      mockDb.prepare().get
        .mockReturnValueOnce({ count: 15 }) // totalMemories
        .mockReturnValueOnce({ avgSize: 100 }) // averageMemorySize
        .mockReturnValueOnce({ page_count: 1000 }) // page_count
        .mockReturnValueOnce({ page_size: 1024 }); // page_size
      
      mockDb.prepare().all
        .mockReturnValueOnce([{ type: 'episodic', count: 10 }, { type: 'semantic', count: 5 }]); // memoryByType

      // 데이터베이스 연결 설정
      performanceMonitor.setDatabase(mockDb);

      const metrics = await performanceMonitor.collectMetrics();

      expect(metrics.database.totalMemories).toBe(15);
      expect(metrics.database.memoryByType).toEqual({
        episodic: 10,
        semantic: 5
      });
      expect(metrics.database.averageMemorySize).toBe(100);
      expect(metrics.database.databaseSize).toBe(1024000);
    });

    it('검색 메트릭을 수집해야 함', async () => {
      // Mock search statistics
      (performanceMonitor as any).searchStats = {
        totalSearches: 100,
        totalDuration: 5000,
        totalSearchTime: 5000,
        searchesByType: { text: 60, vector: 40 },
        cacheHits: 80,
        cacheMisses: 20,
        embeddingSearches: 40
      };

      const metrics = await performanceMonitor.collectMetrics();

      expect(metrics.search.totalSearches).toBe(100);
      expect(metrics.search.averageSearchTime).toBe(50);
      expect(metrics.search.searchByType).toEqual({ text: 60, vector: 40 });
      expect(metrics.search.cacheHitRate).toBe(0.8);
      expect(metrics.search.embeddingSearchRate).toBe(0.4);
    });

    it('메모리 사용량을 수집해야 함', async () => {
      const metrics = await performanceMonitor.collectMetrics();

      expect(metrics.memory.heapUsed).toBeGreaterThan(0);
      expect(metrics.memory.heapTotal).toBeGreaterThan(0);
      expect(metrics.memory.external).toBeGreaterThanOrEqual(0);
      expect(metrics.memory.rss).toBeGreaterThan(0);
    });

    it('시스템 리소스를 수집해야 함', async () => {
      const metrics = await performanceMonitor.collectMetrics();

      expect(metrics.system.uptime).toBeGreaterThan(0);
      expect(metrics.system.cpuUsage).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(metrics.system.loadAverage)).toBe(true);
    });

    it('타임스탬프를 설정해야 함', async () => {
      const before = new Date();
      const metrics = await performanceMonitor.collectMetrics();
      const after = new Date();

      expect(metrics.timestamp).toBeInstanceOf(Date);
      expect(metrics.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(metrics.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('recordSearch', () => {
    it('검색 통계를 기록해야 함', () => {
      performanceMonitor.recordSearch('text', 100);
      performanceMonitor.recordSearch('vector', 200);

      const stats = (performanceMonitor as any).searchStats;
      expect(stats.totalSearches).toBe(2);
      expect(stats.totalSearchTime).toBe(300);
      expect(stats.searchesByType.text).toBe(1);
      expect(stats.searchesByType.vector).toBe(1);
    });

    it('캐시 히트를 기록해야 함', () => {
      performanceMonitor.recordSearch('text', 50, true);

      const stats = (performanceMonitor as any).searchStats;
      expect(stats.cacheHits).toBe(1);
    });

    it('임베딩 검색을 기록해야 함', () => {
      performanceMonitor.recordSearch('vector', 100);

      const stats = (performanceMonitor as any).searchStats;
      expect(stats.embeddingSearches).toBe(1);
    });
  });

  describe('getMetrics', () => {
    it('현재 메트릭을 반환해야 함', async () => {
      const metrics = await performanceMonitor.getMetrics();

      expect(metrics).toHaveProperty('database');
      expect(metrics).toHaveProperty('search');
      expect(metrics).toHaveProperty('memory');
      expect(metrics).toHaveProperty('system');
      expect(metrics).toHaveProperty('timestamp');
    });
  });

  describe('getDatabaseMetrics', () => {
    it('데이터베이스 메트릭을 반환해야 함', async () => {
      // Mock database queries
      mockDb.prepare().get
        .mockReturnValueOnce({ count: 10 }) // totalMemories
        .mockReturnValueOnce({ avgSize: 100 }) // averageMemorySize
        .mockReturnValueOnce({ page_count: 1000 }) // page_count
        .mockReturnValueOnce({ page_size: 1024 }); // page_size
      
      mockDb.prepare().all
        .mockReturnValueOnce([{ type: 'episodic', count: 10 }]); // memoryByType

      // 데이터베이스 연결 설정
      performanceMonitor.setDatabase(mockDb);

      const metrics = await performanceMonitor.getDatabaseMetrics();

      expect(metrics.totalMemories).toBe(10);
      expect(metrics.memoryByType).toEqual({ episodic: 10 });
      expect(metrics.averageMemorySize).toBe(100);
      expect(metrics.databaseSize).toBe(1024000);
    });

    it('데이터베이스 연결 실패 시 기본값을 반환해야 함', async () => {
      vi.mocked(DatabaseUtils.getDatabase).mockReturnValue(null);

      const metrics = await performanceMonitor.getDatabaseMetrics();

      expect(metrics.totalMemories).toBe(0);
      expect(metrics.memoryByType).toEqual({});
      expect(metrics.averageMemorySize).toBe(0);
      expect(metrics.databaseSize).toBe(0);
    });
  });

  describe('getSearchMetrics', () => {
    it('검색 메트릭을 반환해야 함', () => {
      (performanceMonitor as any).searchStats = {
        totalSearches: 100,
        totalDuration: 5000,
        totalSearchTime: 5000,
        searchesByType: { text: 60, vector: 40 },
        cacheHits: 80,
        cacheMisses: 20,
        embeddingSearches: 40
      };

      const metrics = performanceMonitor.getSearchMetrics();

      expect(metrics.totalSearches).toBe(100);
      expect(metrics.averageSearchTime).toBe(50);
      expect(metrics.searchByType).toEqual({ text: 60, vector: 40 });
      expect(metrics.cacheHitRate).toBe(0.8);
      expect(metrics.embeddingSearchRate).toBe(0.4);
    });

    it('검색이 없을 때 기본값을 반환해야 함', () => {
      const metrics = performanceMonitor.getSearchMetrics();

      expect(metrics.totalSearches).toBe(0);
      expect(metrics.averageSearchTime).toBe(0);
      expect(metrics.cacheHitRate).toBe(0);
      expect(metrics.embeddingSearchRate).toBe(0);
    });
  });

  describe('getMemoryMetrics', () => {
    it('메모리 사용량을 반환해야 함', () => {
      const metrics = performanceMonitor.getMemoryMetrics();

      expect(metrics.heapUsed).toBeGreaterThan(0);
      expect(metrics.heapTotal).toBeGreaterThan(0);
      expect(metrics.external).toBeGreaterThanOrEqual(0);
      expect(metrics.rss).toBeGreaterThan(0);
    });
  });

  describe('getSystemMetrics', () => {
    it('시스템 리소스를 반환해야 함', () => {
      const metrics = performanceMonitor.getSystemMetrics();

      expect(metrics.uptime).toBeGreaterThan(0);
      expect(metrics.cpuUsage).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(metrics.loadAverage)).toBe(true);
    });
  });

  describe('resetStats', () => {
    it('검색 통계를 초기화해야 함', () => {
      performanceMonitor.recordSearch('text', 100);
      performanceMonitor.recordSearch('vector', 200);

      let stats = (performanceMonitor as any).searchStats;
      expect(stats.totalSearches).toBe(2);

      performanceMonitor.resetStats();

      stats = (performanceMonitor as any).searchStats;
      expect(stats.totalSearches).toBe(0);
      expect(stats.totalSearchTime).toBe(0);
      expect(stats.cacheHits).toBe(0);
      expect(stats.embeddingSearches).toBe(0);
    });
  });

  describe('getPerformanceReport', () => {
    it('성능 리포트를 생성해야 함', async () => {
      const report = await performanceMonitor.getPerformanceReport();

      expect(report).toHaveProperty('summary');
      expect(report).toHaveProperty('metrics');
      expect(report).toHaveProperty('recommendations');
      expect(report).toHaveProperty('timestamp');
    });

    it('성능 문제가 있을 때 권장사항을 포함해야 함', async () => {
      // Mock slow performance
      (performanceMonitor as any).searchStats = {
        totalSearches: 1000,
        totalSearchTime: 100000, // 100ms average
        searchesByType: { text: 500, vector: 500 },
        cacheHits: 100, // 10% hit rate
        embeddingSearches: 500
      };

      const report = await performanceMonitor.getPerformanceReport();

      expect(report.recommendations).toBeDefined();
      expect(report.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('isHealthy', () => {
    it('정상적인 성능일 때 true를 반환해야 함', async () => {
      // 알림 초기화
      performanceMonitor.clearAlerts();
      
      // 정상적인 성능으로 모킹
      (performanceMonitor as any).searchStats = {
        totalSearches: 100,
        totalDuration: 1000,
        totalSearchTime: 1000,
        searchesByType: { text: 50, vector: 50 },
        cacheHits: 80,
        cacheMisses: 20,
        embeddingSearches: 50
      };
      
      // CPU 사용률을 낮게 모킹
      vi.spyOn(process, 'cpuUsage').mockReturnValue({ user: 100000, system: 50000 });
      
      const isHealthy = await performanceMonitor.isHealthy();
      expect(isHealthy).toBe(true);
    });

    it('성능 문제가 있을 때 false를 반환해야 함', async () => {
      // Mock poor performance
      (performanceMonitor as any).searchStats = {
        totalSearches: 1000,
        totalSearchTime: 1000000, // 1초 average
        searchesByType: { text: 500, vector: 500 },
        cacheHits: 50, // 5% hit rate
        embeddingSearches: 500
      };

      const isHealthy = await performanceMonitor.isHealthy();
      expect(isHealthy).toBe(false);
    });
  });

  describe('getAlerts', () => {
    it('성능 알림을 반환해야 함', async () => {
      const alerts = await performanceMonitor.getAlerts();

      expect(Array.isArray(alerts)).toBe(true);
    });

    it('문제가 있을 때 알림을 생성해야 함', async () => {
      // 알림 초기화
      performanceMonitor.clearAlerts();
      
      // Mock poor performance
      (performanceMonitor as any).searchStats = {
        totalSearches: 1000,
        totalDuration: 1000000,
        totalSearchTime: 1000000,
        searchesByType: { text: 500, vector: 500 },
        cacheHits: 50,
        cacheMisses: 950,
        embeddingSearches: 500
      };

      // 메트릭 수집하여 알림 생성
      await performanceMonitor.collectMetrics();
      const alerts = await performanceMonitor.getAlerts();

      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0]).toHaveProperty('type');
      expect(alerts[0]).toHaveProperty('message');
      expect(alerts[0]).toHaveProperty('severity');
    });
  });

  describe('exportMetrics', () => {
    it('메트릭을 JSON으로 내보내야 함', async () => {
      const json = await performanceMonitor.exportMetrics();

      expect(typeof json).toBe('string');
      
      const parsed = JSON.parse(json);
      expect(parsed).toHaveProperty('database');
      expect(parsed).toHaveProperty('search');
      expect(parsed).toHaveProperty('memory');
      expect(parsed).toHaveProperty('system');
    });
  });

  describe('importMetrics', () => {
    it('JSON에서 메트릭을 가져와야 함', async () => {
      // 데이터베이스 연결 설정
      performanceMonitor.setDatabase(mockDb);
      
      const testData = {
        database: {
          totalMemories: 100,
          memoryByType: { episodic: 50, semantic: 50 },
          averageMemorySize: 200,
          databaseSize: 5000000
        },
        search: {
          totalSearches: 500,
          averageSearchTime: 25,
          searchByType: { text: 300, vector: 200 },
          cacheHitRate: 0.8,
          embeddingSearchRate: 0.4
        },
        memory: {
          heapUsed: 1000000,
          heapTotal: 2000000,
          external: 100000,
          rss: 3000000
        },
        system: {
          uptime: 3600,
          cpuUsage: 0.5,
          loadAverage: [0.1, 0.2, 0.3]
        },
        metrics: [{
          database: {
            totalMemories: 100,
            memoryByType: { episodic: 50, semantic: 50 },
            averageMemorySize: 200,
            databaseSize: 5000000
          },
          search: {
            totalSearches: 500,
            averageSearchTime: 25,
            searchByType: { text: 300, vector: 200 },
            cacheHitRate: 0.8,
            embeddingSearchRate: 0.4
          },
          memory: {
            heapUsed: 1000000,
            heapTotal: 2000000,
            external: 100000,
            rss: 3000000
          },
          system: {
            uptime: 3600,
            cpuUsage: 0.5,
            loadAverage: [0.1, 0.2, 0.3]
          },
          timestamp: new Date()
        }],
        alerts: [],
        exportedAt: new Date().toISOString()
      };

      const json = JSON.stringify(testData);
      await performanceMonitor.importMetrics(json);

      const metrics = await performanceMonitor.getMetrics();
      // importMetrics는 검색 통계만 복원하므로 검색 관련 메트릭만 확인
      expect(metrics.search.totalSearches).toBe(500);
      expect(metrics.search.averageSearchTime).toBe(25);
      expect(metrics.search.cacheHitRate).toBe(0.8);
      expect(metrics.search.embeddingSearchRate).toBe(0.4);
      
      // 히스토리가 복원되었는지 확인
      const history = performanceMonitor.getMetricsHistory();
      expect(history.length).toBeGreaterThan(0);
    });
  });
});
