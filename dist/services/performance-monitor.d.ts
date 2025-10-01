/**
 * 성능 모니터링 서비스
 * Memento MCP 서버의 성능 지표 수집 및 분석
 */
import Database from 'better-sqlite3';
export interface PerformanceMetrics {
    database: {
        totalMemories: number;
        memoryByType: Record<string, number>;
        averageMemorySize: number;
        databaseSize: number;
        indexUsage: Record<string, number>;
        queryPerformance: {
            averageQueryTime: number;
            slowQueries: Array<{
                query: string;
                time: number;
                count: number;
            }>;
        };
    };
    search: {
        totalSearches: number;
        averageSearchTime: number;
        searchByType: Record<string, number>;
        cacheHitRate: number;
        embeddingSearchRate: number;
    };
    memory: {
        heapUsed: number;
        heapTotal: number;
        external: number;
        rss: number;
    };
    system: {
        uptime: number;
        cpuUsage: number;
        loadAverage: number[];
    };
    timestamp: Date;
}
export interface QueryStats {
    query: string;
    count: number;
    totalTime: number;
    averageTime: number;
    lastExecuted: Date;
}
export declare class PerformanceMonitor {
    private queryStats;
    private searchStats;
    private startTime;
    private db;
    constructor(db: Database.Database);
    /**
     * 쿼리 실행 시간 측정
     */
    measureQuery<T>(queryName: string, queryFn: () => Promise<T>): Promise<T>;
    /**
     * 검색 실행 시간 측정
     */
    measureSearch<T>(searchType: string, searchFn: () => Promise<T>): Promise<T>;
    /**
     * 성능 메트릭 수집
     */
    collectMetrics(): Promise<PerformanceMetrics>;
    /**
     * 데이터베이스 메트릭 수집
     */
    private collectDatabaseMetrics;
    /**
     * 검색 메트릭 수집
     */
    private collectSearchMetrics;
    /**
     * 메모리 사용량 수집
     */
    private collectMemoryMetrics;
    /**
     * 시스템 메트릭 수집
     */
    private collectSystemMetrics;
    /**
     * 쿼리 통계 기록
     */
    private recordQueryStats;
    /**
     * 검색 통계 기록
     */
    private recordSearchStats;
    /**
     * 쿼리 성능 계산
     */
    private calculateQueryPerformance;
    /**
     * 성능 리포트 생성
     */
    generateReport(): Promise<string>;
    /**
     * 통계 초기화
     */
    resetStats(): void;
}
//# sourceMappingURL=performance-monitor.d.ts.map