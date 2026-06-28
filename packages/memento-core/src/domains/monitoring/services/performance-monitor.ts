/**
 * 성능 모니터링 서비스
 * 시스템 성능 지표 수집, 분석, 알림 기능 제공
 */

import Database from 'better-sqlite3';
import os from 'os';
import { logger } from '../../../shared/utils/logger.js';
import { CpuUsageTracker, type CpuUsageHost } from './cpu-usage-tracker.js';
import { DatabaseMetricsReader } from './database-metrics-reader.js';
import {
  formatBytes,
  getMemoryPressureDenominatorBytes,
  memoryRatioToPercent
} from './memory-pressure-utils.js';
import { PerformanceAlertManager } from './performance-alert-manager.js';
import {
  generateRecommendations,
  getMetricsAnalytics as computeMetricsAnalytics,
  getPerformanceSummary as computePerformanceSummary
} from './performance-analytics.js';
import type {
  AlertThresholds,
  PerformanceAlert,
  PerformanceMetrics
} from './performance-monitor-types.js';
import { SearchMetricsStore } from './search-metrics-store.js';

export type {
  AlertThresholds,
  PerformanceAlert,
  PerformanceMetrics
} from './performance-monitor-types.js';

export class PerformanceMonitor implements CpuUsageHost {
  private db: Database.Database | null = null;
  private alertManager: PerformanceAlertManager;
  private searchStore = new SearchMetricsStore();
  private dbReader = new DatabaseMetricsReader();
  private cpuTracker = new CpuUsageTracker();
  private metricsHistory: PerformanceMetrics[] = [];
  private maxHistorySize = 1000;
  private monitoringInterval: NodeJS.Timeout | null = null;
  // Scheduled path: only advanced by tick=true — keeps 5-min window intact
  scheduledCpuUsage: NodeJS.CpuUsage | null = null;
  scheduledMeasurementTime: number | null = null;
  // On-demand path: advanced on every tick=false call — gives fresh short-window reads
  onDemandCpuUsage: NodeJS.CpuUsage | null = null;
  onDemandMeasurementTime: number | null = null;
  latestCpuSnapshot: NodeJS.CpuUsage = { user: 0, system: 0 };
  lastCpuPercent: number = 0; // fallback; only updated by tick=true

  constructor(thresholds?: Partial<AlertThresholds>) {
    this.alertManager = new PerformanceAlertManager(thresholds);
  }

  /** @internal test / legacy access to alert thresholds */
  private get thresholds(): AlertThresholds {
    return this.alertManager.thresholds;
  }

  /** @internal test / legacy access to query resolve counter */
  private get queryConsecutiveOkCount(): number {
    return this.alertManager.queryConsecutiveOkCount;
  }

  /**
   * 모니터링 시작
   */
  initialize(db: Database.Database): void {
    this.db = db;
    this.dbReader.setDatabase(db);
    this.cpuTracker.seed(this);
    logger.info('PerformanceMonitor initialized');
  }

  /**
   * 데이터베이스 설정
   */
  setDatabase(db: Database.Database | null): void {
    this.db = db;
    this.dbReader.setDatabase(db);
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

    const memUsage = process.memoryUsage();
    const dbMetrics = await this.getDatabaseMetrics();
    const dbMetricsForPerformance = {
      size: dbMetrics.databaseSize,
      memoryCount: dbMetrics.totalMemories,
      queryTime: 0
    };

    const searchMetrics = this.getSearchMetrics();
    const memoryUsagePercent = memoryRatioToPercent(memUsage.rss, getMemoryPressureDenominatorBytes());
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

    this.addToHistory(metrics);
    await this.checkAlerts(metrics);

    const collectionTime = Date.now() - startTime;
    logger.debug('Performance metrics collected', { collectionTimeMs: collectionTime });

    return metrics;
  }

  private async checkAlerts(metrics: PerformanceMetrics): Promise<void> {
    await this.alertManager.checkAlerts(metrics, {
      memoryDenominator: getMemoryPressureDenominatorBytes(),
      formatBytes,
      onCritical: async (alert, m) => {
        if (alert.type === 'database' && this.db) {
          try {
            logger.warn('Running database optimization due to large database size');
            await this.optimizeDatabase();
          } catch (error) {
            logger.error('Database optimization failed', { error: error instanceof Error ? error.message : String(error) });
          }
        }
        void m;
      }
    });
  }

  private addToHistory(metrics: PerformanceMetrics): void {
    this.metricsHistory.push(metrics);

    if (this.metricsHistory.length > this.maxHistorySize) {
      this.metricsHistory = this.metricsHistory.slice(-this.maxHistorySize);
    }
  }

  resolveAlert(alertId: string): boolean {
    return this.alertManager.resolveAlert(alertId);
  }

  async getMetrics(): Promise<any> {
    return await this.collectMetrics();
  }

  getMetricsHistory(limit?: number): PerformanceMetrics[] {
    if (limit) {
      return this.metricsHistory.slice(-limit);
    }
    return [...this.metricsHistory];
  }

  getAlerts(): PerformanceAlert[] {
    return this.alertManager.getAlerts();
  }

  getActiveAlerts(): PerformanceAlert[] {
    return this.alertManager.getActiveAlerts();
  }

