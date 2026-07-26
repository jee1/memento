/**
 * Performance alert detection, lifecycle, and statistics
 */

import { resolveValidatedNumber } from '../../../shared/config/environment.js';
import { logger } from '../../../shared/utils/logger.js';
import { alertNotificationService } from './alert-notification-service.js';
import { getMemoryPressureDenominatorBytes, memoryRatioToPercent } from './memory-pressure-utils.js';
import type { AlertThresholds, PerformanceAlert, PerformanceMetrics } from './performance-monitor-types.js';

export interface CheckAlertsDeps {
  memoryDenominator: number;
  formatBytes: (bytes: number) => string;
  onCritical: (alert: PerformanceAlert, metrics: PerformanceMetrics) => Promise<void>;
}

const DEFAULT_ALERT_REARM_MS = 30 * 60 * 1000;

export class PerformanceAlertManager {
  thresholds: AlertThresholds;
  private alerts: Map<string, PerformanceAlert> = new Map();
  /** type → last resolve timestamp (ms); used for re-arm cooldown (#697) */
  private lastResolvedAtByType: Map<PerformanceAlert['type'], number> = new Map();
  queryConsecutiveOkCount: number = 0;

  constructor(thresholds?: Partial<AlertThresholds>) {
    this.thresholds = {
      memoryUsagePercent: resolveValidatedNumber('PERF_MEMORY_WARN_PERCENT', 85, n => n >= 1 && n <= 100, '범위 1-100'),
      cpuUsagePercent: resolveValidatedNumber('PERF_CPU_WARN_PERCENT', 75, n => n >= 1 && n <= 100, '범위 1-100'),
      databaseSizeMB: resolveValidatedNumber('PERF_DATABASE_WARN_MB', 500, n => n >= 1 && n <= 1_000_000, '범위 1-1000000'),
      queryTimeMs: 1000,
      queryResolveWindow: 3,
      alertRearmMs: resolveValidatedNumber(
        'PERF_ALERT_REARM_MS',
        DEFAULT_ALERT_REARM_MS,
        n => n >= 0 && n <= 7 * 24 * 60 * 60 * 1000,
        '범위 0-604800000'
      ),
      ...thresholds
    };
  }

  private isWithinRearmCooldown(type: PerformanceAlert['type']): boolean {
    const rearmMs = this.thresholds.alertRearmMs;
    if (rearmMs <= 0) return false;
    const lastResolved = this.lastResolvedAtByType.get(type);
    if (lastResolved === undefined) return false;
    return Date.now() - lastResolved < rearmMs;
  }

