/**
 * 성능 모니터링 서비스
 * 시스템 성능 지표 수집, 분석, 알림 기능 제공
 */

import Database from 'better-sqlite3';
import os from 'os';
import { logger } from '../../../shared/utils/logger.js';
import { alertNotificationService } from './alert-notification-service.js';
import { resolveValidatedNumber } from '../../../shared/config/environment.js';

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
  databaseSizeMB: number;          // DB 크기 임계값 (기본: 100MB)
  queryTimeMs: number;             // 쿼리 시간 임계값 (기본: 1000ms)
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

export class PerformanceMonitor {
  private db: Database.Database | null = null;
  private thresholds: AlertThresholds;
  private alerts: Map<string, PerformanceAlert> = new Map();
  private metricsHistory: PerformanceMetrics[] = [];
  private maxHistorySize = 1000;
  private monitoringInterval: NodeJS.Timeout | null = null;
  // Scheduled path: only advanced by tick=true — keeps 5-min window intact
  private scheduledCpuUsage: NodeJS.CpuUsage | null = null;
  private scheduledMeasurementTime: number | null = null;
  // On-demand path: advanced on every tick=false call — gives fresh short-window reads
  private onDemandCpuUsage: NodeJS.CpuUsage | null = null;
  private onDemandMeasurementTime: number | null = null;
  private latestCpuSnapshot: NodeJS.CpuUsage = { user: 0, system: 0 };
  private lastCpuPercent: number = 0; // fallback; only updated by tick=true

  constructor(thresholds?: Partial<AlertThresholds>) {
    this.thresholds = {
      memoryUsagePercent: resolveValidatedNumber('PERF_MEMORY_WARN_PERCENT', 85, n => n >= 1 && n <= 100, '범위 1-100'),
      cpuUsagePercent: resolveValidatedNumber('PERF_CPU_WARN_PERCENT', 75, n => n >= 1 && n <= 100, '범위 1-100'),
      databaseSizeMB: 100,
      queryTimeMs: 1000,
      ...thresholds
    };
  }

  /**
   * 모니터링 시작
   */
  initialize(db: Database.Database): void {
    this.db = db;
    // Seed both baselines from the same snapshot so neither path returns 0 on the first call.
    const seed = process.cpuUsage();
    const now = Date.now();
    this.scheduledCpuUsage = seed;
    this.scheduledMeasurementTime = now;
    this.onDemandCpuUsage = seed;
    this.onDemandMeasurementTime = now;
    this.latestCpuSnapshot = seed;
    logger.info('PerformanceMonitor initialized');
  }

  /**
   * 데이터베이스 설정
   */
  setDatabase(db: Database.Database | null): void {
    this.db = db;
  }

  /**
   * 성능 지표 수집
   *
   * tick=true: 스케줄된 모니터링 호출 — scheduled baseline을 갱신하고 lastCpuPercent를 기록합니다.
   * tick=false(기본): 온디맨드 읽기 — on-demand baseline만 갱신하여 scheduled baseline과 간섭하지 않습니다.
   */
  async collectMetrics(options?: { tick?: boolean }): Promise<any> {
    const tick = options?.tick ?? false;
    const startTime = Date.now();

    // 메모리 사용량
    const memUsage = process.memoryUsage();

    // 데이터베이스 지표
    const dbMetrics = await this.getDatabaseMetrics();
    const dbMetricsForPerformance = {
      size: dbMetrics.databaseSize,
      memoryCount: dbMetrics.totalMemories,
      queryTime: 0 // 실제 쿼리 시간은 별도로 측정
    };

    // 검색 지표
    const searchMetrics = this.getSearchMetrics();

    // 시스템 지표
    const systemMetrics = this.getSystemMetrics();

    const memoryUsagePercent = memUsage.heapTotal > 0 ? (memUsage.heapUsed / memUsage.heapTotal) * 100 : 0;
    // tick=true: scheduled baseline 갱신 / tick=false: on-demand baseline만 갱신
    const cpuUsagePercent = this.calculateCpuUsage(tick);

    const metrics: PerformanceMetrics = {
      timestamp: new Date(),
      database: dbMetricsForPerformance,
      memory: {
        rss: memUsage.rss,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
        external: memUsage.external,
        usagePercent: memoryUsagePercent
      },
      cpu: {
        user: this.latestCpuSnapshot.user,
        system: this.latestCpuSnapshot.system,
        percent: cpuUsagePercent
      },
      uptime: process.uptime(),
      search: {
        total: searchMetrics.totalSearches,
        averageTime: searchMetrics.averageSearchTime,
        byType: searchMetrics.searchByType,
        cacheHitRate: searchMetrics.cacheHitRate,
        embeddingSearchRate: searchMetrics.embeddingSearchRate
      }
    };

    // 지표 히스토리에 추가
    this.addToHistory(metrics);
    
    // 알림 검사
    await this.checkAlerts(metrics);
    
    const collectionTime = Date.now() - startTime;
    logger.debug('Performance metrics collected', { collectionTimeMs: collectionTime });
    
    return metrics;
  }


