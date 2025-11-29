import { describe, it, expect } from 'vitest';
import { PerformanceMonitor } from './performance-monitor';
import type { PerformanceMetrics } from './performance-monitor';

const toBytes = (mb: number): number => mb * 1024 * 1024;

function createMetrics(overrides: Partial<PerformanceMetrics> = {}): PerformanceMetrics {
  const base: PerformanceMetrics = {
    timestamp: new Date(),
    memory: {
      rss: toBytes(200),
      heapTotal: toBytes(1024),
      heapUsed: toBytes(512),
      external: toBytes(50),
      usagePercent: 50
    },
    cpu: {
      user: 500000,
      system: 250000,
      percent: 25
    },
    database: {
      size: toBytes(120),
      memoryCount: 1000,
      queryTime: 45
    },
    uptime: 1000,
    search: {
      total: 10,
      averageTime: 20,
      byType: { text: 6, vector: 3, hybrid: 1 },
      cacheHitRate: 0.6,
      embeddingSearchRate: 0.3
    }
  };

  return {
    ...base,
    ...overrides,
    memory: { ...base.memory, ...(overrides.memory ?? {}) },
    cpu: { ...base.cpu, ...(overrides.cpu ?? {}) },
    database: { ...base.database, ...(overrides.database ?? {}) },
    search: overrides.search ?? base.search
  };
}

describe('PerformanceMonitor analytics', () => {
  it('returns zeros when no metrics exist', () => {
    const monitor = new PerformanceMonitor();
    const analytics = monitor.getMetricsAnalytics();
    expect(analytics.memory.averageHeapUsedMB).toBe(0);
    expect(analytics.cpu.averagePercent).toBe(0);
    expect(analytics.database.averageSizeMB).toBe(0);
    expect(analytics.search.totalSearches).toBe(0);
  });

  it('computes averages and shares from metrics history', () => {
    const monitor = new PerformanceMonitor();

    const metricsA = createMetrics();
    const metricsB = createMetrics({
      memory: { heapUsed: toBytes(1024), usagePercent: 75 },
      cpu: { percent: 60 },
      database: { size: toBytes(180) },
      search: {
        total: 20,
        averageTime: 15,
        byType: { text: 8, vector: 8, hybrid: 4 },
        cacheHitRate: 0.7,
        embeddingSearchRate: 0.4
      }
    });

    (monitor as any).metricsHistory = [metricsA, metricsB];

    const analytics = monitor.getMetricsAnalytics();
    expect(analytics.memory.averageHeapUsedMB).toBeCloseTo(768, 0);
    expect(analytics.memory.peakHeapUsedMB).toBeCloseTo(1024, 0);
    expect(analytics.cpu.averagePercent).toBeCloseTo((25 + 60) / 2, 5);
    expect(analytics.database.lastSizeMB).toBeCloseTo(180, 5);
    expect(analytics.database.growthRate).toBeGreaterThan(0);
    expect(analytics.search.totalSearches).toBe(20);
    expect(analytics.search.vectorShare).toBeCloseTo(8 / (8 + 8 + 4));
  });
});
