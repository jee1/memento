/**
 * 성능 모니터링 서비스
 * 시스템 성능 지표 수집, 분석, 알림 기능 제공
 */

import Database from 'better-sqlite3';
import os from 'os';

export interface PerformanceMetrics {
  timestamp: Date;
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
  cpu: {
    user: number;
    system: number;
  };
  database: {
    size: number;
    memoryCount: number;
    queryTime: number;
  };
  uptime: number;
}

export interface AlertThresholds {
  memoryUsagePercent: number;      // 메모리 사용률 임계값 (기본: 80%)
  cpuUsagePercent: number;         // CPU 사용률 임계값 (기본: 70%)
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

  constructor(thresholds?: Partial<AlertThresholds>) {
    this.thresholds = {
      memoryUsagePercent: 80,
      cpuUsagePercent: 70,
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
    this.log('PerformanceMonitor initialized');
  }

  /**
   * 데이터베이스 설정
   */
  setDatabase(db: Database.Database | null): void {
    this.db = db;
  }

  /**
   * 성능 지표 수집
   */
  async collectMetrics(): Promise<any> {
    const startTime = Date.now();
    
    // 메모리 사용량
    const memUsage = process.memoryUsage();
    
    // CPU 사용량
    const cpuUsage = process.cpuUsage();
    
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
    
    const metrics: PerformanceMetrics = {
      timestamp: new Date(),
      database: dbMetricsForPerformance,
      memory: {
        rss: memUsage.rss,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
        external: memUsage.external
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      uptime: process.uptime()
    };

    // 지표 히스토리에 추가
    this.addToHistory(metrics);
    
    // 알림 검사
    await this.checkAlerts(metrics);
    
    const collectionTime = Date.now() - startTime;
    this.log(`Metrics collected in ${collectionTime}ms`);
    
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

    // CPU 사용률 검사 (추가)
    const cpuUsagePercent = this.calculateCpuUsage(metrics.cpu);
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
      this.log(`Alert generated: ${alert.type} - ${alert.message}`, {
        severity: alert.severity,
        value: alert.value,
        threshold: alert.threshold
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
      this.log(`Alert resolved: ${alertId}`);
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
    timestamp: Date;
  }> {
    const summary = this.getPerformanceSummary();
    const metrics = this.getMetricsHistory();
    const alerts = this.getAlerts();
    const recommendations = this.generateRecommendations(alerts);

    return {
      summary,
      metrics,
      alerts,
      recommendations,
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
        await this.collectMetrics();
      } catch (error) {
        console.error('성능 모니터링 중 오류:', error);
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
      system: currentMetrics.system,
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
    this.log('Thresholds updated', this.thresholds);
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
   * CPU 사용률 계산
   */
  private calculateCpuUsage(cpu: { user: number; system: number }): number {
    // 간단한 CPU 사용률 추정 (실제로는 더 정교한 계산 필요)
    const totalCpuTime = cpu.user + cpu.system;
    const cpuUsagePercent = Math.min(100, (totalCpuTime / 1000000) * 100); // 마이크로초를 백분율로 변환
    return cpuUsagePercent;
  }

  /**
   * 심각한 알림 처리
   */
  private async handleCriticalAlert(alert: PerformanceAlert, metrics: PerformanceMetrics): Promise<void> {
    this.log(`Critical alert handling: ${alert.type}`, {
      alert: alert,
      metrics: {
        memoryUsage: (metrics.memory.heapUsed / metrics.memory.heapTotal) * 100,
        dbSize: metrics.database.size / (1024 * 1024),
        queryTime: metrics.database.queryTime
      }
    });

    // 메모리 정리 시도
    if (alert.type === 'memory' && global.gc) {
      this.log('Triggering garbage collection due to high memory usage');
      global.gc();
    }

    // 데이터베이스 최적화 시도
    if (alert.type === 'database' && this.db) {
      try {
        this.log('Running database optimization due to large size');
        await this.optimizeDatabase();
      } catch (error) {
        this.log('Database optimization failed:', error);
      }
    }

    // 쿼리 최적화 시도
    if (alert.type === 'query') {
      this.log('Query optimization recommended due to slow queries');
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
      this.log('Database VACUUM completed');
      
      // ANALYZE 실행
      this.db.exec('ANALYZE');
      this.log('Database ANALYZE completed');
      
      // WAL 체크포인트
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      this.log('WAL checkpoint completed');
      
    } catch (error) {
      this.log('Database optimization failed:', error);
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
      this.log(`Cleaned up ${removedCount} old alerts`);
    }
  }

  /**
   * 로깅
   */
  private log(message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [PerformanceMonitor] ${message}`, data ? JSON.stringify(data, null, 2) : '');
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