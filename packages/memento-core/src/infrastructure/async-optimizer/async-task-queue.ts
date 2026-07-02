import type { IAsyncTaskQueue } from '../../shared/interfaces/async-task-queue.interface.js';
import { logger } from '../../shared/utils/logger.js';
import { failedTaskDataToTaskFields } from './async-optimizer-parsers.js';
import type { QueueStats, Task, TaskResult } from './async-optimizer.types.js';
import { AsyncTaskWorker } from './async-task-worker.js';

export class AsyncTaskQueue implements IAsyncTaskQueue {
  private queue: Task[] = [];
  private processing: Map<string, Task> = new Map();
  private completed: Map<string, TaskResult> = new Map();
  private failed: Map<string, TaskResult> = new Map();
  private workers: Set<AsyncTaskWorker> = new Set();
  private maxWorkers: number;
  private maxQueueSize: number | null = null;
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

  addTask<T>(task: Omit<Task<T>, 'id' | 'createdAt' | 'retryCount'> & { id?: string }): string | false {
    if (task.id && (this.queue.some(t => t.id === task.id) || this.processing.has(task.id) || this.completed.has(task.id) || this.failed.has(task.id))) {
      return false;
    }

    if (this.maxQueueSize !== null && this.queue.length >= this.maxQueueSize) {
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
    this.queue.sort((a, b) => b.priority - a.priority);

    this.updateStats();
    this.processNext();

    return id;
  }

  async start(): Promise<boolean> {
    if (this.running) {
      return false;
    }
    this.running = true;
    this.processNext();
    return true;
  }

  async stop(): Promise<boolean> {
    if (!this.running) {
      return false;
    }
    this.running = false;
    return true;
  }

  private async processNext(): Promise<void> {
    if (!this.running || this.queue.length === 0 || this.workers.size >= this.maxWorkers) {
      return;
    }

    const task = this.queue.shift();
    if (!task) return;

    this.processing.set(task.id, task);
    this.updateStats();

    const worker = new AsyncTaskWorker(task, this);
    this.workers.add(worker);

    worker.execute().catch(error => {
      logger.error(`작업 처리 실패 (${task.id}):`, { error });
    }).finally(() => {
      this.workers.delete(worker);
      this.processing.delete(task.id);
      this.updateStats();
      this.processNextBatch();
    });
  }

  private processNextBatch(): void {
    const availableWorkers = this.maxWorkers - this.workers.size;
    const tasksToProcess = Math.min(availableWorkers, this.queue.length);

    for (let i = 0; i < tasksToProcess; i++) {
      this.processNext();
    }
  }

  getResult(taskId: string): TaskResult | null {
    return this.completed.get(taskId) || this.failed.get(taskId) || null;
  }

  getTaskStatus(taskId: string): 'pending' | 'processing' | 'completed' | 'failed' | null {
    if (this.processing.has(taskId)) return 'processing';
    if (this.completed.has(taskId)) return 'completed';
    if (this.failed.has(taskId)) return 'failed';
    if (this.queue.some(task => task.id === taskId)) return 'pending';
    return null;
  }

  getStats(): QueueStats {
    return { ...this.stats };
  }

  private updateStats(): void {
    this.stats.pending = this.queue.length;
    this.stats.processing = this.processing.size;
    this.stats.completed = this.completed.size;
    this.stats.failed = this.failed.size;
    this.stats.totalProcessed = this.completed.size + this.failed.size;

    const allResults = [...this.completed.values(), ...this.failed.values()];
    if (allResults.length > 0) {
      this.stats.averageProcessingTime = allResults.reduce((sum, r) => sum + r.executionTime, 0) / allResults.length;
    }

    const now = Date.now();
    const recentResults = allResults.filter(r => now - r.executionTime < 60000);
    this.stats.throughput = recentResults.length / 60;
  }

  onTaskCompleted(taskId: string, result: TaskResult): void {
    this.completed.set(taskId, result);
    this.updateStats();
  }

  onTaskFailed(taskId: string, result: TaskResult): void {
    this.failed.set(taskId, result);
    this.updateStats();
  }

  getNextTask(): Task | null {
    return this.queue.length > 0 ? this.queue[0]! : null;
  }

  isRunning(): boolean {
    return this.running;
  }

  cancelTask(taskId: string): boolean {
    const taskIndex = this.queue.findIndex(task => task.id === taskId);
    if (taskIndex !== -1) {
      this.queue.splice(taskIndex, 1);
      this.updateStats();
      return true;
    }
    return false;
  }

  clear(): void {
    this.queue = [];
    this.updateStats();
  }

  getCompletedTasks(): TaskResult[] {
    return Array.from(this.completed.values());
  }

  getFailedTasks(): TaskResult[] {
    return Array.from(this.failed.values());
  }

  retryTask(taskId: string): boolean {
    const failedResult = this.failed.get(taskId);
    if (!failedResult) return false;

    const fields = failedTaskDataToTaskFields(failedResult.data);
    const originalTask: Task = {
      id: taskId,
      type: fields.type,
      data: fields.data,
      priority: fields.priority,
      createdAt: fields.createdAt,
      maxRetries: fields.maxRetries,
      retryCount: failedResult.retryCount,
      timeout: fields.timeout
    };

    if (originalTask.retryCount >= originalTask.maxRetries) {
      return false;
    }

    this.failed.delete(taskId);
    this.queue.push(originalTask);
    this.queue.sort((a, b) => b.priority - a.priority);
    this.updateStats();
    return true;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  isQueueEmpty(): boolean {
    return this.queue.length === 0;
  }

  getProcessingTasks(): Task[] {
    return Array.from(this.processing.values());
  }

  getTaskById(taskId: string): Task | null {
    const queuedTask = this.queue.find(task => task.id === taskId);
    if (queuedTask) return queuedTask;

    const processingTask = this.processing.get(taskId);
    if (processingTask) return processingTask;

    return null;
  }

  getTasksByType(type: string): Task[] {
    return this.queue.filter(task => task.type === type);
  }

  getTasksByPriority(priority: number): Task[] {
    return this.queue.filter(task => task.priority === priority);
  }
}
