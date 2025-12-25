/**
 * 비동기 처리 최적화 서비스
 * 워커 풀, 큐 시스템, 배치 처리 최적화
 */

import { logger } from '../shared/utils/logger.js';

export interface Task<T = unknown> {
  id: string;
  type: string;
  data: T;
  priority: number;
  createdAt: Date;
  maxRetries: number;
  retryCount: number;
  timeout: number;
}

export interface TaskResult<T = unknown> {
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
  throughput: number; // tasks per second
}

export class AsyncTaskQueue {
  private queue: Task[] = [];
  private processing: Map<string, Task> = new Map();
  private completed: Map<string, TaskResult> = new Map();
  private failed: Map<string, TaskResult> = new Map();
  private workers: Set<Worker> = new Set();
  private maxWorkers: number;
  private maxQueueSize: number | null = null; // null이면 제한 없음
  private running: boolean = false;
  private stats: QueueStats = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    totalProcessed: 0,
    averageProcessingTime: 0,
    throughput: 0
  };

  constructor(maxWorkers: number = 8, maxQueueSize: number | null = null) {
    this.maxWorkers = maxWorkers;
    this.maxQueueSize = maxQueueSize;
  }

  /**
   * 작업 추가
   */
  addTask<T>(task: Omit<Task<T>, 'id' | 'createdAt' | 'retryCount'> & { id?: string }): string | false {
    // ID 중복 검사
    if (task.id && (this.queue.some(t => t.id === task.id) || this.processing.has(task.id) || this.completed.has(task.id) || this.failed.has(task.id))) {
      return false;
    }

    // 큐 크기 제한 확인 (FIFO로 가장 오래된 항목 제거)
    if (this.maxQueueSize !== null && this.queue.length >= this.maxQueueSize) {
      // 가장 오래된 항목 제거 (FIFO)
      const removedTask = this.queue.shift();
      if (removedTask) {
        logger.warn(`큐 크기 제한 초과, 가장 오래된 작업 제거: ${removedTask.id}`, {
          queue_size: this.queue.length,
          max_size: this.maxQueueSize,
          removed_task_id: removedTask.id
        });
      }
    }

    const id = task.id || `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const fullTask: Task<T> = {
      ...task,
      id,
      createdAt: new Date(),
      retryCount: 0
    };

    this.queue.push(fullTask);
    this.queue.sort((a, b) => b.priority - a.priority); // 우선순위 정렬
    
    this.updateStats();
    this.processNext();
    
    return id;
  }

  /**
   * 작업 처리 시작
   */
  async start(): Promise<boolean> {
    if (this.running) {
      return false;
    }
    this.running = true;
    this.processNext();
    return true;
  }

  /**
   * 작업 처리 중지
   */
  async stop(): Promise<boolean> {
    if (!this.running) {
      return false;
    }
    this.running = false;
    return true;
  }

  /**
   * 다음 작업 처리 - 최적화된 버전
   */
  private async processNext(): Promise<void> {
    if (!this.running || this.queue.length === 0 || this.workers.size >= this.maxWorkers) {
      return;
    }

    const task = this.queue.shift();
    if (!task) return;

    this.processing.set(task.id, task);
    this.updateStats();

    const worker = new Worker(task, this);
    this.workers.add(worker);

    // 비동기로 실행하여 블로킹 방지
    worker.execute().catch(error => {
      logger.error(`작업 처리 실패 (${task.id}):`, { error });
    }).finally(() => {
      this.workers.delete(worker);
      this.processing.delete(task.id);
      this.updateStats();
      // 다음 작업들을 병렬로 처리
      this.processNextBatch();
    });
  }

  /**
   * 배치 처리 - 여러 작업을 동시에 처리
   */
  private processNextBatch(): void {
    const availableWorkers = this.maxWorkers - this.workers.size;
    const tasksToProcess = Math.min(availableWorkers, this.queue.length);
    
    for (let i = 0; i < tasksToProcess; i++) {
      this.processNext();
    }
  }

  /**
   * 작업 결과 가져오기
   */
  getResult(taskId: string): TaskResult | null {
    return this.completed.get(taskId) || this.failed.get(taskId) || null;
  }

  /**
   * 작업 상태 확인
   */
  getTaskStatus(taskId: string): 'pending' | 'processing' | 'completed' | 'failed' | null {
    if (this.processing.has(taskId)) return 'processing';
    if (this.completed.has(taskId)) return 'completed';
    if (this.failed.has(taskId)) return 'failed';
    if (this.queue.some(task => task.id === taskId)) return 'pending';
    return null;
  }

  /**
   * 통계 반환
   */
  getStats(): QueueStats {
    return { ...this.stats };
  }

  /**
   * 통계 업데이트
   */
  private updateStats(): void {
    this.stats.pending = this.queue.length;
    this.stats.processing = this.processing.size;
    this.stats.completed = this.completed.size;
    this.stats.failed = this.failed.size;
    this.stats.totalProcessed = this.completed.size + this.failed.size;

    // 평균 처리 시간 계산
    const allResults = [...this.completed.values(), ...this.failed.values()];
    if (allResults.length > 0) {
      this.stats.averageProcessingTime = allResults.reduce((sum, r) => sum + r.executionTime, 0) / allResults.length;
    }

    // 처리량 계산 (초당 작업 수)
    const now = Date.now();
    const recentResults = allResults.filter(r => now - r.executionTime < 60000); // 최근 1분
    this.stats.throughput = recentResults.length / 60;
  }

  /**
   * 작업 완료 처리
   */
  onTaskCompleted(taskId: string, result: TaskResult): void {
    this.completed.set(taskId, result);
    this.updateStats();
  }

  /**
   * 작업 실패 처리
   */
  onTaskFailed(taskId: string, result: TaskResult): void {
    this.failed.set(taskId, result);
    this.updateStats();
  }

  /**
   * 다음 작업 가져오기
   */
  getNextTask(): Task | null {
    return this.queue.length > 0 ? this.queue[0]! : null;
  }

  /**
   * 실행 상태 확인
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * 작업 취소
   */
  cancelTask(taskId: string): boolean {
    const taskIndex = this.queue.findIndex(task => task.id === taskId);
    if (taskIndex !== -1) {
      this.queue.splice(taskIndex, 1);
      this.updateStats();
      return true;
    }
    return false;
  }

  /**
   * 모든 대기 중인 작업 제거
   */
  clear(): void {
    this.queue = [];
    this.updateStats();
  }

  /**
   * 완료된 작업 목록 반환
   */
  getCompletedTasks(): TaskResult[] {
    return Array.from(this.completed.values());
  }

  /**
   * 실패한 작업 목록 반환
   */
  getFailedTasks(): TaskResult[] {
    return Array.from(this.failed.values());
  }

  /**
   * 작업 재시도
   */
  retryTask(taskId: string): boolean {
    const failedResult = this.failed.get(taskId);
    if (!failedResult) return false;

    // 실패한 작업의 원본 정보를 복원
    const originalTask: Task = {
      id: taskId,
      type: (failedResult.data as any)?.type || 'unknown',
      data: (failedResult.data as any)?.data || {},
      priority: (failedResult.data as any)?.priority || 0,
      createdAt: (failedResult.data as any)?.createdAt || new Date(),
      maxRetries: (failedResult.data as any)?.maxRetries || 3,
      retryCount: failedResult.retryCount,
      timeout: (failedResult.data as any)?.timeout || 30000
    };

    if (originalTask.retryCount >= originalTask.maxRetries) {
      return false;
    }

    // 실패한 작업을 다시 큐에 추가
    this.failed.delete(taskId);
    this.queue.push(originalTask);
    this.queue.sort((a, b) => b.priority - a.priority);
    this.updateStats();
    return true;
  }

  /**
   * 큐 길이 반환
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * 큐가 비어있는지 확인
   */
  isQueueEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * 처리 중인 작업 목록 반환
   */
  getProcessingTasks(): Task[] {
    return Array.from(this.processing.values());
  }

  /**
   * ID로 작업 찾기
   */
  getTaskById(taskId: string): Task | null {
    // 큐에서 찾기
    const queuedTask = this.queue.find(task => task.id === taskId);
    if (queuedTask) return queuedTask;

    // 처리 중인 작업에서 찾기
    const processingTask = this.processing.get(taskId);
    if (processingTask) return processingTask;

    return null;
  }

  /**
   * 타입별 작업 찾기
   */
  getTasksByType(type: string): Task[] {
    return this.queue.filter(task => task.type === type);
  }

  /**
   * 우선순위별 작업 찾기
   */
  getTasksByPriority(priority: number): Task[] {
    return this.queue.filter(task => task.priority === priority);
  }
}

/**
 * 워커 클래스
 */
class Worker {
  private task: Task;
  private queue: AsyncTaskQueue;
  private startTime: number;

  constructor(task: Task, queue: AsyncTaskQueue) {
    this.task = task;
    this.queue = queue;
    this.startTime = Date.now();
  }

  /**
   * 작업 실행
   */
  async execute(): Promise<void> {
    const timeout = setTimeout(() => {
      this.handleTimeout();
    }, this.task.timeout);

    try {
      const result = await this.executeTask();
      clearTimeout(timeout);
      
      this.queue.onTaskCompleted(this.task.id, {
        taskId: this.task.id,
        success: true,
        data: result,
        executionTime: Date.now() - this.startTime,
        retryCount: this.task.retryCount
      });
    } catch (error) {
      clearTimeout(timeout);
      
      if (this.task.retryCount < this.task.maxRetries) {
        // 재시도
        this.task.retryCount++;
        this.queue.addTask(this.task);
      } else {
        // 최종 실패
        this.queue.onTaskFailed(this.task.id, {
          taskId: this.task.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          executionTime: Date.now() - this.startTime,
          retryCount: this.task.retryCount
        });
      }
    }
  }

  /**
   * 실제 작업 실행 - 최적화된 버전
   */
  private async executeTask(): Promise<any> {
    switch (this.task.type) {
      case 'embedding':
        return await this.processEmbedding();
      case 'search':
        return await this.processSearch();
      case 'cleanup':
        return await this.processCleanup();
      case 'batch_insert':
        return await this.processBatchInsert();
      case 'memory_operation':
        return await this.processMemoryOperation();
      case 'failure_event':
        return await this.processFailureEvent();
      default:
        throw new Error(`Unknown task type: ${this.task.type}`);
    }
  }

  /**
   * 메모리 작업 처리
   */
  private async processMemoryOperation(): Promise<unknown> {
    const { operation, content, type, tags, importance } = this.task.data as any;
    
    // 실제 MCP 클라이언트 호출 시뮬레이션
    if (operation === 'remember') {
      // 간단한 지연 시뮬레이션 (실제로는 MCP 클라이언트 호출)
      await new Promise(resolve => setTimeout(resolve, Math.random() * 30 + 5));
      
      return {
        id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        content,
        type,
        tags,
        importance,
        created_at: new Date().toISOString()
      };
    }
    
    throw new Error(`Unknown memory operation: ${operation}`);
  }

  /**
   * 임베딩 처리 - 최적화된 버전
   */
  private async processEmbedding(): Promise<any> {
    // 임베딩 생성 시뮬레이션 (지연 시간 단축)
    await new Promise(resolve => setTimeout(resolve, 20 + Math.random() * 30));
    return { embedding: new Array(1536).fill(0).map(() => Math.random()) };
  }

  /**
   * 검색 처리 - 최적화된 버전
   */
  private async processSearch(): Promise<any> {
    // 검색 처리 시뮬레이션 (지연 시간 단축)
    await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * 20));
    return { results: [], count: Math.floor(Math.random() * 10) };
  }

  /**
   * 정리 처리
   */
  private async processCleanup(): Promise<any> {
    // 정리 처리 시뮬레이션
    await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));
    return { cleaned: Math.floor(Math.random() * 5) };
  }

  /**
   * 배치 삽입 처리
   */
  private async processBatchInsert(): Promise<any> {
    // 배치 삽입 시뮬레이션
    await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 500));
    return { inserted: (this.task.data as any[]).length };
  }

  /**
   * 실패 이벤트 처리 (FailureDetector용)
   */
  private async processFailureEvent(): Promise<any> {
    const { event, handler } = this.task.data as { event: any; handler: (event: any) => Promise<void> };
    
    if (!handler || typeof handler !== 'function') {
      throw new Error('Failure event handler is not a function');
    }
    
    await handler(event);
    return { processed: true, event_id: event.id };
  }

  /**
   * 타임아웃 처리
   */
  private handleTimeout(): void {
    this.queue.onTaskFailed(this.task.id, {
      taskId: this.task.id,
      success: false,
      error: 'Task timeout',
      executionTime: Date.now() - this.startTime,
      retryCount: this.task.retryCount
    });
  }
}

/**
 * 배치 처리 최적화 서비스
 */
export class BatchProcessor {
  private batchSize: number;
  private flushInterval: number;
  private batches: Map<string, any[]> = new Map();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(batchSize: number = 100, flushInterval: number = 5000) {
    this.batchSize = batchSize;
    this.flushInterval = flushInterval;
  }

  /**
   * 배치에 항목 추가
   */
  addToBatch<T>(batchKey: string, item: T): void {
    if (!this.batches.has(batchKey)) {
      this.batches.set(batchKey, []);
    }

    const batch = this.batches.get(batchKey)!;
    batch.push(item);

    // 배치 크기 확인
    if (batch.length >= this.batchSize) {
      this.flushBatch(batchKey);
    } else {
      // 타이머 설정
      this.setFlushTimer(batchKey);
    }
  }

  /**
   * 배치 플러시
   */
  private async flushBatch(batchKey: string): Promise<void> {
    const batch = this.batches.get(batchKey);
    if (!batch || batch.length === 0) return;

    // 타이머 제거
    const timer = this.timers.get(batchKey);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(batchKey);
    }

    // 배치 처리
    try {
      await this.processBatch(batchKey, batch);
      this.batches.set(batchKey, []);
    } catch (error) {
      logger.error(`배치 처리 실패 (${batchKey}):`, { error });
    }
  }

  /**
   * 배치 처리 구현
   */
  private async processBatch(batchKey: string, items: any[]): Promise<void> {
    switch (batchKey) {
      case 'memory_insert':
        await this.processMemoryBatch(items);
        break;
      case 'embedding_generation':
        await this.processEmbeddingBatch(items);
        break;
      case 'search_cache':
        await this.processSearchCacheBatch(items);
        break;
      default:
        logger.warn(`Unknown batch key: ${batchKey}`);
    }
  }

  /**
   * 메모리 배치 처리
   */
  private async processMemoryBatch(items: any[]): Promise<void> {
    // 실제로는 데이터베이스에 배치 삽입
    logger.info(`메모리 배치 처리: ${items.length}개 항목`);
  }

  /**
   * 임베딩 배치 처리
   */
  private async processEmbeddingBatch(items: any[]): Promise<void> {
    // 실제로는 임베딩 생성
    logger.info(`임베딩 배치 처리: ${items.length}개 항목`);
  }

  /**
   * 검색 캐시 배치 처리
   */
  private async processSearchCacheBatch(items: any[]): Promise<void> {
    // 실제로는 캐시 업데이트
    logger.info(`검색 캐시 배치 처리: ${items.length}개 항목`);
  }

  /**
   * 플러시 타이머 설정
   */
  private setFlushTimer(batchKey: string): void {
    const existingTimer = this.timers.get(batchKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.flushBatch(batchKey);
    }, this.flushInterval);

    this.timers.set(batchKey, timer);
  }

  /**
   * 모든 배치 강제 플러시
   */
  async flushAll(): Promise<void> {
    const promises = Array.from(this.batches.keys()).map(key => this.flushBatch(key));
    await Promise.all(promises);
  }

  /**
   * 배치 상태 반환
   */
  getBatchStats(): Record<string, { size: number; lastFlush: Date }> {
    const stats: Record<string, any> = {};
    
    for (const [key, batch] of this.batches) {
      stats[key] = {
        size: batch.length,
        lastFlush: new Date() // 실제로는 마지막 플러시 시간을 기록해야 함
      };
    }

    return stats;
  }
}
