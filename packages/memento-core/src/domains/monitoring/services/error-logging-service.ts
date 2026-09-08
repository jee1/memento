/**
 * 에러 로깅 서비스
 * 구조화된 에러 로깅, 분류, 모니터링, 알림 시스템
 * 
 * PRD 0019: 보안 강화 (Phase 1) - PII 마스킹 강화
 * 모든 오류 메시지, stack trace, context, metadata에 PII 마스킹 적용
 */

import { ErrorCategory,ErrorSeverity } from '../../../shared/types/error-types.js';
import { logger } from '../../../shared/utils/logger.js';
import { PIIMasker } from '../../../shared/utils/pii-masker.js';

export { ErrorCategory,ErrorSeverity };

export interface ErrorLog {
  id: string;
  timestamp: Date;
  severity: ErrorSeverity;
  category: ErrorCategory;
  message: string;
  stack?: string;
  context: {
    userId?: string;
    sessionId?: string;
    requestId?: string;
    operation?: string;
    component?: string;
    [key: string]: unknown;
  };
  metadata: {
    userAgent?: string;
    ipAddress?: string;
    memoryUsage?: NodeJS.MemoryUsage;
    cpuUsage?: NodeJS.CpuUsage;
    [key: string]: unknown;
  };
  resolved: boolean;
  resolvedAt?: Date;
  resolvedBy?: string;
}

export interface ErrorStats {
  totalErrors: number;
  errorsBySeverity: Record<ErrorSeverity, number>;
  errorsByCategory: Record<ErrorCategory, number>;
  errorsByHour: Record<string, number>;
  averageResolutionTime: number;
  criticalErrors: number;
  recentErrors: ErrorLog[];
}

export interface ErrorAlert {
  id: string;
  errorId: string;
  severity: ErrorSeverity;
  message: string;
  timestamp: Date;
  acknowledged: boolean;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
}

export class ErrorLoggingService {
  /** 알림 임계값을 판단하는 시간 창 */
  private static readonly ALERT_WINDOW_MS = 60 * 60 * 1000;

  private errors: Map<string, ErrorLog> = new Map();
  private alerts: Map<string, ErrorAlert> = new Map();
  private maxErrors: number = 10000;
  private maxAlerts: number = 1000;
  private alertThresholds: Map<ErrorSeverity, number> = new Map([
    [ErrorSeverity.LOW, 100],
    [ErrorSeverity.MEDIUM, 50],
    [ErrorSeverity.HIGH, 10],
    [ErrorSeverity.CRITICAL, 1]
  ]);
  /**
   * #936 severity 별 최근 발생 시각(ms). 알림 임계값 판단에 에러 맵 전체 스캔 대신 이 창을 쓴다.
   * 오래된 앞쪽만 잘라내므로 logError 호출당 상환 O(1)이다.
   */
  private recentErrorTimes: Map<ErrorSeverity, number[]> = new Map();

  /**
   * 에러 로깅
   */
  logError(
    error: Error | string,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    category: ErrorCategory = ErrorCategory.UNKNOWN,
    context: Partial<ErrorLog['context']> = {},
    metadata: Partial<ErrorLog['metadata']> = {}
  ): string {
    const errorId = this.generateErrorId();
    const timestamp = new Date();
    
    // PRD 0019: 보안 강화 (Phase 1) - PII 마스킹 강화
    // error.message와 error.stack에 PII 마스킹 적용
    const rawErrorMessage = typeof error === 'string' ? error : error.message;
    const errorMessage = PIIMasker.mask(rawErrorMessage).masked;
    const rawStack = typeof error === 'string' ? undefined : error.stack;
    const stack = rawStack ? PIIMasker.mask(rawStack).masked : undefined;
    
    // context와 metadata 객체의 PII 마스킹
    // 공통 유틸리티 함수 사용
    const maskedContext = PIIMasker.maskObject(context);
    const maskedMetadata = PIIMasker.maskObject({
      ...metadata,
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage()
    });
    
    const errorLog: ErrorLog = {
      id: errorId,
      timestamp,
      severity,
      category,
      message: errorMessage,
      stack,
      context: {
        ...(maskedContext as Record<string, unknown>),
        component: (maskedContext as Record<string, unknown>)['component'] as string | undefined || 'unknown'
      },
      metadata: maskedMetadata as ErrorLog['metadata'],
      resolved: false
    };

    this.errors.set(errorId, errorLog);
    this.cleanupOldErrors();
    
    // 심각도에 따른 알림 생성
    this.checkAlertThresholds(errorLog);
    
    // 콘솔 출력 (개발 환경)
    this.logToConsole(errorLog);
    
    return errorId;
  }