  /**
   * 알림 검사
   */
  private async checkAlerts(metrics: PerformanceMetrics): Promise<void> {
    const alerts: PerformanceAlert[] = [];
    const now = new Date();

    // 메모리 사용률 검사
    const memoryUsagePercent = (metrics.memory.heapUsed / metrics.memory.heapTotal) * 100;
    if (memoryUsagePercent > this.thresholds.memoryUsagePercent) {
      const alertId = `memory-${now.getTime()}`;
      const severity = memoryUsagePercent > 90 ? 'critical' : 'warning';
      
      // 중복 알림 방지 (같은 타입의 활성 알림이 있으면 스킵)
      const existingMemoryAlert = Array.from(this.alerts.values())
        .find(alert => alert.type === 'memory' && !alert.resolved);
      
      if (!existingMemoryAlert) {
        alerts.push({
          id: alertId,
          type: 'memory',
          severity,
          message: `High memory usage: ${memoryUsagePercent.toFixed(1)}% (${this.formatBytes(metrics.memory.heapUsed)}/${this.formatBytes(metrics.memory.heapTotal)})`,
          value: memoryUsagePercent,
          threshold: this.thresholds.memoryUsagePercent,
          timestamp: now,
          resolved: false
        });
      }
    }

    // 데이터베이스 크기 검사
    const dbSizeMB = metrics.database.size / (1024 * 1024);
    if (dbSizeMB > this.thresholds.databaseSizeMB) {
      const alertId = `database-${now.getTime()}`;
      const severity = dbSizeMB > this.thresholds.databaseSizeMB * 1.5 ? 'critical' : 'warning';
      
      const existingDbAlert = Array.from(this.alerts.values())
        .find(alert => alert.type === 'database' && !alert.resolved);
      
      if (!existingDbAlert) {
        alerts.push({
          id: alertId,
          type: 'database',
          severity,
          message: `Large database size: ${dbSizeMB.toFixed(1)}MB (${metrics.database.memoryCount} memories)`,
          value: dbSizeMB,
          threshold: this.thresholds.databaseSizeMB,
          timestamp: now,
          resolved: false
        });
      }
    }

    // 쿼리 시간 검사
    if (metrics.database.queryTime > this.thresholds.queryTimeMs) {
      const alertId = `query-${now.getTime()}`;
      const severity = metrics.database.queryTime > this.thresholds.queryTimeMs * 2 ? 'critical' : 'warning';
      
      const existingQueryAlert = Array.from(this.alerts.values())
        .find(alert => alert.type === 'query' && !alert.resolved);
      
      if (!existingQueryAlert) {
        alerts.push({
          id: alertId,
          type: 'query',
          severity,
          message: `Slow query detected: ${metrics.database.queryTime}ms (threshold: ${this.thresholds.queryTimeMs}ms)`,
          value: metrics.database.queryTime,
          threshold: this.thresholds.queryTimeMs,
          timestamp: now,
          resolved: false
        });
      }
    }

    // CPU 사용률 검사
    const cpuUsagePercent = metrics.cpu.percent;
    if (cpuUsagePercent > this.thresholds.cpuUsagePercent) {
      const alertId = `cpu-${now.getTime()}`;
      const severity = cpuUsagePercent > 90 ? 'critical' : 'warning';
      
      const existingCpuAlert = Array.from(this.alerts.values())
        .find(alert => alert.type === 'cpu' && !alert.resolved);
      
      if (!existingCpuAlert) {
        alerts.push({
          id: alertId,
          type: 'cpu',
          severity,
          message: `High CPU usage: ${cpuUsagePercent.toFixed(1)}%`,
          value: cpuUsagePercent,
          threshold: this.thresholds.cpuUsagePercent,
          timestamp: now,
          resolved: false
        });
      }
    }

    // 알림 저장 및 로깅
    for (const alert of alerts) {
      this.alerts.set(alert.id, alert);
      logger.warn('Performance alert generated', {
        type: alert.type,
        severity: alert.severity,
        value: alert.value,
        threshold: alert.threshold
      });
      alertNotificationService.emitAlert({
        id: alert.id,
        source: 'performance',
        severity: alert.severity,
        message: alert.message,
        metadata: {
          type: alert.type,
          value: alert.value,
          threshold: alert.threshold
        }
      });

      // 심각한 알림의 경우 추가 처리
      if (alert.severity === 'critical') {
        await this.handleCriticalAlert(alert, metrics);
      }
    }
  }