  getAllAlerts(): PerformanceAlert[] {
    return this.alertManager.getAllAlerts();
  }

  clearAlerts(): void {
    this.alertManager.clearAlerts();
  }

  async getPerformanceReport(): Promise<{
    summary: ReturnType<PerformanceMonitor['getPerformanceSummary']>;
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

  private generateRecommendations(alerts: PerformanceAlert[]): string[] {
    return generateRecommendations(alerts);
  }

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

  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  isMonitoring(): boolean {
    return this.monitoringInterval !== null;
  }

  recordSearch(type: 'text' | 'vector' | 'hybrid', duration: number, cacheHit: boolean = false): void {
    this.searchStore.recordSearch(type, duration, cacheHit);
  }

  getSearchMetrics(): ReturnType<SearchMetricsStore['getSearchMetrics']> {
    return this.searchStore.getSearchMetrics();
  }

  /**
   * 메모리 메트릭 조회
   *
   * 비율 분모는 `getMemoryPressureDenominatorBytes()`와 동일(cgroup 한도 우선).
   * - `usagePercent` / `rssUsagePercent`: RSS가 프로세스에 부여된 메모리 예산에서 차지하는 비율(100% 초과 가능).
   * - `heapShareOfBudgetPercent`: V8 heapUsed가 동일 예산 대비 차지하는 비율이며, **heapUsed/heapTotal(V8 충전률)과는 다름**.
   * - `heapUsagePercent`: `heapShareOfBudgetPercent`와 동일(하위 호환). 신규 코드는 `heapShareOfBudgetPercent` 사용.
   */
  getMemoryMetrics(): {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external: number;
    usagePercent: number;
    rssUsagePercent: number;
    heapShareOfBudgetPercent: number;
    heapUsagePercent: number;
  } {
    const memUsage = process.memoryUsage();
    const denom = getMemoryPressureDenominatorBytes();
    const rssPct = memoryRatioToPercent(memUsage.rss, denom);
    const heapSharePct = memoryRatioToPercent(memUsage.heapUsed, denom);

    return {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      rss: memUsage.rss,
      external: memUsage.external,
      usagePercent: rssPct,
      rssUsagePercent: rssPct,
      heapShareOfBudgetPercent: heapSharePct,
      heapUsagePercent: heapSharePct
    };
  }

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
      cpuUsage: (cpuUsage.user + cpuUsage.system) / 1000000,
      loadAverage
    };
  }

  async getDatabaseMetrics(): Promise<Awaited<ReturnType<DatabaseMetricsReader['getDatabaseMetrics']>>> {
    return this.dbReader.getDatabaseMetrics();
  }

  resetStats(): void {
    this.searchStore.resetStats();
  }

  async isHealthy(): Promise<boolean> {
    await this.collectMetrics();
    const alerts = this.getActiveAlerts();
    const criticalAlerts = alerts.filter((alert: PerformanceAlert) => alert.severity === 'critical');
    return criticalAlerts.length === 0;
  }

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

  async importMetrics(json: string): Promise<void> {
    const data = JSON.parse(json);

    if (data.metrics) {
      this.metricsHistory = data.metrics;
    }

    if (data.alerts) {
      this.alertManager.importAlerts(data.alerts);
    }

    if (data.search) {
      this.searchStore.importFromExportData(data.search);
    }

    if (data.metrics && Array.isArray(data.metrics)) {
      this.metricsHistory = data.metrics;
    }

    if (data.database) {
      const currentMetrics = await this.collectMetrics();
      if (currentMetrics) {
        currentMetrics.database = {
          totalMemories: data.database.totalMemories || 0,
          memoryByType: data.database.memoryByType || {},
          averageMemorySize: data.database.averageMemorySize || 0,
          databaseSize: data.database.databaseSize || 0
        } as unknown as PerformanceMetrics['database'];
        this.addToHistory(currentMetrics);
      }
    }
  }

  getPerformanceSummary(): ReturnType<typeof computePerformanceSummary> {
    return computePerformanceSummary(this.metricsHistory, {
      getAlerts: () => this.getAlerts(),
      getAllAlerts: () => this.getAllAlerts()
    });
  }

  getMetricsAnalytics(limit: number = 50): ReturnType<typeof computeMetricsAnalytics> {
    return computeMetricsAnalytics(this.metricsHistory, this.searchStore.getSearchMetrics(), limit);
  }

  updateThresholds(newThresholds: Partial<AlertThresholds>): void {
    this.alertManager.updateThresholds(newThresholds);
  }

  private calculateCpuUsage(tick: boolean): number {
    return this.cpuTracker.calculateUsage(this, tick);
  }

  private async optimizeDatabase(): Promise<void> {
    return this.dbReader.optimizeDatabase();
  }

  getAlertStats(): ReturnType<PerformanceAlertManager['getAlertStats']> {
    return this.alertManager.getAlertStats();
  }

  cleanupOldAlerts(maxAgeHours: number = 24): void {
    this.alertManager.cleanupOldAlerts(maxAgeHours);
  }

  recordMetric(name: string, value: number): void {
    logger.debug(`Performance metric recorded: ${name} = ${value}`);
  }

  incrementCounter(name: string): void {
    logger.debug(`Performance counter incremented: ${name}`);
  }
}

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