  /**
   * 에러 해결 처리
   */
  resolveError(errorId: string, resolvedBy: string = 'system'): boolean {
    const error = this.errors.get(errorId);
    if (!error) {
      return false;
    }

    error.resolved = true;
    error.resolvedAt = new Date();
    error.resolvedBy = resolvedBy;
    
    return true;
  }

  /**
   * 에러 통계 조회
   */
  getErrorStats(hours: number = 24): ErrorStats {
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    const recentErrors = Array.from(this.errors.values())
      .filter(error => error.timestamp >= cutoffTime);

    const errorsBySeverity: Record<ErrorSeverity, number> = {
      [ErrorSeverity.LOW]: 0,
      [ErrorSeverity.MEDIUM]: 0,
      [ErrorSeverity.HIGH]: 0,
      [ErrorSeverity.CRITICAL]: 0
    };

    const errorsByCategory: Record<ErrorCategory, number> = {
      [ErrorCategory.DATABASE]: 0,
      [ErrorCategory.NETWORK]: 0,
      [ErrorCategory.VALIDATION]: 0,
      [ErrorCategory.AUTHENTICATION]: 0,
      [ErrorCategory.PERFORMANCE]: 0,
      [ErrorCategory.MEMORY]: 0,
      [ErrorCategory.SEARCH]: 0,
      [ErrorCategory.EMBEDDING]: 0,
      [ErrorCategory.CACHE]: 0,
      [ErrorCategory.TOOL_EXECUTION]: 0,
      [ErrorCategory.UNKNOWN]: 0
    };

    const errorsByHour: Record<string, number> = {};

    recentErrors.forEach(error => {
      errorsBySeverity[error.severity]++;
      errorsByCategory[error.category]++;
      
      const hour = error.timestamp.toISOString().substring(0, 13);
      errorsByHour[hour] = (errorsByHour[hour] || 0) + 1;
    });

    const resolvedErrors = recentErrors.filter(error => error.resolved);
    const averageResolutionTime = resolvedErrors.length > 0 
      ? resolvedErrors.reduce((sum, error) => {
          if (error.resolvedAt) {
            return sum + (error.resolvedAt.getTime() - error.timestamp.getTime());
          }
          return sum;
        }, 0) / resolvedErrors.length
      : 0;

    return {
      totalErrors: recentErrors.length,
      errorsBySeverity,
      errorsByCategory,
      errorsByHour,
      averageResolutionTime,
      criticalErrors: errorsBySeverity[ErrorSeverity.CRITICAL],
      recentErrors: recentErrors.slice(-10).reverse()
    };
  }

  /**
   * 활성 알림 조회
   */
  getActiveAlerts(): ErrorAlert[] {
    return Array.from(this.alerts.values())
      .filter(alert => !alert.acknowledged)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * 알림 확인 처리
   */
  acknowledgeAlert(alertId: string, acknowledgedBy: string = 'system'): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      return false;
    }

    alert.acknowledged = true;
    alert.acknowledgedAt = new Date();
    alert.acknowledgedBy = acknowledgedBy;
    
