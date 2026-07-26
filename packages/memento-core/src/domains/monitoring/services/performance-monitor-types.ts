/**
 * Performance monitor shared types
 */

export interface PerformanceMetrics {
  timestamp: Date;
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    usagePercent: number;
  };
  cpu: {
    user: number;
    system: number;
    percent: number;
  };
  database: {
    size: number;
    memoryCount: number;
    queryTime: number;
  };
  uptime: number;
  search?: {
    total: number;
    averageTime: number;
    byType: { text: number; vector: number; hybrid: number };
    cacheHitRate: number;
    embeddingSearchRate: number;
  };
}

export interface AlertThresholds {
  memoryUsagePercent: number;      // 메모리 사용률 임계값 (기본: 85%)
  cpuUsagePercent: number;         // CPU 사용률 임계값 (기본: 75%)
  databaseSizeMB: number;          // DB 크기 임계값 (기본: 500MB, PERF_DATABASE_WARN_MB)
  queryTimeMs: number;             // 쿼리 시간 임계값 (기본: 1000ms)
  queryResolveWindow: number;      // query auto-resolve에 필요한 연속 ok 횟수 (기본: 3)
  /** resolve 후 동일 타입 재알림까지 대기(ms). 0이면 즉시 재무장. PERF_ALERT_REARM_MS */
  alertRearmMs: number;
}

export interface PerformanceAlert {
  id: string;
  type: 'memory' | 'cpu' | 'database' | 'query';
  severity: 'warning' | 'critical';
  message: string;
  value: number;
  threshold: number;
  timestamp: Date;
  resolved: boolean;
}
