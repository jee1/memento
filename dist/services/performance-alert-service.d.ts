/**
 * 실시간 성능 알림 서비스
 * 성능 임계값 모니터링, 알림 발송, 자동 복구 제안
 */
export declare enum AlertLevel {
    INFO = "info",
    WARNING = "warning",
    CRITICAL = "critical"
}
export declare enum AlertType {
    RESPONSE_TIME = "response_time",
    MEMORY_USAGE = "memory_usage",
    ERROR_RATE = "error_rate",
    THROUGHPUT = "throughput",
    DATABASE_PERFORMANCE = "database_performance",
    CACHE_PERFORMANCE = "cache_performance"
}
export interface AlertThreshold {
    metric: AlertType;
    level: AlertLevel;
    threshold: number;
    operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
    duration?: number;
    cooldown?: number;
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
        [key: string]: any;
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
export declare class PerformanceAlertService {
    private alerts;
    private thresholds;
    private lastAlertTime;
    private logDir;
    private maxAlerts;
    constructor(logDir?: string);
    /**
     * 로그 디렉토리 초기화
     */
    private initializeLogDirectory;
    /**
     * 기본 임계값 설정
     */
    private setupDefaultThresholds;
    /**
     * 성능 메트릭 체크 및 알림 생성
     */
    checkPerformanceMetric(type: AlertType, value: number, context?: PerformanceAlert['context']): PerformanceAlert[];
    /**
     * 알림 트리거 여부 확인
     */
    private shouldTriggerAlert;
    /**
     * 임계값 평가
     */
    private evaluateThreshold;
    /**
     * 알림 생성
     */
    private createAlert;
    /**
     * 메트릭 이름 가져오기
     */
    private getMetricName;
    /**
     * 알림 메시지 생성
     */
    private generateAlertMessage;
    /**
     * 알림 발송
     */
    private sendAlert;
    /**
     * 콘솔 로깅
     */
    private logToConsole;
    /**
     * 파일 로깅
     */
    private logToFile;
    /**
     * 알림 해결 처리
     */
    resolveAlert(alertId: string, resolvedBy?: string, resolution?: string): boolean;
    /**
     * 알림 통계 조회
     */
    getAlertStats(hours?: number): AlertStats;
    /**
     * 활성 알림 조회
     */
    getActiveAlerts(): PerformanceAlert[];
    /**
     * 알림 검색
     */
    searchAlerts(filters?: {
        level?: AlertLevel;
        type?: AlertType;
        resolved?: boolean;
        startDate?: Date;
        endDate?: Date;
        limit?: number;
    }): PerformanceAlert[];
    /**
     * 임계값 설정 업데이트
     */
    updateThreshold(metric: AlertType, level: AlertLevel, threshold: Partial<AlertThreshold>): void;
    /**
     * 오래된 알림 정리
     */
    private cleanupOldAlerts;
    /**
     * 서비스 정리
     */
    cleanup(): void;
}
//# sourceMappingURL=performance-alert-service.d.ts.map