    return true;
  }

  /**
   * 에러 검색
   */
  searchErrors(filters: {
    severity?: ErrorSeverity;
    category?: ErrorCategory;
    resolved?: boolean;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  } = {}): ErrorLog[] {
    let results = Array.from(this.errors.values());

    if (filters.severity) {
      results = results.filter(error => error.severity === filters.severity);
    }

    if (filters.category) {
      results = results.filter(error => error.category === filters.category);
    }

    if (filters.resolved !== undefined) {
      results = results.filter(error => error.resolved === filters.resolved);
    }

    if (filters.startDate) {
      results = results.filter(error => error.timestamp >= filters.startDate!);
    }

    if (filters.endDate) {
      results = results.filter(error => error.timestamp <= filters.endDate!);
    }

    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (filters.limit) {
      results = results.slice(0, filters.limit);
    }

    return results;
  }

  /**
   * 에러 ID 생성
   */
  private generateErrorId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 오래된 에러 정리
   */
  private cleanupOldErrors(): void {
    if (this.errors.size <= this.maxErrors) {
      return;
    }

    // #936 Map 은 삽입 순서를 보존하고 에러는 시간순으로 들어오므로 정렬 없이 앞에서부터 지운다.
    let remaining = this.errors.size - this.maxErrors;
    for (const id of this.errors.keys()) {
      if (remaining <= 0) {
        break;
      }
      this.errors.delete(id);
      remaining--;
    }
  }

  /**
   * 알림 임계값 확인
   */
  private checkAlertThresholds(error: ErrorLog): void {
    const threshold = this.alertThresholds.get(error.severity);
    if (!threshold) {
      return;
    }

    const recentTimes = this.recentErrorTimes.get(error.severity) ?? [];
    recentTimes.push(error.timestamp.getTime());

    // 시간 창을 벗어난 앞쪽을 잘라낸다. 창은 시간순으로만 쌓이므로 첫 유효 항목까지만 보면 된다.
    const cutoff = Date.now() - ErrorLoggingService.ALERT_WINDOW_MS;
    let expired = 0;
    while (expired < recentTimes.length && recentTimes[expired]! < cutoff) {
      expired++;
    }
    // 창 안에서 폭주해도 에러 맵과 같은 상한을 넘지 않게 한다. 임계값은 상한보다 훨씬 작아 판정은 바뀌지 않는다.
    const overCap = recentTimes.length - expired - this.maxErrors;
    const drop = overCap > 0 ? expired + overCap : expired;
    if (drop > 0) {
      recentTimes.splice(0, drop);
    }
    this.recentErrorTimes.set(error.severity, recentTimes);

    if (recentTimes.length >= threshold) {
      this.createAlert(error);
    }
  }

  /**
   * 알림 생성
   */
  private createAlert(error: ErrorLog): void {
    const alertId = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const alert: ErrorAlert = {
      id: alertId,
      errorId: error.id,
      severity: error.severity,
      message: `High error rate detected: ${error.severity} level errors`,
      timestamp: new Date(),
      acknowledged: false
    };

    this.alerts.set(alertId, alert);
    this.cleanupOldAlerts();
  }

  /**
   * 오래된 알림 정리
   */
  private cleanupOldAlerts(): void {
    if (this.alerts.size <= this.maxAlerts) {
      return;
    }

    // #936 에러 정리와 같은 이유로 정렬이 필요 없다.
    let remaining = this.alerts.size - this.maxAlerts;
    for (const id of this.alerts.keys()) {
      if (remaining <= 0) {
        break;
      }
      this.alerts.delete(id);
      remaining--;
    }
  }

  /**
   * 콘솔 로깅
   * PRD 0019: 보안 강화 (Phase 1) - PII 마스킹 강화
   * 콘솔 출력 시에도 PII 마스킹 적용 (이미 errorLog에 마스킹된 값이 저장되어 있음)
   */
  private logToConsole(error: ErrorLog): void {
    const severityColors = {
      [ErrorSeverity.LOW]: '\x1b[36m', // cyan
      [ErrorSeverity.MEDIUM]: '\x1b[33m', // yellow
      [ErrorSeverity.HIGH]: '\x1b[31m', // red
      [ErrorSeverity.CRITICAL]: '\x1b[41m\x1b[37m' // red background, white text
    };

    const _resetColor = '\x1b[0m';
    const _color = severityColors[error.severity] || '';
    
    // errorLog의 message, stack, context는 이미 마스킹되어 있음
    // 추가로 JSON 직렬화된 전체 문자열에도 마스킹 적용 (이중 방어)
    const contextJson = JSON.stringify(error.context, null, 2);
    const maskedContextJson = PIIMasker.mask(contextJson).masked;
    
    const logMeta = {
      severity: error.severity,
      category: error.category,
      id: error.id,
      timestamp: error.timestamp.toISOString(),
      message: error.message,
      component: error.context.component,
      stack: error.stack,
      context: maskedContextJson
    };
    if (error.severity === ErrorSeverity.HIGH || error.severity === ErrorSeverity.CRITICAL) {
      logger.error('에러 로깅', logMeta);
    } else {
      logger.warn('에러 로깅', logMeta);
    }
  }


  /**
   * 서비스 정리
   */
  cleanup(): void {
    this.errors.clear();
    this.alerts.clear();
    this.recentErrorTimes.clear();
  }
}
