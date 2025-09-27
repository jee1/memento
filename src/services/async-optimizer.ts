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
  throughput: number; // tasks per second
}

export class AsyncTaskQueue {
  private queue: Task[] = [];
  private processing: Map<string, Task> = new Map();
  private completed: Map<string, TaskResult> = new Map();
  private failed: Map<string, TaskResult> = new Map();
  private workers: Set<Worker> = new Set();
  private maxWorkers: number;
  private isRunning: boolean = false;
  private stats: QueueStats = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    totalProcessed: 0,
    averageProcessingTime: 0,
    throughput: 0
  };

  constructor(maxWorkers: number = 8) {
    this.maxWorkers = maxWorkers;
  }

  /**
   * 작업 추가
   */
  addTask<T>(task: Omit<Task<T>, 'id' | 'createdAt' | 'retryCount'>): string {
    const id = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
  start(): void {
    this.isRunning = true;
    this.processNext();
  }

  /**
   * 작업 처리 중지
   */
  stop(): void {
    this.isRunning = false;
  }

  /**
   * 다음 작업 처리 - 최적화된 버전
   */
  private async processNext(): Promise<void> {
    if (!this.isRunning || this.queue.length === 0 || this.workers.size >= this.maxWorkers) {
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
      console.error(`작업 처리 실패 (${task.id}):`, error);
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
  getTaskStatus(taskId: string): 'pending' | 'processing' | 'completed' | 'failed' {
    if (this.processing.has(taskId)) return 'processing';
    if (this.completed.has(taskId)) return 'completed';
    if (this.failed.has(taskId)) return 'failed';
    return 'pending';
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
      default:
        throw new Error(`Unknown task type: ${this.task.type}`);
    }
  }

  /**
   * 메모리 작업 처리
   */
  private async processMemoryOperation(): Promise<any> {
    const { operation, content, type, tags, importance } = this.task.data;
    
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
    return { inserted: this.task.data.length };
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
  private timers: Map<string, NodeJS.Timeout> = new Map();

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
      console.error(`배치 처리 실패 (${batchKey}):`, error);
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
        console.warn(`Unknown batch key: ${batchKey}`);
    }
  }

  /**
   * 메모리 배치 처리
   */
  private async processMemoryBatch(items: any[]): Promise<void> {
    // 실제로는 데이터베이스에 배치 삽입
    console.log(`메모리 배치 처리: ${items.length}개 항목`);
  }

  /**
   * 임베딩 배치 처리
   */
  private async processEmbeddingBatch(items: any[]): Promise<void> {
    // 실제로는 임베딩 생성
    console.log(`임베딩 배치 처리: ${items.length}개 항목`);
  }

  /**
   * 검색 캐시 배치 처리
   */
  private async processSearchCacheBatch(items: any[]): Promise<void> {
    // 실제로는 캐시 업데이트
    console.log(`검색 캐시 배치 처리: ${items.length}개 항목`);
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
