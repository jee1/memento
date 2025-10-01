/**
 * 성능 벤치마크 테스트
 * Memento MCP 서버의 성능 측정 및 분석
 */
export declare class PerformanceBenchmark {
    private client;
    private performanceMonitor;
    private searchCache;
    private taskQueue;
    private results;
    constructor();
    /**
     * 전체 벤치마크 실행
     */
    runFullBenchmark(): Promise<void>;
    /**
     * 메모리 작업 벤치마크
     */
    private benchmarkMemoryOperations;
    /**
     * 검색 작업 벤치마크
     */
    private benchmarkSearchOperations;
    /**
     * 캐시 작업 벤치마크
     */
    private benchmarkCacheOperations;
    /**
     * 비동기 작업 벤치마크 - 최적화된 버전
     */
    private benchmarkAsyncOperations;
    /**
     * 동시 작업 벤치마크 - 오류 해결 버전
     */
    private benchmarkConcurrentOperations;
    /**
     * 작업 완료 대기
     */
    private waitForTaskCompletion;
    /**
     * 재시도 로직 - 오류 해결을 위한 헬퍼 메서드
     */
    private retryOperation;
    /**
     * 벤치마크 결과 계산
     */
    private calculateBenchmarkResult;
    /**
     * 결과 출력
     */
    private printResult;
    /**
     * 전체 리포트 생성
     */
    private generateReport;
}
//# sourceMappingURL=performance-benchmark.d.ts.map