  /**
   * 지표 히스토리에 추가
   */
  private addToHistory(metrics: PerformanceMetrics): void {
    this.metricsHistory.push(metrics);
    
    // 히스토리 크기 제한
    if (this.metricsHistory.length > this.maxHistorySize) {
      this.metricsHistory = this.metricsHistory.slice(-this.maxHistorySize);
    }
  }


  /**
   * 알림 해결
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (alert) {
      alert.resolved = true;
      logger.info('Performance alert resolved', { alertId });
      alertNotificationService.acknowledgeAlert(alertId);
      return true;
    }
    return false;
  }

  /**
   * 현재 성능 지표 조회
   */
  async getMetrics(): Promise<PerformanceMetrics> {
    return await this.collectMetrics();
  }

  /**
   * 성능 지표 히스토리 조회
   */
  getMetricsHistory(limit?: number): PerformanceMetrics[] {
    if (limit) {
      return this.metricsHistory.slice(-limit);
    }
    return [...this.metricsHistory];
  }

  /**
   * 활성 알림 조회
   */
  getAlerts(): PerformanceAlert[] {
    return Array.from(this.alerts.values());
  }

  getActiveAlerts(): PerformanceAlert[] {
    return Array.from(this.alerts.values()).filter(alert => !alert.resolved);
  }

  getAllAlerts(): PerformanceAlert[] {
    return Array.from(this.alerts.values());
  }


  /**
   * 알림 초기화
   */
  clearAlerts(): void {
    this.alerts.clear();
  }

  /**
   * 성능 리포트 생성
   */
  async getPerformanceReport(): Promise<{
    summary: {
      current: PerformanceMetrics | null;
      alerts: { active: number; total: number };
      trends: {
        memoryTrend: 'increasing' | 'decreasing' | 'stable';
        dbSizeTrend: 'increasing' | 'decreasing' | 'stable';
      };
    };
    metrics: PerformanceMetrics[];
    alerts: PerformanceAlert[];
    recommendations: string[];
    analytics: ReturnType<PerformanceMonitor['getMetricsAnalytics']>;
    timestamp: Date;
  }> {
    const summary = this.getPerformanceSummary();
    const metrics = this.getMetricsHistory();
    const alerts = this.getAlerts();
    const recommendations = this.generateRecommendations(alerts);
    const analytics = this.getMetricsAnalytics();

    return {
      summary,
      metrics,
      alerts,
      recommendations,
      analytics,
      timestamp: new Date()
    };
  }

  /**
   * 권장사항 생성
   */
  private generateRecommendations(alerts: PerformanceAlert[]): string[] {
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
   * 모니터링 시작
   */
  startMonitoring(intervalMs: number = 60000): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.monitoringInterval = setInterval(async () => {
      try {
        await this.collectMetrics({ tick: true });
      } catch (error) {
        logger.error('성능 모니터링 중 오류', { error: error instanceof Error ? error.message : String(error) });
      }
    }, intervalMs);
  }

