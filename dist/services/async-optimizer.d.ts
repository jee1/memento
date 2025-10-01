/**
 * 비동기 처리 최적화 서비스
 * 워커 풀, 큐 시스템, 배치 처리 최적화
 */
export interface Task<T = any> {
    id: string;
    type: string;
    data: any;
    priority: number;
    createdAt: Date;
    maxRetries: number;
    retryCount: number;
    timeout: number;
}
export interface TaskResult<T = any> {
    taskId: string;
    success: boolean;
    data?: T;
    error?: string;
    executionTime: number;
    retryCount: number;
}
export interface QueueStats {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    totalProcessed: number;
    averageProcessingTime: number;
    throughput: number;
}
export declare class AsyncTaskQueue {
    private queue;
    private processing;
    private completed;
    private failed;
    private workers;
    private maxWorkers;
    private isRunning;
    private stats;
    constructor(maxWorkers?: number);
    /**
     * 작업 추가
     */
    addTask<T>(task: Omit<Task<T>, 'id' | 'createdAt' | 'retryCount'>): string;
    /**
     * 작업 처리 시작
     */
    start(): void;
    /**
     * 작업 처리 중지
     */
    stop(): void;
    /**
     * 다음 작업 처리 - 최적화된 버전
     */
    private processNext;
    /**
     * 배치 처리 - 여러 작업을 동시에 처리
     */
    private processNextBatch;
    /**
     * 작업 결과 가져오기
     */
    getResult(taskId: string): TaskResult | null;
    /**
     * 작업 상태 확인
     */
    getTaskStatus(taskId: string): 'pending' | 'processing' | 'completed' | 'failed';
    /**
     * 통계 반환
     */
    getStats(): QueueStats;
    /**
     * 통계 업데이트
     */
    private updateStats;
    /**
     * 작업 완료 처리
     */
    onTaskCompleted(taskId: string, result: TaskResult): void;
    /**
     * 작업 실패 처리
     */
    onTaskFailed(taskId: string, result: TaskResult): void;
}
/**
 * 배치 처리 최적화 서비스
 */
export declare class BatchProcessor {
    private batchSize;
    private flushInterval;
    private batches;
    private timers;
    constructor(batchSize?: number, flushInterval?: number);
    /**
     * 배치에 항목 추가
     */
    addToBatch<T>(batchKey: string, item: T): void;
    /**
     * 배치 플러시
     */
    private flushBatch;
    /**
     * 배치 처리 구현
     */
    private processBatch;
    /**
     * 메모리 배치 처리
     */
    private processMemoryBatch;
    /**
     * 임베딩 배치 처리
     */
    private processEmbeddingBatch;
    /**
     * 검색 캐시 배치 처리
     */
    private processSearchCacheBatch;
    /**
     * 플러시 타이머 설정
     */
    private setFlushTimer;
    /**
     * 모든 배치 강제 플러시
     */
    flushAll(): Promise<void>;
    /**
     * 배치 상태 반환
     */
    getBatchStats(): Record<string, {
        size: number;
        lastFlush: Date;
    }>;
}
//# sourceMappingURL=async-optimizer.d.ts.map