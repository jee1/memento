/**
 * Performance trend analysis, summaries, and recommendations
 */

import type { PerformanceAlert, PerformanceMetrics } from './performance-monitor-types.js';
import type { SearchMetricsSnapshot } from './search-metrics-store.js';

export type TrendDirection = 'increasing' | 'decreasing' | 'stable';

export interface PerformanceSummary {
  current: PerformanceMetrics | null;
  alerts: { active: number; total: number };
  trends: {
    memoryTrend: TrendDirection;
    dbSizeTrend: TrendDirection;
  };
}

export interface MetricsAnalytics {
  memory: {
    averageHeapUsedMB: number;
    peakHeapUsedMB: number;
    averageUsagePercent: number;
    history: number[];
  };
  cpu: {
    averagePercent: number;
    peakPercent: number;
    history: number[];
  };
  database: {
    averageSizeMB: number;
    lastSizeMB: number;
    growthRate: number;
  };
  search: {
    totalSearches: number;
    averageSearchTime: number;
    cacheHitRate: number;
    textShare: number;
    vectorShare: number;
    hybridShare: number;
  };
}

export interface AlertGetters {
  getAlerts: () => PerformanceAlert[];
  getAllAlerts: () => PerformanceAlert[];
}

/**
 * 트렌드 분석
 */
export function analyzeTrend(values: number[]): TrendDirection {
  if (values.length < 2) return 'stable';

  const first = values[0];
  const last = values[values.length - 1];

  if (first === undefined || last === undefined || first === 0) return 'stable';

  const change = (last - first) / first;

  if (change > 0.1) return 'increasing';
  if (change < -0.1) return 'decreasing';
  return 'stable';
}

/**
 * 권장사항 생성
 */
export function generateRecommendations(alerts: PerformanceAlert[]): string[] {
  const recommendations: string[] = [];

  const memoryAlerts = alerts.filter(alert => alert.type === 'memory' && !alert.resolved);
  const cpuAlerts = alerts.filter(alert => alert.type === 'cpu' && !alert.resolved);
  const dbAlerts = alerts.filter(alert => alert.type === 'database' && !alert.resolved);

  if (memoryAlerts.length > 0) {
    recommendations.push('메모리 사용량이 높습니다. 캐시 크기를 줄이거나 메모리 정리를 고려하세요.');
  }

  if (cpuAlerts.length > 0) {
    recommendations.push('CPU 사용량이 높습니다. 쿼리 최적화나 인덱스 추가를 고려하세요.');
  }

  if (dbAlerts.length > 0) {
    recommendations.push('데이터베이스 크기가 큽니다. 오래된 데이터 정리나 아카이빙을 고려하세요.');
  }

  if (recommendations.length === 0) {
    recommendations.push('시스템이 정상적으로 작동하고 있습니다.');
  }

  return recommendations;
}

/**
 * 성능 통계 요약
 */
export function getPerformanceSummary(
  history: PerformanceMetrics[],
  alertGetters: AlertGetters
): PerformanceSummary {
  const current = history[history.length - 1] || null;
  const activeAlerts = alertGetters.getAlerts();
  const allAlerts = alertGetters.getAllAlerts();

  // 트렌드 분석 (최근 10개 지표 기준)
  const recentMetrics = history.slice(-10);
  const memoryTrend = analyzeTrend(recentMetrics.map(m => m.memory.heapUsed));
  const dbSizeTrend = analyzeTrend(recentMetrics.map(m => m.database.size));

  return {
    current,
    alerts: {
      active: activeAlerts.length,
      total: allAlerts.length
    },
    trends: {
      memoryTrend,
      dbSizeTrend
    }
  };
}

/**
 * 메트릭 분석
 */
export function getMetricsAnalytics(
  history: PerformanceMetrics[],
  _searchMetrics?: SearchMetricsSnapshot,
  limit: number = 50
): MetricsAnalytics {
  const slice = history.slice(-limit);
  if (!slice.length) {
    return {
      memory: {
        averageHeapUsedMB: 0,
        peakHeapUsedMB: 0,
        averageUsagePercent: 0,
        history: []
      },
      cpu: {
        averagePercent: 0,
        peakPercent: 0,
        history: []
      },
      database: {
        averageSizeMB: 0,
        lastSizeMB: 0,
        growthRate: 0
      },
      search: {
        totalSearches: 0,
        averageSearchTime: 0,
        cacheHitRate: 0,
        textShare: 0,
        vectorShare: 0,
        hybridShare: 0
      }
    };
  }

  const toMb = (bytes: number): number => bytes / (1024 * 1024);
  const average = (values: number[]): number => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

  const memoryUsed = slice.map(m => m.memory.heapUsed);
  const memoryPercentHistory = slice.map(m => m.memory.usagePercent ?? 0);
  const cpuPercentHistory = slice.map(m => m.cpu.percent ?? 0);
  const dbSizesMB = slice.map(m => toMb(m.database.size));

  const latestEntry = slice[slice.length - 1];
  const latestSearch = latestEntry?.search;
  const totalSearches = latestSearch?.total ?? 0;
  const totalByType = latestSearch?.byType ?? { text: 0, vector: 0, hybrid: 0 };
  const totalByTypeSum = totalByType.text + totalByType.vector + totalByType.hybrid;
  const lastDbSize = dbSizesMB[dbSizesMB.length - 1] ?? 0;
  const firstDbSize = dbSizesMB[0] ?? 0;

  return {
    memory: {
      averageHeapUsedMB: toMb(average(memoryUsed)),
      peakHeapUsedMB: toMb(Math.max(...memoryUsed)),
      averageUsagePercent: average(memoryPercentHistory),
      history: memoryPercentHistory
    },
    cpu: {
      averagePercent: average(cpuPercentHistory),
      peakPercent: Math.max(...cpuPercentHistory),
      history: cpuPercentHistory
    },
    database: {
      averageSizeMB: average(dbSizesMB),
      lastSizeMB: lastDbSize,
      growthRate:
        dbSizesMB.length > 1 && firstDbSize > 0
          ? (lastDbSize - firstDbSize) / firstDbSize
          : 0
    },
    search: {
      totalSearches,
      averageSearchTime: latestSearch?.averageTime ?? 0,
      cacheHitRate: latestSearch?.cacheHitRate ?? 0,
      textShare: totalByTypeSum > 0 ? totalByType.text / totalByTypeSum : 0,
      vectorShare: totalByTypeSum > 0 ? totalByType.vector / totalByTypeSum : 0,
      hybridShare: totalByTypeSum > 0 ? totalByType.hybrid / totalByTypeSum : 0
    }
  };
}
