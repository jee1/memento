/**
 * 실시간 성능 알림 서비스
 * 성능 임계값 모니터링, 알림 발송, 자동 복구 제안
 */

import { appendFileSync,existsSync,mkdirSync } from 'fs';
import { join } from 'path';
import { logger } from '../../../shared/utils/logger.js';
import { PIIMasker } from '../../../shared/utils/pii-masker.js';

export enum AlertLevel {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical'
}

export enum AlertType {
  RESPONSE_TIME = 'response_time',
  MEMORY_USAGE = 'memory_usage',
  ERROR_RATE = 'error_rate',
  THROUGHPUT = 'throughput',
  DATABASE_PERFORMANCE = 'database_performance',
  CACHE_PERFORMANCE = 'cache_performance'
}

export interface AlertThreshold {
  metric: AlertType;
  level: AlertLevel;
  threshold: number;
  operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
  duration?: number; // 지속 시간 (초)
  cooldown?: number; // 알림 쿨다운 (초)
}

export interface PerformanceAlert {
  id: string;
  timestamp: Date;
  level: AlertLevel;
  type: AlertType;
  metric: string;
  value: number;
  threshold: number;
  message: string;
  context: {
    component?: string;
    operation?: string;
    userId?: string;
    sessionId?: string;
    [key: string]: unknown;
  };
  resolved: boolean;
  resolvedAt?: Date;
  resolvedBy?: string;
  resolution?: string;
}

export interface AlertStats {
  totalAlerts: number;
  alertsByLevel: Record<AlertLevel, number>;
  alertsByType: Record<AlertType, number>;
  recentAlerts: PerformanceAlert[];
  averageResolutionTime: number;
  activeAlerts: number;
}

export class PerformanceAlertService {
  private alerts: Map<string, PerformanceAlert> = new Map();
  private thresholds: Map<AlertType, AlertThreshold[]> = new Map();
  private lastAlertTime: Map<string, number> = new Map();
  private logDir: string;
  private maxAlerts: number = 10000;

  constructor(logDir: string = './logs') {
    this.logDir = logDir;
    this.initializeLogDirectory();
    this.setupDefaultThresholds();
  }

  /**
   * 로그 디렉토리 초기화
   */
  private initializeLogDirectory(): void {
    try {
      if (!existsSync(this.logDir)) {
        mkdirSync(this.logDir, { recursive: true });
      }
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      logger.warn('로그 디렉토리 생성 실패', {
        error: maskedError.message
      });
    }
  }

  /**
   * 기본 임계값 설정
   */
  private setupDefaultThresholds(): void {
    const defaultThresholds: AlertThreshold[] = [
      // 응답시간 임계값
      { metric: AlertType.RESPONSE_TIME, level: AlertLevel.WARNING, threshold: 100, operator: 'gt', duration: 30, cooldown: 300 },
      { metric: AlertType.RESPONSE_TIME, level: AlertLevel.CRITICAL, threshold: 500, operator: 'gt', duration: 10, cooldown: 60 },
      
      // 메모리 사용량 임계값
      { metric: AlertType.MEMORY_USAGE, level: AlertLevel.WARNING, threshold: 100, operator: 'gt', duration: 60, cooldown: 600 },
      { metric: AlertType.MEMORY_USAGE, level: AlertLevel.CRITICAL, threshold: 200, operator: 'gt', duration: 30, cooldown: 300 },
      
      // 에러율 임계값
      { metric: AlertType.ERROR_RATE, level: AlertLevel.WARNING, threshold: 5, operator: 'gt', duration: 60, cooldown: 300 },
      { metric: AlertType.ERROR_RATE, level: AlertLevel.CRITICAL, threshold: 10, operator: 'gt', duration: 30, cooldown: 180 },
      
      // 처리량 임계값
      { metric: AlertType.THROUGHPUT, level: AlertLevel.WARNING, threshold: 10, operator: 'lt', duration: 60, cooldown: 300 },
      { metric: AlertType.THROUGHPUT, level: AlertLevel.CRITICAL, threshold: 5, operator: 'lt', duration: 30, cooldown: 180 },
      
      // 데이터베이스 성능 임계값
      { metric: AlertType.DATABASE_PERFORMANCE, level: AlertLevel.WARNING, threshold: 50, operator: 'gt', duration: 30, cooldown: 300 },
      { metric: AlertType.DATABASE_PERFORMANCE, level: AlertLevel.CRITICAL, threshold: 100, operator: 'gt', duration: 10, cooldown: 180 },
      
      // 캐시 성능 임계값
      { metric: AlertType.CACHE_PERFORMANCE, level: AlertLevel.WARNING, threshold: 70, operator: 'lt', duration: 60, cooldown: 600 },
      { metric: AlertType.CACHE_PERFORMANCE, level: AlertLevel.CRITICAL, threshold: 50, operator: 'lt', duration: 30, cooldown: 300 }
    ];

    defaultThresholds.forEach(threshold => {
      if (!this.thresholds.has(threshold.metric)) {
        this.thresholds.set(threshold.metric, []);
      }
      this.thresholds.get(threshold.metric)!.push(threshold);
    });
  }

