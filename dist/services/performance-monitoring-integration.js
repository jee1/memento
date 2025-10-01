/**
 * 성능 모니터링 통합 서비스
 * 기존 성능 모니터와 알림 서비스를 통합하여 실시간 모니터링 제공
 */
import { PerformanceMonitor } from './performance-monitor.js';
import { PerformanceAlertService, AlertType, AlertLevel } from './performance-alert-service.js';
import Database from 'better-sqlite3';
export class PerformanceMonitoringIntegration {
    performanceMonitor;
    alertService;
    config;
    monitoringInterval = null;
    isMonitoring = false;
    constructor(db, alertService, config) {
        this.performanceMonitor = new PerformanceMonitor(db);
        this.alertService = alertService;
        this.config = config;
    }
    /**
     * 실시간 모니터링 시작
     */
    startRealTimeMonitoring() {
        if (this.isMonitoring) {
            console.warn('⚠️ 실시간 모니터링이 이미 실행 중입니다');
            return;
        }
        if (!this.config.enableRealTimeMonitoring) {
            console.log('ℹ️ 실시간 모니터링이 비활성화되어 있습니다');
            return;
        }
        this.isMonitoring = true;
        console.log('🚀 실시간 성능 모니터링 시작');
        this.monitoringInterval = setInterval(async () => {
            await this.performMonitoringCycle();
        }, this.config.monitoringInterval);
    }
    /**
     * 실시간 모니터링 중지
     */
    stopRealTimeMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        this.isMonitoring = false;
        console.log('🛑 실시간 성능 모니터링 중지');
    }
    /**
     * 모니터링 사이클 실행
     */
    async performMonitoringCycle() {
        try {
            const metrics = await this.performanceMonitor.collectMetrics();
            // 응답시간 체크
            if (metrics.search.averageSearchTime > 0) {
                this.alertService.checkPerformanceMetric(AlertType.RESPONSE_TIME, metrics.search.averageSearchTime, {
                    component: 'search_engine',
                    operation: 'search',
                    totalSearches: metrics.search.totalSearches
                });
            }
            // 메모리 사용량 체크
            const memoryUsageMB = metrics.memory.heapUsed / 1024 / 1024;
            this.alertService.checkPerformanceMetric(AlertType.MEMORY_USAGE, memoryUsageMB, {
                component: 'memory_manager',
                heapTotal: metrics.memory.heapTotal,
                rss: metrics.memory.rss
            });
            // 에러율 체크 (간접적으로)
            const errorRate = this.calculateErrorRate(metrics);
            if (errorRate > 0) {
                this.alertService.checkPerformanceMetric(AlertType.ERROR_RATE, errorRate, {
                    component: 'system',
                    totalOperations: metrics.database.totalMemories + metrics.search.totalSearches
                });
            }
            // 처리량 체크
            const throughput = this.calculateThroughput(metrics);
            if (throughput > 0) {
                this.alertService.checkPerformanceMetric(AlertType.THROUGHPUT, throughput, {
                    component: 'system',
                    totalOperations: metrics.database.totalMemories + metrics.search.totalSearches
                });
            }
            // 데이터베이스 성능 체크
            if (metrics.database.queryPerformance.averageQueryTime > 0) {
                this.alertService.checkPerformanceMetric(AlertType.DATABASE_PERFORMANCE, metrics.database.queryPerformance.averageQueryTime, {
                    component: 'database',
                    operation: 'query',
                    totalMemories: metrics.database.totalMemories
                });
            }
            // 캐시 성능 체크
            if (metrics.search.cacheHitRate > 0) {
                this.alertService.checkPerformanceMetric(AlertType.CACHE_PERFORMANCE, metrics.search.cacheHitRate * 100, // 백분율로 변환
                {
                    component: 'cache',
                    operation: 'search',
                    totalSearches: metrics.search.totalSearches
                });
            }
        }
        catch (error) {
            console.error('❌ 모니터링 사이클 실행 중 오류:', error);
        }
    }
    /**
     * 에러율 계산 (간접적)
     */
    calculateErrorRate(metrics) {
        // 실제 에러율 계산 로직 (현재는 간단한 추정)
        const totalOperations = metrics.database.totalMemories + metrics.search.totalSearches;
        if (totalOperations === 0)
            return 0;
        // 느린 쿼리 비율을 에러율로 간접 추정
        const slowQueries = metrics.database.queryPerformance.slowQueries.length;
        return (slowQueries / totalOperations) * 100;
    }
    /**
     * 처리량 계산
     */
    calculateThroughput(metrics) {
        const totalOperations = metrics.database.totalMemories + metrics.search.totalSearches;
        const uptimeSeconds = metrics.system.uptime / 1000;
        if (uptimeSeconds === 0)
            return 0;
        return totalOperations / uptimeSeconds; // ops/sec
    }
    /**
     * 수동 성능 체크
     */
    async performManualCheck() {
        console.log('🔍 수동 성능 체크 실행');
        await this.performMonitoringCycle();
    }
    /**
     * 알림 임계값 업데이트
     */
    updateAlertThresholds(thresholds) {
        if (thresholds.responseTime) {
            this.alertService.updateThreshold(AlertType.RESPONSE_TIME, AlertLevel.WARNING, { threshold: thresholds.responseTime.warning, operator: 'gt' });
            this.alertService.updateThreshold(AlertType.RESPONSE_TIME, AlertLevel.CRITICAL, { threshold: thresholds.responseTime.critical, operator: 'gt' });
        }
        if (thresholds.memoryUsage) {
            this.alertService.updateThreshold(AlertType.MEMORY_USAGE, AlertLevel.WARNING, { threshold: thresholds.memoryUsage.warning, operator: 'gt' });
            this.alertService.updateThreshold(AlertType.MEMORY_USAGE, AlertLevel.CRITICAL, { threshold: thresholds.memoryUsage.critical, operator: 'gt' });
        }
        if (thresholds.errorRate) {
            this.alertService.updateThreshold(AlertType.ERROR_RATE, AlertLevel.WARNING, { threshold: thresholds.errorRate.warning, operator: 'gt' });
            this.alertService.updateThreshold(AlertType.ERROR_RATE, AlertLevel.CRITICAL, { threshold: thresholds.errorRate.critical, operator: 'gt' });
        }
        if (thresholds.throughput) {
            this.alertService.updateThreshold(AlertType.THROUGHPUT, AlertLevel.WARNING, { threshold: thresholds.throughput.warning, operator: 'lt' });
            this.alertService.updateThreshold(AlertType.THROUGHPUT, AlertLevel.CRITICAL, { threshold: thresholds.throughput.critical, operator: 'lt' });
        }
        console.log('✅ 알림 임계값 업데이트 완료');
    }
    /**
     * 모니터링 상태 확인
     */
    getMonitoringStatus() {
        return {
            isMonitoring: this.isMonitoring,
            config: this.config,
            alertService: this.alertService
        };
    }
    /**
     * 서비스 정리
     */
    cleanup() {
        this.stopRealTimeMonitoring();
        this.alertService.cleanup();
    }
}
//# sourceMappingURL=performance-monitoring-integration.js.map