  /**
   * 모니터링 중지
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  /**
   * 모니터링 상태 확인
   */
  isMonitoring(): boolean {
    return this.monitoringInterval !== null;
  }

  /**
   * 검색 통계 기록
   */
  recordSearch(type: 'text' | 'vector' | 'hybrid', duration: number, cacheHit: boolean = false): void {
    if (!(this as any).searchStats) {
      (this as any).searchStats = {
        totalSearches: 0,
        totalDuration: 0,
        totalSearchTime: 0,
        searchesByType: { text: 0, vector: 0, hybrid: 0 },
        cacheHits: 0,
        cacheMisses: 0,
        embeddingSearches: 0
      };
    }

    const stats = (this as any).searchStats;
    stats.totalSearches++;
    stats.totalDuration += duration;
    stats.totalSearchTime += duration;
    stats.searchesByType[type]++;
    
    if (type === 'vector') {
      stats.embeddingSearches++;
    }
    
    if (cacheHit) {
      stats.cacheHits++;
    } else {
      stats.cacheMisses++;
    }
  }

  /**
   * 검색 메트릭 조회
   */
  getSearchMetrics(): {
    totalSearches: number;
    averageSearchTime: number;
    searchByType: { text: number; vector: number; hybrid: number };
    cacheHitRate: number;
    embeddingSearchRate: number;
  } {
    const stats = (this as any).searchStats || {
      totalSearches: 0,
      totalDuration: 0,
      searchesByType: { text: 0, vector: 0, hybrid: 0 },
      cacheHits: 0,
      cacheMisses: 0,
      embeddingSearches: 0
    };

    const averageSearchTime = stats.totalSearches > 0 ? stats.totalDuration / stats.totalSearches : 0;
    const totalCacheRequests = stats.cacheHits + stats.cacheMisses;
    const cacheHitRate = totalCacheRequests > 0 ? stats.cacheHits / totalCacheRequests : 0;
    const embeddingSearchRate = stats.totalSearches > 0 ? stats.embeddingSearches / stats.totalSearches : 0;

    return {
      totalSearches: stats.totalSearches,
      averageSearchTime,
      searchByType: stats.searchesByType,
      cacheHitRate,
      embeddingSearchRate
    };
  }

  /**
   * 메모리 메트릭 조회
   */
  getMemoryMetrics(): {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external: number;
    usagePercent: number;
  } {
    const memUsage = process.memoryUsage();
    const totalMemory = 1024 * 1024 * 1024; // 1GB 가정
    const usagePercent = (memUsage.heapUsed / totalMemory) * 100;

    return {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      rss: memUsage.rss,
      external: memUsage.external,
      usagePercent
    };
  }

  /**
   * 시스템 메트릭 조회
   */
  getSystemMetrics(): {
    uptime: number;
    cpuUsage: number;
    loadAverage: number[];
  } {
    const uptime = process.uptime();
    const cpuUsage = process.cpuUsage();
    const loadAverage = os.loadavg();

    return {
      uptime,
      cpuUsage: (cpuUsage.user + cpuUsage.system) / 1000000, // 마이크로초를 초로 변환
      loadAverage
    };
  }

  /**
   * 데이터베이스 메트릭 조회
   */
  async getDatabaseMetrics(): Promise<{
    totalMemories: number;
    memoryByType: Record<string, number>;
    averageMemorySize: number;
    databaseSize: number;
  }> {
    if (!this.db) {
      return {
        totalMemories: 0,
        memoryByType: {},
        averageMemorySize: 0,
        databaseSize: 0
      };
    }

    try {
      const totalMemories = this.db.prepare('SELECT COUNT(*) as count FROM memory_item').get() as { count: number };
      const memoryByType = this.db.prepare(`
        SELECT type, COUNT(*) as count 
        FROM memory_item 
        GROUP BY type
      `).all() as { type: string; count: number }[];

      const typeMap: Record<string, number> = {};
      memoryByType.forEach(row => {
        typeMap[row.type] = row.count;
      });

      const averageSize = this.db.prepare(`
        SELECT AVG(LENGTH(content)) as avgSize 
        FROM memory_item
      `).get() as { avgSize: number };

      const dbSize = this.db.prepare('PRAGMA page_count').get() as { page_count: number };
      const pageSize = this.db.prepare('PRAGMA page_size').get() as { page_size: number };
      const databaseSize = dbSize.page_count * pageSize.page_size;

      return {
        totalMemories: totalMemories.count,
        memoryByType: typeMap,
        averageMemorySize: averageSize.avgSize || 0,
        databaseSize
      };
    } catch (error) {
      return {
        totalMemories: 0,
        memoryByType: {},
        averageMemorySize: 0,
        databaseSize: 0
      };
    }
  }

