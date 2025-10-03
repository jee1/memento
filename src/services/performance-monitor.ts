/**
 * 성능 모니터링 서비스
 * 시스템 성능 지표 수집, 분석, 알림 기능 제공
 */

import Database from 'better-sqlite3';

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
   * 성능 지표 수집
   */
  async collectMetrics(): Promise<PerformanceMetrics> {
    const startTime = Date.now();
    
    // 메모리 사용량
    const memUsage = process.memoryUsage();
    
    // CPU 사용량
    const cpuUsage = process.cpuUsage();
    
    // 데이터베이스 지표
    const dbMetrics = await this.getDatabaseMetrics();
    
    const metrics: PerformanceMetrics = {
      timestamp: new Date(),
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
      database: dbMetrics,
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
   * 데이터베이스 지표 수집
   */
  private async getDatabaseMetrics(): Promise<{ size: number; memoryCount: number; queryTime: number }> {
    if (!this.db) {
      return { size: 0, memoryCount: 0, queryTime: 0 };
    }

    const startTime = Date.now();
    
    try {
      // DB 크기
      const pageCount = this.db.prepare('PRAGMA page_count').get() as { page_count: number };
      const pageSize = this.db.prepare('PRAGMA page_size').get() as { page_size: number };
      const size = pageCount.page_count * pageSize.page_size;
      
      // 메모리 개수
      const memoryCount = this.db.prepare('SELECT COUNT(*) as count FROM memory_item').get() as { count: number };
      
      const queryTime = Date.now() - startTime;
      
      return {
        size,
        memoryCount: memoryCount.count,
        queryTime
      };
    } catch (error) {
      this.log('Database metrics collection failed:', error);
      return { size: 0, memoryCount: 0, queryTime: 0 };
    }
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
   * 활성 알림 조회
   */
  getActiveAlerts(): PerformanceAlert[] {
    return Array.from(this.alerts.values()).filter(alert => !alert.resolved);
  }

  /**
   * 모든 알림 조회
   */
  getAllAlerts(): PerformanceAlert[] {
    return Array.from(this.alerts.values());
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
   * 성능 지표 히스토리 조회
   */
  getMetricsHistory(limit?: number): PerformanceMetrics[] {
    if (limit) {
      return this.metricsHistory.slice(-limit);
    }
    return [...this.metricsHistory];
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
    const activeAlerts = this.getActiveAlerts();
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