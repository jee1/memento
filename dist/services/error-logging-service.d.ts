/**
 * 에러 로깅 서비스
 * 구조화된 에러 로깅, 분류, 모니터링, 알림 시스템
 */
export declare enum ErrorSeverity {
    LOW = "low",
    MEDIUM = "medium",
    HIGH = "high",
    CRITICAL = "critical"
}
export declare enum ErrorCategory {
    DATABASE = "database",
    NETWORK = "network",
    VALIDATION = "validation",
    AUTHENTICATION = "authentication",
    PERFORMANCE = "performance",
    MEMORY = "memory",
    SEARCH = "search",
    EMBEDDING = "embedding",
    CACHE = "cache",
    UNKNOWN = "unknown"
}
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
        [key: string]: any;
    };
    metadata: {
        userAgent?: string;
        ipAddress?: string;
        memoryUsage?: NodeJS.MemoryUsage;
        cpuUsage?: NodeJS.CpuUsage;
        [key: string]: any;
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
export declare class ErrorLoggingService {
    private errors;
    private alerts;
    private maxErrors;
    private maxAlerts;
    private alertThresholds;
    /**
     * 에러 로깅
     */
    logError(error: Error | string, severity?: ErrorSeverity, category?: ErrorCategory, context?: Partial<ErrorLog['context']>, metadata?: Partial<ErrorLog['metadata']>): string;
    /**
     * 에러 해결 처리
     */
    resolveError(errorId: string, resolvedBy?: string): boolean;
    /**
     * 에러 통계 조회
     */
    getErrorStats(hours?: number): ErrorStats;
    /**
     * 활성 알림 조회
     */
    getActiveAlerts(): ErrorAlert[];
    /**
     * 알림 확인 처리
     */
    acknowledgeAlert(alertId: string, acknowledgedBy?: string): boolean;
    /**
     * 에러 검색
     */
    searchErrors(filters?: {
        severity?: ErrorSeverity;
        category?: ErrorCategory;
        resolved?: boolean;
        startDate?: Date;
        endDate?: Date;
        limit?: number;
    }): ErrorLog[];
    /**
     * 에러 ID 생성
     */
    private generateErrorId;
    /**
     * 오래된 에러 정리
     */
    private cleanupOldErrors;
    /**
     * 알림 임계값 확인
     */
    private checkAlertThresholds;
    /**
     * 알림 생성
     */
    private createAlert;
    /**
     * 오래된 알림 정리
     */
    private cleanupOldAlerts;
    /**
     * 콘솔 로깅
     */
    private logToConsole;
    /**
     * 서비스 정리
     */
    cleanup(): void;
}
//# sourceMappingURL=error-logging-service.d.ts.map