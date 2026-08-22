import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../../../../tools/types.js';
import { PerformanceMonitor } from '../../services/performance-monitor.js';
import { executePerformanceAlerts, performanceAlertsTool } from '../performance-alerts.js';

const NOW = new Date();

async function createContext(): Promise<{ context: ToolContext; monitor: PerformanceMonitor }> {
  const monitor = new PerformanceMonitor();
  await monitor.importMetrics(JSON.stringify({
    alerts: [
      {
        id: 'memory-warning',
        type: 'memory',
        severity: 'warning',
        metric: 'memory_usage_percent',
        message: 'High memory usage',
        value: 88,
        threshold: 85,
        context: { component: 'process', operation: 'rss-sample' },
        timestamp: NOW.toISOString(),
        resolved: false,
      },
      {
        id: 'query-critical',
        type: 'query',
        severity: 'critical',
        metric: 'query_time_ms',
        message: 'Slow query detected',
        value: 2500,
        threshold: 1000,
        context: { component: 'database', operation: 'query' },
        timestamp: new Date(NOW.getTime() - 1_000).toISOString(),
        resolved: true,
        resolvedAt: NOW.toISOString(),
        resolvedBy: 'operator',
        resolution: 'index added',
      },
    ],
  }));

  return {
    monitor,
    context: { services: { performanceMonitor: monitor } } as ToolContext,
  };
}

describe('performance_alerts compatibility over the monitor-owned store', () => {
  it('keeps the pre-unification severity and type filters in the public schema', () => {
    const properties = performanceAlertsTool.inputSchema.properties;

    expect(properties.level.enum).toEqual(['info', 'warning', 'critical']);
    expect(properties.type.enum).toEqual(expect.arrayContaining([
      'response_time',
      'memory_usage',
      'error_rate',
      'throughput',
      'database_performance',
      'cache_performance',
    ]));
  });

  it('lists monitor alerts with the public metric and context fields intact', async () => {
    const { context } = await createContext();

    const result = await executePerformanceAlerts({ action: 'list', hours: 24, limit: 10 }, context);

    expect(result).toEqual({
      success: true,
      activeAlerts: [{
        id: 'memory-warning',
        timestamp: NOW.toISOString(),
        level: 'warning',
        type: 'memory_usage',
        metric: 'memory_usage_percent',
        value: 88,
        threshold: 85,
        message: 'High memory usage',
        context: { component: 'process', operation: 'rss-sample' },
      }],
      recentAlerts: [
        {
          id: 'memory-warning',
          timestamp: NOW.toISOString(),
          level: 'warning',
          type: 'memory_usage',
          metric: 'memory_usage_percent',
          value: 88,
          threshold: 85,
          message: 'High memory usage',
          resolved: false,
          resolvedAt: undefined,
        },
        {
          id: 'query-critical',
          timestamp: new Date(NOW.getTime() - 1_000).toISOString(),
          level: 'critical',
          type: 'response_time',
          metric: 'query_time_ms',
          value: 2500,
          threshold: 1000,
          message: 'Slow query detected',
          resolved: true,
          resolvedAt: NOW.toISOString(),
        },
      ],
    });
  });

  it('maps legacy search filters to the monitor alert types', async () => {
    const { context } = await createContext();

    const result = await executePerformanceAlerts({
      action: 'search',
      level: 'warning',
      type: 'memory_usage',
      resolved: false,
      hours: 24,
    }, context);

    expect(result).toMatchObject({
      success: true,
      total: 1,
      alerts: [{
        id: 'memory-warning',
        type: 'memory_usage',
        metric: 'memory_usage_percent',
        context: { component: 'process', operation: 'rss-sample' },
      }],
    });
  });

  it('reports legacy stats buckets from the monitor store', async () => {
    const { context } = await createContext();

    const result = await executePerformanceAlerts({ action: 'stats', hours: 24 }, context);

    expect(result).toMatchObject({
      success: true,
      stats: {
        totalAlerts: 2,
        alertsByLevel: { info: 0, warning: 1, critical: 1 },
        alertsByType: {
          response_time: 1,
          memory_usage: 1,
          error_rate: 0,
          throughput: 0,
          database_performance: 0,
          cache_performance: 0,
        },
        activeAlerts: 1,
      },
      summary: { totalAlerts: 2, activeAlerts: 1, criticalAlerts: 1 },
    });
  });

  it('resolves the same monitor alert and preserves operator metadata', async () => {
    const { context, monitor } = await createContext();

    const result = await executePerformanceAlerts({
      action: 'resolve',
      alertId: 'memory-warning',
      resolvedBy: 'maintainer',
      resolution: 'memory pressure cleared',
    }, context);

    expect(result).toMatchObject({
      success: true,
      alertId: 'memory-warning',
      resolvedBy: 'maintainer',
      resolution: 'memory pressure cleared',
    });
    expect(monitor.getAllAlerts().find(alert => alert.id === 'memory-warning')).toMatchObject({
      resolved: true,
      resolvedBy: 'maintainer',
      resolution: 'memory pressure cleared',
    });
  });
});