  /**
   * 성능 메트릭 체크 및 알림 생성
   */
  checkPerformanceMetric(
    type: AlertType,
    value: number,
    context: PerformanceAlert['context'] = {}
  ): PerformanceAlert[] {
    const triggeredAlerts: PerformanceAlert[] = [];
    const thresholds = this.thresholds.get(type) || [];

    for (const threshold of thresholds) {
      if (this.shouldTriggerAlert(threshold, value)) {
        const alert = this.createAlert(threshold, value, context);
        if (alert) {
          triggeredAlerts.push(alert);
          this.sendAlert(alert);
        }
      }
    }

    return triggeredAlerts;
  }

  /**
   * 알림 트리거 여부 확인
   */
  private shouldTriggerAlert(threshold: AlertThreshold, value: number): boolean {
    const alertKey = `${threshold.metric}_${threshold.level}`;
    const now = Date.now();
    const lastAlert = this.lastAlertTime.get(alertKey) || 0;
    const cooldown = (threshold.cooldown || 0) * 1000;

    // 쿨다운 체크
    if (now - lastAlert < cooldown) {
      return false;
    }

    // 임계값 체크
    const shouldTrigger = this.evaluateThreshold(threshold, value);
    
    if (shouldTrigger) {
      this.lastAlertTime.set(alertKey, now);
      return true;
    }

    return false;
  }

  /**
   * 임계값 평가
   */
  private evaluateThreshold(threshold: AlertThreshold, value: number): boolean {
    switch (threshold.operator) {
      case 'gt': return value > threshold.threshold;
      case 'lt': return value < threshold.threshold;
      case 'gte': return value >= threshold.threshold;
      case 'lte': return value <= threshold.threshold;
      case 'eq': return value === threshold.threshold;
      default: return false;
    }
  }

  /**
   * 알림 생성
   */
  private createAlert(threshold: AlertThreshold, value: number, context: PerformanceAlert['context']): PerformanceAlert | null {
    const alertId = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const alert: PerformanceAlert = {
      id: alertId,
      timestamp: new Date(),
      level: threshold.level,
      type: threshold.metric,
      metric: this.getMetricName(threshold.metric),
      value,
      threshold: threshold.threshold,
      message: this.generateAlertMessage(threshold, value),
      context,
      resolved: false
    };

    this.alerts.set(alertId, alert);
    this.cleanupOldAlerts();

    return alert;
  }

  /**
   * 메트릭 이름 가져오기
   */
  private getMetricName(type: AlertType): string {
    const names = {
      [AlertType.RESPONSE_TIME]: '응답시간',
      [AlertType.MEMORY_USAGE]: '메모리 사용량',
      [AlertType.ERROR_RATE]: '에러율',
      [AlertType.THROUGHPUT]: '처리량',
      [AlertType.DATABASE_PERFORMANCE]: '데이터베이스 성능',
      [AlertType.CACHE_PERFORMANCE]: '캐시 성능'
    };
    return names[type] || type;
  }

  /**
   * 알림 메시지 생성
   */
  private generateAlertMessage(threshold: AlertThreshold, value: number): string {
    const levelEmoji = {
      [AlertLevel.INFO]: '🔵',
      [AlertLevel.WARNING]: '🟡',
      [AlertLevel.CRITICAL]: '🔴'
    };

    const operatorText = {
      'gt': '초과',
      'lt': '미만',
      'gte': '이상',
      'lte': '이하',
      'eq': '일치'
    };

    return `${levelEmoji[threshold.level]} ${this.getMetricName(threshold.metric)} ${operatorText[threshold.operator]} 임계값: ${value} ${threshold.operator === 'gt' || threshold.operator === 'gte' ? '>' : threshold.operator === 'lt' || threshold.operator === 'lte' ? '<' : '='} ${threshold.threshold}`;
  }

  /**
   * 알림 발송
   */
  private sendAlert(alert: PerformanceAlert): void {
    // 콘솔 출력
    this.logToConsole(alert);
    
    // 파일 로깅
    this.logToFile(alert);
    
    // 데이터베이스 저장 (선택적)
    // this.saveToDatabase(alert);
  }

  /**
   * 콘솔 로깅
   */
  private logToConsole(alert: PerformanceAlert): void {
    const colors = {
      [AlertLevel.INFO]: '\x1b[36m', // cyan
      [AlertLevel.WARNING]: '\x1b[33m', // yellow
      [AlertLevel.CRITICAL]: '\x1b[31m' // red
    };
    const _resetColor = '\x1b[0m';
    const _color = colors[alert.level] || '';

    logger.info('성능 알림', {
      level: alert.level,
      metric: alert.metric,
      id: alert.id,
      timestamp: alert.timestamp.toISOString(),
      value: alert.value,
      threshold: alert.threshold,
      message: alert.message,
      context: alert.context
    });
  }

