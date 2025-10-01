/**
 * 성능 모니터링 통합 서비스
 * 기존 성능 모니터와 알림 서비스를 통합하여 실시간 모니터링 제공
 */
import { PerformanceAlertService } from './performance-alert-service.js';
import Database from 'better-sqlite3';
export interface MonitoringConfig {
    enableRealTimeMonitoring: boolean;
    monitoringInterval: number;
    alertThresholds: {
        responseTime: {
            warning: number;
            critical: number;
        };
        memoryUsage: {
            warning: number;
            critical: number;
        };
        errorRate: {
            warning: number;
            critical: number;
        };
        throughput: {
            warning: number;
            critical: number;
        };
    };
}
export declare class PerformanceMonitoringIntegration {
    private performanceMonitor;
    private alertService;
    private config;
    private monitoringInterval;
    private isMonitoring;
    constructor(db: Database.Database, alertService: PerformanceAlertService, config: MonitoringConfig);
    /**
     * 실시간 모니터링 시작
     */
    startRealTimeMonitoring(): void;
    /**
     * 실시간 모니터링 중지
     */
    stopRealTimeMonitoring(): void;
    /**
     * 모니터링 사이클 실행
     */
    private performMonitoringCycle;
    /**
     * 에러율 계산 (간접적)
     */
    private calculateErrorRate;
    /**
     * 처리량 계산
     */
    private calculateThroughput;
    /**
     * 수동 성능 체크
     */
    performManualCheck(): Promise<void>;
    /**
     * 알림 임계값 업데이트
     */
    updateAlertThresholds(thresholds: Partial<MonitoringConfig['alertThresholds']>): void;
    /**
     * 모니터링 상태 확인
     */
    getMonitoringStatus(): {
        isMonitoring: boolean;
        config: MonitoringConfig;
        alertService: PerformanceAlertService;
    };
    /**
     * 서비스 정리
     */
    cleanup(): void;
}
//# sourceMappingURL=performance-monitoring-integration.d.ts.map