  /**
   * 통계 초기화
   */
  resetStats(): void {
    (this as any).searchStats = {
      totalSearches: 0,
      totalDuration: 0,
      totalSearchTime: 0,
      searchesByType: { text: 0, vector: 0, hybrid: 0 },
      cacheHits: 0,
      cacheMisses: 0,
      embeddingSearches: 0
    };
  }

  /**
   * 시스템 건강 상태 확인
   */
  async isHealthy(): Promise<boolean> {
    const metrics = await this.collectMetrics();
    const alerts = this.getActiveAlerts();
    
    // 심각한 알림이 있으면 비정상
    const criticalAlerts = alerts.filter((alert: PerformanceAlert) => alert.severity === 'critical');
    return criticalAlerts.length === 0;
  }

  /**
   * 메트릭 내보내기
   */
  async exportMetrics(): Promise<string> {
    const metrics = this.getMetricsHistory();
    const alerts = this.getAlerts();
    const currentMetrics = await this.collectMetrics();
    
    return JSON.stringify({
      database: currentMetrics.database,
      search: currentMetrics.search,
      memory: currentMetrics.memory,
      cpu: currentMetrics.cpu,
      metrics,
      alerts,
      exportedAt: new Date().toISOString()
    });
  }

  /**
   * 메트릭 가져오기
   */
  async importMetrics(json: string): Promise<void> {
    const data = JSON.parse(json);
    
    if (data.metrics) {
      this.metricsHistory = data.metrics;
    }
    
    if (data.alerts) {
      this.alerts.clear();
      data.alerts.forEach((alert: PerformanceAlert) => {
        this.alerts.set(alert.id, alert);
      });
    }
    
    // 검색 통계 복원
    if (data.search) {
      (this as any).searchStats = {
        totalSearches: data.search.totalSearches || 0,
        totalDuration: data.search.averageSearchTime * data.search.totalSearches || 0,
        totalSearchTime: data.search.averageSearchTime * data.search.totalSearches || 0,
        searchesByType: data.search.searchByType || { text: 0, vector: 0, hybrid: 0 },
        cacheHits: Math.round((data.search.cacheHitRate || 0) * data.search.totalSearches),
        cacheMisses: Math.round((1 - (data.search.cacheHitRate || 0)) * data.search.totalSearches),
        embeddingSearches: Math.round((data.search.embeddingSearchRate || 0) * data.search.totalSearches)
      };
    }
    
    // 메트릭 히스토리 복원
    if (data.metrics && Array.isArray(data.metrics)) {
      this.metricsHistory = data.metrics;
    }
    
    // 데이터베이스 메트릭 복원 (테스트용)
    if (data.database) {
      // 현재 메트릭 수집
      const currentMetrics = await this.collectMetrics();
      if (currentMetrics) {
        // 데이터베이스 메트릭을 직접 설정
        currentMetrics.database = {
          totalMemories: data.database.totalMemories || 0,
          memoryByType: data.database.memoryByType || {},
          averageMemorySize: data.database.averageMemorySize || 0,
          databaseSize: data.database.databaseSize || 0
        };
        this.addToHistory(currentMetrics);
      }
    }
  }