  /**
   * 파일 로깅
   */
  private logToFile(alert: PerformanceAlert): void {
    try {
      const logEntry = {
        timestamp: alert.timestamp.toISOString(),
        level: alert.level,
        type: alert.type,
        metric: alert.metric,
        value: alert.value,
        threshold: alert.threshold,
        message: alert.message,
        context: alert.context,
        resolved: alert.resolved
      };

      const logFile = join(this.logDir, `performance-alerts-${new Date().toISOString().split('T')[0]}.jsonl`);
      appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      logger.warn('파일 로깅 실패', {
        error: maskedError.message
      });
    }
  }

  /**
   * 알림 해결 처리
   */
  resolveAlert(alertId: string, resolvedBy: string = 'system', resolution?: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      return false;
    }

    alert.resolved = true;
    alert.resolvedAt = new Date();
    alert.resolvedBy = resolvedBy;
    alert.resolution = resolution;

    return true;
  }

  /**
   * 알림 통계 조회
   */
  getAlertStats(hours: number = 24): AlertStats {
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    const recentAlerts = Array.from(this.alerts.values())
      .filter(alert => alert.timestamp >= cutoffTime);

    const alertsByLevel: Record<AlertLevel, number> = {
      [AlertLevel.INFO]: 0,
      [AlertLevel.WARNING]: 0,
      [AlertLevel.CRITICAL]: 0
    };

    const alertsByType: Record<AlertType, number> = {
      [AlertType.RESPONSE_TIME]: 0,
      [AlertType.MEMORY_USAGE]: 0,
      [AlertType.ERROR_RATE]: 0,
      [AlertType.THROUGHPUT]: 0,
      [AlertType.DATABASE_PERFORMANCE]: 0,
      [AlertType.CACHE_PERFORMANCE]: 0
    };

    recentAlerts.forEach(alert => {
      alertsByLevel[alert.level]++;
      alertsByType[alert.type]++;
    });

    const resolvedAlerts = recentAlerts.filter(alert => alert.resolved);
    const averageResolutionTime = resolvedAlerts.length > 0 
      ? resolvedAlerts.reduce((sum, alert) => {
          if (alert.resolvedAt) {
            return sum + (alert.resolvedAt.getTime() - alert.timestamp.getTime());
          }
          return sum;
        }, 0) / resolvedAlerts.length
      : 0;

    return {
      totalAlerts: recentAlerts.length,
      alertsByLevel,
      alertsByType,
      recentAlerts: recentAlerts.slice(-10).reverse(),
      averageResolutionTime,
      activeAlerts: recentAlerts.filter(alert => !alert.resolved).length
    };
  }

  /**
   * 활성 알림 조회
   */
  getActiveAlerts(): PerformanceAlert[] {
    return Array.from(this.alerts.values())
      .filter(alert => !alert.resolved)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * 알림 검색
   */
  searchAlerts(filters: {
    level?: AlertLevel;
    type?: AlertType;
    resolved?: boolean;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  } = {}): PerformanceAlert[] {
    let results = Array.from(this.alerts.values());

    if (filters.level) {
      results = results.filter(alert => alert.level === filters.level);
    }

    if (filters.type) {
      results = results.filter(alert => alert.type === filters.type);
    }

    if (filters.resolved !== undefined) {
      results = results.filter(alert => alert.resolved === filters.resolved);
    }

    if (filters.startDate) {
      results = results.filter(alert => alert.timestamp >= filters.startDate!);
    }

    if (filters.endDate) {
      results = results.filter(alert => alert.timestamp <= filters.endDate!);
    }

    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (filters.limit) {
      results = results.slice(0, filters.limit);
    }

    return results;
  }

  /**
   * 임계값 설정 업데이트
   */
  updateThreshold(metric: AlertType, level: AlertLevel, threshold: Partial<AlertThreshold>): void {
    if (!this.thresholds.has(metric)) {
      this.thresholds.set(metric, []);
    }

    const existingThresholds = this.thresholds.get(metric)!;
    const existingIndex = existingThresholds.findIndex(t => t.level === level);
    
    const updatedThreshold: AlertThreshold = {
      metric,
      level,
      threshold: threshold.threshold || 0,
      operator: threshold.operator || 'gt',
      duration: threshold.duration,
      cooldown: threshold.cooldown
    };

    if (existingIndex >= 0) {
      existingThresholds[existingIndex] = updatedThreshold;
    } else {
      existingThresholds.push(updatedThreshold);
    }
  }

  /**
   * 오래된 알림 정리
   */
  private cleanupOldAlerts(): void {
    if (this.alerts.size <= this.maxAlerts) {
      return;
    }

    const sortedAlerts = Array.from(this.alerts.entries())
      .sort((a, b) => a[1].timestamp.getTime() - b[1].timestamp.getTime());

    const toDelete = sortedAlerts.slice(0, this.alerts.size - this.maxAlerts);
    toDelete.forEach(([id]) => this.alerts.delete(id));
  }

  /**
   * 서비스 정리
   */
  cleanup(): void {
    this.alerts.clear();
    this.lastAlertTime.clear();
  }
}
