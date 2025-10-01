/**
 * 에러 로깅 서비스
 * 구조화된 에러 로깅, 분류, 모니터링, 알림 시스템
 */
export var ErrorSeverity;
(function (ErrorSeverity) {
    ErrorSeverity["LOW"] = "low";
    ErrorSeverity["MEDIUM"] = "medium";
    ErrorSeverity["HIGH"] = "high";
    ErrorSeverity["CRITICAL"] = "critical";
})(ErrorSeverity || (ErrorSeverity = {}));
export var ErrorCategory;
(function (ErrorCategory) {
    ErrorCategory["DATABASE"] = "database";
    ErrorCategory["NETWORK"] = "network";
    ErrorCategory["VALIDATION"] = "validation";
    ErrorCategory["AUTHENTICATION"] = "authentication";
    ErrorCategory["PERFORMANCE"] = "performance";
    ErrorCategory["MEMORY"] = "memory";
    ErrorCategory["SEARCH"] = "search";
    ErrorCategory["EMBEDDING"] = "embedding";
    ErrorCategory["CACHE"] = "cache";
    ErrorCategory["UNKNOWN"] = "unknown";
})(ErrorCategory || (ErrorCategory = {}));
export class ErrorLoggingService {
    errors = new Map();
    alerts = new Map();
    maxErrors = 10000;
    maxAlerts = 1000;
    alertThresholds = new Map([
        [ErrorSeverity.LOW, 100],
        [ErrorSeverity.MEDIUM, 50],
        [ErrorSeverity.HIGH, 10],
        [ErrorSeverity.CRITICAL, 1]
    ]);
    /**
     * 에러 로깅
     */
    logError(error, severity = ErrorSeverity.MEDIUM, category = ErrorCategory.UNKNOWN, context = {}, metadata = {}) {
        const errorId = this.generateErrorId();
        const timestamp = new Date();
        const errorMessage = typeof error === 'string' ? error : error.message;
        const stack = typeof error === 'string' ? undefined : error.stack;
        const errorLog = {
            id: errorId,
            timestamp,
            severity,
            category,
            message: errorMessage,
            stack,
            context: {
                ...context,
                component: context.component || 'unknown'
            },
            metadata: {
                ...metadata,
                memoryUsage: process.memoryUsage(),
                cpuUsage: process.cpuUsage()
            },
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
    resolveError(errorId, resolvedBy = 'system') {
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
    getErrorStats(hours = 24) {
        const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
        const recentErrors = Array.from(this.errors.values())
            .filter(error => error.timestamp >= cutoffTime);
        const errorsBySeverity = {
            [ErrorSeverity.LOW]: 0,
            [ErrorSeverity.MEDIUM]: 0,
            [ErrorSeverity.HIGH]: 0,
            [ErrorSeverity.CRITICAL]: 0
        };
        const errorsByCategory = {
            [ErrorCategory.DATABASE]: 0,
            [ErrorCategory.NETWORK]: 0,
            [ErrorCategory.VALIDATION]: 0,
            [ErrorCategory.AUTHENTICATION]: 0,
            [ErrorCategory.PERFORMANCE]: 0,
            [ErrorCategory.MEMORY]: 0,
            [ErrorCategory.SEARCH]: 0,
            [ErrorCategory.EMBEDDING]: 0,
            [ErrorCategory.CACHE]: 0,
            [ErrorCategory.UNKNOWN]: 0
        };
        const errorsByHour = {};
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
    getActiveAlerts() {
        return Array.from(this.alerts.values())
            .filter(alert => !alert.acknowledged)
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    }
    /**
     * 알림 확인 처리
     */
    acknowledgeAlert(alertId, acknowledgedBy = 'system') {
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
    searchErrors(filters = {}) {
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
            results = results.filter(error => error.timestamp >= filters.startDate);
        }
        if (filters.endDate) {
            results = results.filter(error => error.timestamp <= filters.endDate);
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
    generateErrorId() {
        return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    /**
     * 오래된 에러 정리
     */
    cleanupOldErrors() {
        if (this.errors.size <= this.maxErrors) {
            return;
        }
        const sortedErrors = Array.from(this.errors.entries())
            .sort((a, b) => a[1].timestamp.getTime() - b[1].timestamp.getTime());
        const toDelete = sortedErrors.slice(0, this.errors.size - this.maxErrors);
        toDelete.forEach(([id]) => this.errors.delete(id));
    }
    /**
     * 알림 임계값 확인
     */
    checkAlertThresholds(error) {
        const threshold = this.alertThresholds.get(error.severity);
        if (!threshold) {
            return;
        }
        const recentErrors = Array.from(this.errors.values())
            .filter(e => e.severity === error.severity &&
            e.timestamp >= new Date(Date.now() - 60 * 60 * 1000) // 최근 1시간
        );
        if (recentErrors.length >= threshold) {
            this.createAlert(error);
        }
    }
    /**
     * 알림 생성
     */
    createAlert(error) {
        const alertId = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const alert = {
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
    cleanupOldAlerts() {
        if (this.alerts.size <= this.maxAlerts) {
            return;
        }
        const sortedAlerts = Array.from(this.alerts.entries())
            .sort((a, b) => a[1].timestamp.getTime() - b[1].timestamp.getTime());
        const toDelete = sortedAlerts.slice(0, this.alerts.size - this.maxAlerts);
        toDelete.forEach(([id]) => this.alerts.delete(id));
    }
    /**
     * 콘솔 로깅
     */
    logToConsole(error) {
        const severityColors = {
            [ErrorSeverity.LOW]: '\x1b[36m', // cyan
            [ErrorSeverity.MEDIUM]: '\x1b[33m', // yellow
            [ErrorSeverity.HIGH]: '\x1b[31m', // red
            [ErrorSeverity.CRITICAL]: '\x1b[41m\x1b[37m' // red background, white text
        };
        const resetColor = '\x1b[0m';
        const color = severityColors[error.severity] || '';
        console.error(`${color}[${error.severity.toUpperCase()}] ${error.category.toUpperCase()}${resetColor}\n` +
            `  ID: ${error.id}\n` +
            `  Time: ${error.timestamp.toISOString()}\n` +
            `  Message: ${error.message}\n` +
            `  Component: ${error.context.component}\n` +
            (error.stack ? `  Stack: ${error.stack}\n` : '') +
            `  Context: ${JSON.stringify(error.context, null, 2)}\n`);
    }
    /**
     * 서비스 정리
     */
    cleanup() {
        this.errors.clear();
        this.alerts.clear();
    }
}
//# sourceMappingURL=error-logging-service.js.map