  /**
   * 성능 통계 요약
   */
  getPerformanceSummary(): {
    current: PerformanceMetrics | null;
    alerts: { active: number; total: number };
    trends: {
      memoryTrend: 'increasing' | 'decreasing' | 'stable';
      dbSizeTrend: 'increasing' | 'decreasing' | 'stable';
    };
  } {
    const current = this.metricsHistory[this.metricsHistory.length - 1] || null;
    const activeAlerts = this.getAlerts();
    const allAlerts = this.getAllAlerts();

    // 트렌드 분석 (최근 10개 지표 기준)
    const recentMetrics = this.metricsHistory.slice(-10);
    const memoryTrend = this.analyzeTrend(recentMetrics.map(m => m.memory.heapUsed));
    const dbSizeTrend = this.analyzeTrend(recentMetrics.map(m => m.database.size));

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

  getMetricsAnalytics(limit: number = 50): {
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
  } {
    const history = this.metricsHistory.slice(-limit);
    if (!history.length) {
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

    const memoryUsed = history.map(m => m.memory.heapUsed);
    const memoryPercentHistory = history.map(m => m.memory.usagePercent ?? (m.memory.heapTotal ? (m.memory.heapUsed / m.memory.heapTotal) * 100 : 0));
    const cpuPercentHistory = history.map(m => m.cpu.percent ?? 0);
    const dbSizesMB = history.map(m => toMb(m.database.size));

    const latestEntry = history[history.length - 1];
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

  /**
   * 트렌드 분석
   */
  private analyzeTrend(values: number[]): 'increasing' | 'decreasing' | 'stable' {
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
   * 임계값 업데이트
   */
  updateThresholds(newThresholds: Partial<AlertThresholds>): void {
    this.thresholds = { ...this.thresholds, ...newThresholds };
    logger.info('Performance thresholds updated', { ...this.thresholds });
  }

  /**
   * 바이트를 읽기 쉬운 형식으로 변환
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * CPU 사용률 계산 (dual-baseline 설계)
   * 직전 baseline 이후의 (∆user + ∆system) / wallClock 으로 실제 사용률을 계산합니다.
   *
   * tick=true (scheduled): scheduledCpuUsage baseline 사용·갱신. lastCpuPercent도 갱신됩니다.
   * tick=false (on-demand): onDemandCpuUsage baseline 사용·갱신.
   *   scheduledCpuUsage는 건드리지 않아 scheduled tick의 측정 창이 보존됩니다.
   */
  private calculateCpuUsage(tick: boolean): number {
    const now = Date.now();
    const current = process.cpuUsage();
    this.latestCpuSnapshot = current;

    if (tick) {
      // Scheduled path
      if (this.scheduledCpuUsage === null || this.scheduledMeasurementTime === null) {
        this.scheduledCpuUsage = current;
        this.scheduledMeasurementTime = now;
        return 0;
      }
      const cpuDelta = (current.user - this.scheduledCpuUsage.user)
                     + (current.system - this.scheduledCpuUsage.system);
      const wallClockDelta = (now - this.scheduledMeasurementTime) * 1000; // ms → µs
      this.scheduledCpuUsage = current;
      this.scheduledMeasurementTime = now;
      if (wallClockDelta === 0) return this.lastCpuPercent;
      const result = Math.max(0, Math.min(100, (cpuDelta / wallClockDelta) * 100));
      this.lastCpuPercent = result;
      return result;
    } else {
      // On-demand path: always advance own baseline for fresh short-window reads;
      // never touches scheduledCpuUsage so scheduled windows stay intact.
      if (this.onDemandCpuUsage === null || this.onDemandMeasurementTime === null) {
        this.onDemandCpuUsage = current;
        this.onDemandMeasurementTime = now;
        return this.lastCpuPercent;
      }
      const cpuDelta = (current.user - this.onDemandCpuUsage.user)
                     + (current.system - this.onDemandCpuUsage.system);
      const wallClockDelta = (now - this.onDemandMeasurementTime) * 1000; // ms → µs
      this.onDemandCpuUsage = current;
      this.onDemandMeasurementTime = now;
      if (wallClockDelta === 0) return this.lastCpuPercent;
      return Math.max(0, Math.min(100, (cpuDelta / wallClockDelta) * 100));
    }
  }

  /**
   * 심각한 알림 처리
   */
  private async handleCriticalAlert(alert: PerformanceAlert, metrics: PerformanceMetrics): Promise<void> {
    logger.error('Critical performance alert handling', {
      alert,
      metrics: {
        memoryUsage: (metrics.memory.heapUsed / metrics.memory.heapTotal) * 100,
        dbSize: metrics.database.size / (1024 * 1024),
        queryTime: metrics.database.queryTime
      }
    });

    // 메모리 정리 시도
    if (alert.type === 'memory' && global.gc) {
      logger.warn('Triggering garbage collection due to high memory usage');
      global.gc();
    }

    // 데이터베이스 최적화 시도
    if (alert.type === 'database' && this.db) {
      try {
        logger.warn('Running database optimization due to large database size');
        await this.optimizeDatabase();
      } catch (error) {
        logger.error('Database optimization failed', { error: error instanceof Error ? error.message : String(error) });
      }
    }

    // 쿼리 최적화 시도
    if (alert.type === 'query') {
      logger.warn('Query optimization recommended due to slow queries');
      // 여기에 쿼리 최적화 로직 추가 가능
    }
  }

  /**
   * 데이터베이스 최적화
   */
  private async optimizeDatabase(): Promise<void> {
    if (!this.db) return;

    try {
      // VACUUM 실행
      this.db.exec('VACUUM');
      logger.info('Database VACUUM completed');
      
      // ANALYZE 실행
      this.db.exec('ANALYZE');
      logger.info('Database ANALYZE completed');
      
      // WAL 체크포인트
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      logger.info('WAL checkpoint completed');
      
    } catch (error) {
      logger.error('Database optimization failed', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * 알림 통계 조회
   */
  getAlertStats(): {
    total: number;
    active: number;
    resolved: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
    recent: PerformanceAlert[];
  } {
    const allAlerts = Array.from(this.alerts.values());
    const activeAlerts = allAlerts.filter(alert => !alert.resolved);
    const resolvedAlerts = allAlerts.filter(alert => alert.resolved);
    
    const byType = allAlerts.reduce((acc, alert) => {
      acc[alert.type] = (acc[alert.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const bySeverity = allAlerts.reduce((acc, alert) => {
      acc[alert.severity] = (acc[alert.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const recent = allAlerts
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 10);
    
    return {
      total: allAlerts.length,
      active: activeAlerts.length,
      resolved: resolvedAlerts.length,
      byType,
      bySeverity,
      recent
    };
  }

  /**
   * 알림 정리 (오래된 해결된 알림 제거)
   */
  cleanupOldAlerts(maxAgeHours: number = 24): void {
    const cutoffTime = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
    let removedCount = 0;
    
    for (const [id, alert] of this.alerts) {
      if (alert.resolved && alert.timestamp < cutoffTime) {
        this.alerts.delete(id);
        removedCount++;
      }
    }
    
    if (removedCount > 0) {
      logger.info('Old alerts cleaned', { removedCount });
    }
  }

  /**
   * 메트릭 기록 (WAL 체크포인트 스케줄러 및 락 모니터용)
   */
  recordMetric(name: string, value: number): void {
    // 메트릭을 내부 히스토리에 기록하거나 별도 저장소에 저장
    // 현재는 로깅만 수행 (향후 확장 가능)
    logger.debug(`Performance metric recorded: ${name} = ${value}`);
  }

  /**
   * 카운터 증가 (WAL 체크포인트 스케줄러 및 락 모니터용)
   */
  incrementCounter(name: string): void {
    // 카운터를 내부 저장소에 기록하거나 별도 저장소에 저장
    // 현재는 로깅만 수행 (향후 확장 가능)
    logger.debug(`Performance counter incremented: ${name}`);
  }

  /**
   * 로깅
   */
  private log(message: string, data?: any): void {
    logger.debug(`PerformanceMonitor: ${message}`, data);
  }
}

// 싱글톤 인스턴스
let monitorInstance: PerformanceMonitor | null = null;

export function getPerformanceMonitor(): PerformanceMonitor {
  if (!monitorInstance) {
    monitorInstance = new PerformanceMonitor();
  }
  return monitorInstance;
}

export function createPerformanceMonitor(thresholds?: Partial<AlertThresholds>): PerformanceMonitor {
  return new PerformanceMonitor(thresholds);
}
