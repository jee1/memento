import { describe, it, expect, vi, afterEach } from 'vitest';
import { PerformanceMonitor } from '../performance-monitor.js';
import type { PerformanceMetrics } from '../performance-monitor.js';
import os from 'os';
import { logger } from '../../../../shared/utils/logger.js';

const toBytes = (mb: number): number => mb * 1024 * 1024;

function createMetrics(overrides: Partial<PerformanceMetrics> = {}): PerformanceMetrics {
  const base: PerformanceMetrics = {
    timestamp: new Date(),
    memory: {
      rss: toBytes(200),
      heapTotal: toBytes(1024),
      heapUsed: toBytes(512),
      external: toBytes(50),
      usagePercent: 50,
      rssUsagePercent: 50,
      heapUsagePercent: 50
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

describe('PerformanceMonitor CPU delta 계산', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('첫 번째 호출 시 0을 반환한다', () => {
    const monitor = new PerformanceMonitor();
    const result = (monitor as any).calculateCpuUsage(true);
    expect(result).toBe(0);
  });

  it('두 번째 호출 시 [0, 100] 범위의 값을 반환한다', async () => {
    const monitor = new PerformanceMonitor();
    (monitor as any).calculateCpuUsage(true); // 기준점 설정

    // 짧은 CPU 부하
    const end = Date.now() + 5;
    while (Date.now() < end) { /* busy wait */ }

    const result = (monitor as any).calculateCpuUsage(true);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  it('wallClockDelta가 0이면 lastCpuPercent를 반환한다', () => {
    const monitor = new PerformanceMonitor();
    const fakeCpu = { user: 1000, system: 500 };
    (monitor as any).scheduledCpuUsage = fakeCpu;
    (monitor as any).scheduledMeasurementTime = Date.now();

    // Date.now()를 동일 값으로 mock
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    vi.spyOn(process, 'cpuUsage').mockReturnValue({ user: 2000, system: 1000 });

    const result = (monitor as any).calculateCpuUsage(true);
    expect(result).toBe((monitor as any).lastCpuPercent);
  });

  it('tick=false이면 lastCpuPercent가 갱신되지 않는다', () => {
    const monitor = new PerformanceMonitor();
    // scheduled 기준선 설정 (tick=true: lastCpuPercent 갱신됨)
    vi.spyOn(process, 'cpuUsage')
      .mockReturnValueOnce({ user: 0, system: 0 });
    (monitor as any).calculateCpuUsage(true); // scheduledCpuUsage: { user:0, system:0 }

    const lastCpuPercentBefore = (monitor as any).lastCpuPercent;
    const scheduledSnapshotBefore = { ...(monitor as any).scheduledCpuUsage };

    // on-demand read: onDemandCpuUsage만 갱신, scheduledCpuUsage·lastCpuPercent는 보존
    vi.spyOn(process, 'cpuUsage').mockReturnValue({ user: 100000, system: 50000 });
    const result = (monitor as any).calculateCpuUsage(false);

    expect(result).toBeGreaterThanOrEqual(0);
    // on-demand baseline은 갱신됨
    expect((monitor as any).onDemandCpuUsage).toEqual({ user: 100000, system: 50000 });
    // scheduled baseline은 영향 없음
    expect((monitor as any).scheduledCpuUsage).toEqual(scheduledSnapshotBefore);
    // lastCpuPercent는 tick=false 시 갱신되지 않음
    expect((monitor as any).lastCpuPercent).toBe(lastCpuPercentBefore);
  });

  it('tick=false 후 tick=true는 scheduled baseline 구간만 측정한다', () => {
    const monitor = new PerformanceMonitor();
    const cpuSeq = [
      { user: 0, system: 0 },          // tick=true baseline seed
      { user: 200000, system: 100000 }, // tick=false on-demand read (high CPU)
      { user: 210000, system: 105000 }  // tick=true scheduled (small delta only)
    ];
    let idx = 0;
    vi.spyOn(process, 'cpuUsage').mockImplementation(() => cpuSeq[idx++]);

    // T=0: seed scheduled baseline
    (monitor as any).calculateCpuUsage(true);

    // T=1: on-demand read — should NOT advance scheduled baseline
    (monitor as any).calculateCpuUsage(false);

    // T=2: scheduled tick — should measure delta from T=0, not T=1
    // ∆cpu = (210000+105000) - (0+0) = 315000µs over elapsed wall time
    // (we don't control wall time here, just verify scheduledCpuUsage advanced from T=0 snapshot)
    const scheduledBefore = { ...(monitor as any).scheduledCpuUsage };
    expect(scheduledBefore).toEqual({ user: 0, system: 0 }); // still T=0 snapshot
    (monitor as any).calculateCpuUsage(true);
    // After tick=true, scheduled baseline advances to T=2 snapshot
    expect((monitor as any).scheduledCpuUsage).toEqual({ user: 210000, system: 105000 });
  });
});

describe('PerformanceMonitor 임계값', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('기본 memoryUsagePercent 임계값이 85이어야 함', () => {
    const monitor = new PerformanceMonitor();
    expect((monitor as any).thresholds.memoryUsagePercent).toBe(85);
  });

  it('기본 cpuUsagePercent 임계값이 75이어야 함', () => {
    const monitor = new PerformanceMonitor();
    expect((monitor as any).thresholds.cpuUsagePercent).toBe(75);
  });

  it('PERF_MEMORY_WARN_PERCENT 환경 변수로 임계값을 재정의할 수 있어야 함', () => {
    const original = process.env.PERF_MEMORY_WARN_PERCENT;
    process.env.PERF_MEMORY_WARN_PERCENT = '90';
    try {
      const monitor = new PerformanceMonitor();
      expect((monitor as any).thresholds.memoryUsagePercent).toBe(90);
    } finally {
      if (original === undefined) delete process.env.PERF_MEMORY_WARN_PERCENT;
      else process.env.PERF_MEMORY_WARN_PERCENT = original;
    }
  });

  it('유효하지 않은 PERF_CPU_WARN_PERCENT는 기본값 75를 사용해야 함', () => {
    const original = process.env.PERF_CPU_WARN_PERCENT;
    process.env.PERF_CPU_WARN_PERCENT = 'invalid';
    try {
      const monitor = new PerformanceMonitor();
      expect((monitor as any).thresholds.cpuUsagePercent).toBe(75);
    } finally {
      if (original === undefined) delete process.env.PERF_CPU_WARN_PERCENT;
      else process.env.PERF_CPU_WARN_PERCENT = original;
    }
  });
});

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


describe('getMemoryMetrics semantics', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('usagePercent is RSS-based and equals rssUsagePercent', () => {
    const totalMem = 8 * 1024 * 1024 * 1024;
    vi.spyOn(os, 'totalmem').mockReturnValue(totalMem);
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 2 * 1024 * 1024 * 1024,
      heapTotal: 3 * 1024 * 1024 * 1024,
      heapUsed: 1 * 1024 * 1024 * 1024,
      external: 0,
      arrayBuffers: 0
    });

    const monitor = new PerformanceMonitor();
    const metrics = monitor.getMemoryMetrics();

    expect(metrics.usagePercent).toBeCloseTo(25, 5);
    expect(metrics.rssUsagePercent).toBeCloseTo(25, 5);
    expect(metrics.usagePercent).toBe(metrics.rssUsagePercent);
  });

  it('correctly computes heapUsagePercent', () => {
    const totalMem = 8 * 1024 * 1024 * 1024;
    vi.spyOn(os, 'totalmem').mockReturnValue(totalMem);
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 2 * 1024 * 1024 * 1024,
      heapTotal: 3 * 1024 * 1024 * 1024,
      heapUsed: 1 * 1024 * 1024 * 1024,
      external: 0,
      arrayBuffers: 0
    });

    const monitor = new PerformanceMonitor();
    const metrics = monitor.getMemoryMetrics();

    expect(metrics.heapUsagePercent).toBeCloseTo(12.5, 5);
  });
});