  /**
   * 알림 검사
   */
  async checkAlerts(metrics: PerformanceMetrics, deps: CheckAlertsDeps): Promise<void> {
    const alerts: PerformanceAlert[] = [];
    const now = new Date();
    const { memoryDenominator, formatBytes, onCritical } = deps;

    // 메모리 사용률 검사
    const memoryUsagePercent = metrics.memory.usagePercent;
    if (memoryUsagePercent <= this.thresholds.memoryUsagePercent) {
      // 조건 해소 시 알림을 시스템이 자동 해제한다. resolveAlert()의 acknowledgeAlert() 연쇄 호출은
      // 알림 서비스에서 해당 알림을 제거하기 위한 의도된 동작이다.
      const existing = Array.from(this.alerts.values())
        .find(a => a.type === 'memory' && !a.resolved);
      if (existing) this.resolveAlert(existing.id);
    }
    if (memoryUsagePercent > this.thresholds.memoryUsagePercent) {
      const alertId = `memory-${now.getTime()}`;
      const severity = memoryUsagePercent > 90 ? 'critical' : 'warning';

      // 중복 알림 방지 (같은 타입의 활성 알림이 있으면 스킵)
      const existingMemoryAlert = Array.from(this.alerts.values())
        .find(alert => alert.type === 'memory' && !alert.resolved);

      if (!existingMemoryAlert && !this.isWithinRearmCooldown('memory')) {
        alerts.push({
          id: alertId,
          type: 'memory',
          severity,
          message: `High memory usage: ${memoryUsagePercent.toFixed(1)}% RSS (${formatBytes(metrics.memory.rss)} / ${formatBytes(memoryDenominator)})`,
          value: memoryUsagePercent,
          threshold: this.thresholds.memoryUsagePercent,
          timestamp: now,
          resolved: false
        });
      }
    }

    // 데이터베이스 크기 검사
    // memory/cpu와 달리 DB 크기는 VACUUM 같은 명시적 외부 작업 후에만 감소한다.
    // 그러나 실제로 감소했다면 (예: VACUUM 완료) 즉시 resolve하는 것이 안전하다.
    const dbSizeMB = metrics.database.size / (1024 * 1024);
    if (dbSizeMB <= this.thresholds.databaseSizeMB) {
      const existing = Array.from(this.alerts.values())
        .find(a => a.type === 'database' && !a.resolved);
      if (existing) this.resolveAlert(existing.id);
    }
    if (dbSizeMB > this.thresholds.databaseSizeMB) {
      const alertId = `database-${now.getTime()}`;
      const severity = dbSizeMB > this.thresholds.databaseSizeMB * 1.5 ? 'critical' : 'warning';

      const existingDbAlert = Array.from(this.alerts.values())
        .find(alert => alert.type === 'database' && !alert.resolved);

      if (!existingDbAlert && !this.isWithinRearmCooldown('database')) {
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
    // 순간 스파이크가 정상이므로 연속 N회(queryResolveWindow) 임계값 이하일 때만 auto-resolve.
    // memory/cpu(즉시 해소)와 달리 sliding window를 써서 일시적 회복을 제외한다.
    if (metrics.database.queryTime <= this.thresholds.queryTimeMs) {
      const existingQueryAlert = Array.from(this.alerts.values())
        .find(a => a.type === 'query' && !a.resolved);
      if (existingQueryAlert) {
        this.queryConsecutiveOkCount++;
        if (this.queryConsecutiveOkCount >= this.thresholds.queryResolveWindow) {
          this.resolveAlert(existingQueryAlert.id);
          this.queryConsecutiveOkCount = 0;
        }
      }
    }
    if (metrics.database.queryTime > this.thresholds.queryTimeMs) {
      this.queryConsecutiveOkCount = 0; // 스파이크 발생 시 카운터 리셋
      const alertId = `query-${now.getTime()}`;
      const severity = metrics.database.queryTime > this.thresholds.queryTimeMs * 2 ? 'critical' : 'warning';

      const existingQueryAlert = Array.from(this.alerts.values())
        .find(alert => alert.type === 'query' && !alert.resolved);

      if (!existingQueryAlert && !this.isWithinRearmCooldown('query')) {
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
    if (cpuUsagePercent <= this.thresholds.cpuUsagePercent) {
      // memory와 동일: 조건 해소 시 시스템 auto-resolve. acknowledgeAlert() 연쇄는 의도된 동작.
      const existing = Array.from(this.alerts.values())
        .find(a => a.type === 'cpu' && !a.resolved);
      if (existing) this.resolveAlert(existing.id);
    }
    if (cpuUsagePercent > this.thresholds.cpuUsagePercent) {
      const alertId = `cpu-${now.getTime()}`;
      const severity = cpuUsagePercent > 90 ? 'critical' : 'warning';

      const existingCpuAlert = Array.from(this.alerts.values())
        .find(alert => alert.type === 'cpu' && !alert.resolved);

      if (!existingCpuAlert && !this.isWithinRearmCooldown('cpu')) {
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
      // #697: warning은 log-issue-monitor 승격 대상이 아닌 info, critical만 warn
      const logPayload = {
        type: alert.type,
        severity: alert.severity,
        value: alert.value,
        threshold: alert.threshold
      };
      if (alert.severity === 'critical') {
        logger.warn('Performance alert generated', logPayload);
      } else {
        logger.info('Performance alert generated', logPayload);
      }
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
        await this.handleCriticalAlert(alert, metrics, onCritical);
      }
    }
  }

  /**
   * 심각한 알림 처리
   */
  private async handleCriticalAlert(
    alert: PerformanceAlert,
    metrics: PerformanceMetrics,
    onCritical: (alert: PerformanceAlert, metrics: PerformanceMetrics) => Promise<void>
  ): Promise<void> {
    const denom = getMemoryPressureDenominatorBytes();
    logger.warn('Critical performance alert handling', {
      alert,
      metrics: {
        memoryUsage: alert.type === 'memory'
          ? alert.value
          : memoryRatioToPercent(metrics.memory.rss, denom),
        dbSize: metrics.database.size / (1024 * 1024),
        queryTime: metrics.database.queryTime
      }
    });

    // 메모리 정리 시도
    if (alert.type === 'memory' && global.gc) {
      logger.warn('Triggering garbage collection due to high memory usage');
      global.gc();
    }

    await onCritical(alert, metrics);

    // 쿼리 최적화 시도
    if (alert.type === 'query') {
      logger.warn('Query optimization recommended due to slow queries');
      // 여기에 쿼리 최적화 로직 추가 가능
    }
  }

  /**
   * 알림 해결
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (alert) {
      alert.resolved = true;
      this.lastResolvedAtByType.set(alert.type, Date.now());
      logger.info('Performance alert resolved', { alertId });
      alertNotificationService.acknowledgeAlert(alertId);
      return true;
    }
    return false;
  }

  getAlerts(): PerformanceAlert[] {
    return Array.from(this.alerts.values());
  }

  getActiveAlerts(): PerformanceAlert[] {
    return Array.from(this.alerts.values()).filter(alert => !alert.resolved);
  }

  getAllAlerts(): PerformanceAlert[] {
    return Array.from(this.alerts.values());
  }

  clearAlerts(): void {
    this.alerts.clear();
    this.lastResolvedAtByType.clear();
    this.queryConsecutiveOkCount = 0;
  }

  importAlerts(alerts: PerformanceAlert[]): void {
    this.alerts.clear();
    alerts.forEach(alert => {
      this.alerts.set(alert.id, alert);
    });
  }

  updateThresholds(newThresholds: Partial<AlertThresholds>): void {
    this.thresholds = { ...this.thresholds, ...newThresholds };
    logger.info('Performance thresholds updated', { ...this.thresholds });
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
}