describe('PerformanceMonitor 메모리 메트릭 (rss/totalmem 축)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeMonitor(thresholds?: { memoryUsagePercent?: number; cpuUsagePercent?: number }) {
    return new PerformanceMonitor(thresholds);
  }

  it('V8 힙 충전율이 높아도 rss가 낮으면 알림을 생성하지 않는다', async () => {
    const totalMem = 8 * 1024 * 1024 * 1024;
    vi.spyOn(os, 'totalmem').mockReturnValue(totalMem);
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 30 * 1024 * 1024,
      heapTotal: 32 * 1024 * 1024,
      heapUsed: 30 * 1024 * 1024,
      external: 0,
      arrayBuffers: 0
    });

    const monitor = makeMonitor({ memoryUsagePercent: 85 });
    await monitor.collectMetrics();

    const alerts = monitor.getActiveAlerts().filter(a => a.type === 'memory');
    expect(alerts).toHaveLength(0);
  });

  it('heapUsed/heapTotal < 85%이지만 rss/totalmem > 85%이면 알림을 생성한다', async () => {
    const totalMem = 1024 * 1024 * 1024;
    vi.spyOn(os, 'totalmem').mockReturnValue(totalMem);
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: Math.round(totalMem * 0.9),
      heapTotal: Math.round(totalMem * 0.4),
      heapUsed: Math.round(totalMem * 0.3),
      external: 0,
      arrayBuffers: 0
    });

    const monitor = makeMonitor({ memoryUsagePercent: 85 });
    await monitor.collectMetrics();

    const alerts = monitor.getActiveAlerts().filter(a => a.type === 'memory');
    expect(alerts.length).toBeGreaterThanOrEqual(1);
  });

  it('os.totalmem()이 0이면 알림을 생성하지 않고 오류도 없다', async () => {
    vi.spyOn(os, 'totalmem').mockReturnValue(0);
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 500 * 1024 * 1024,
      heapTotal: 600 * 1024 * 1024,
      heapUsed: 500 * 1024 * 1024,
      external: 0,
      arrayBuffers: 0
    });

    const monitor = makeMonitor({ memoryUsagePercent: 85 });
    await expect(monitor.collectMetrics()).resolves.not.toThrow();
    const alerts = monitor.getActiveAlerts().filter(a => a.type === 'memory');
    expect(alerts).toHaveLength(0);
  });

  it('memory: 알림 발생 후 조건 해소 시 auto-resolve, 재발생 시 새 알림 생성', async () => {
    const totalMem = 1024 * 1024 * 1024;
    const memMock = vi.spyOn(process, 'memoryUsage');
    vi.spyOn(os, 'totalmem').mockReturnValue(totalMem);
    const monitor = makeMonitor({ memoryUsagePercent: 85 });

    memMock.mockReturnValue({
      rss: Math.round(totalMem * 0.9),
      heapTotal: totalMem,
      heapUsed: Math.round(totalMem * 0.9),
      external: 0,
      arrayBuffers: 0
    });
    await monitor.collectMetrics();
    expect(monitor.getActiveAlerts().filter(a => a.type === 'memory')).toHaveLength(1);

    memMock.mockReturnValue({
      rss: Math.round(totalMem * 0.5),
      heapTotal: totalMem,
      heapUsed: Math.round(totalMem * 0.5),
      external: 0,
      arrayBuffers: 0
    });
    await monitor.collectMetrics();
    expect(monitor.getActiveAlerts().filter(a => a.type === 'memory')).toHaveLength(0);

    memMock.mockReturnValue({
      rss: Math.round(totalMem * 0.9),
      heapTotal: totalMem,
      heapUsed: Math.round(totalMem * 0.9),
      external: 0,
      arrayBuffers: 0
    });
    await monitor.collectMetrics();
    expect(monitor.getActiveAlerts().filter(a => a.type === 'memory')).toHaveLength(1);
  });

  it('cpu: 알림 발생 후 조건 해소 시 auto-resolve, 재발생 시 새 알림 생성', async () => {
    vi.spyOn(os, 'totalmem').mockReturnValue(8 * 1024 * 1024 * 1024);
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 100 * 1024 * 1024,
      heapTotal: 200 * 1024 * 1024,
      heapUsed: 100 * 1024 * 1024,
      external: 0,
      arrayBuffers: 0
    });

    const monitor = makeMonitor({ cpuUsagePercent: 10 });
    await monitor.collectMetrics();
    monitor.clearAlerts();

    const baseMetrics = await monitor.collectMetrics();
    monitor.clearAlerts();

    const highCpuMetrics = { ...baseMetrics, cpu: { ...baseMetrics.cpu, percent: 80 } };
    const lowCpuMetrics  = { ...baseMetrics, cpu: { ...baseMetrics.cpu, percent: 5  } };

    await (monitor as any).checkAlerts(highCpuMetrics);
    expect(monitor.getActiveAlerts().filter(a => a.type === 'cpu')).toHaveLength(1);

    await (monitor as any).checkAlerts(lowCpuMetrics);
    expect(monitor.getActiveAlerts().filter(a => a.type === 'cpu')).toHaveLength(0);

    await (monitor as any).checkAlerts(highCpuMetrics);
    expect(monitor.getActiveAlerts().filter(a => a.type === 'cpu')).toHaveLength(1);
  });

  it('critical alert는 logger.warn을 사용하고 logger.error를 사용하지 않는다', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    const errorSpy = vi.spyOn(logger, 'error');

    const totalMem = 1024 * 1024 * 1024;
    vi.spyOn(os, 'totalmem').mockReturnValue(totalMem);
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: Math.round(totalMem * 0.95),
      heapTotal: totalMem,
      heapUsed: Math.round(totalMem * 0.95),
      external: 0,
      arrayBuffers: 0
    });

    const monitor = makeMonitor({ memoryUsagePercent: 85 });
    await monitor.collectMetrics();

    const criticalWarnCalls = warnSpy.mock.calls.filter(
      args => args[0] === 'Critical performance alert handling'
    );
    const criticalErrorCalls = errorSpy.mock.calls.filter(
      args => args[0] === 'Critical performance alert handling'
    );

    expect(criticalWarnCalls.length).toBeGreaterThanOrEqual(1);
    expect(criticalErrorCalls).toHaveLength(0);
  });
});
