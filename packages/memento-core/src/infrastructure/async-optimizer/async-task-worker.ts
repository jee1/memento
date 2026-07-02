import { parseFailureEventTaskData, parseMemoryOperationTaskData } from './async-optimizer-parsers.js';
import type { Task } from './async-optimizer.types.js';
import type { AsyncTaskQueue } from './async-task-queue.js';

export class AsyncTaskWorker {
  private task: Task;
  private queue: AsyncTaskQueue;
  private startTime: number;

  constructor(task: Task, queue: AsyncTaskQueue) {
    this.task = task;
    this.queue = queue;
    this.startTime = Date.now();
  }

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
        this.task.retryCount++;
        this.queue.addTask(this.task);
      } else {
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

  private async executeTask(): Promise<unknown> {
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

  private async processMemoryOperation(): Promise<Record<string, unknown>> {
    const { operation, content, type, tags, importance } = parseMemoryOperationTaskData(this.task.data);

    if (operation === 'remember') {
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

  private async processEmbedding(): Promise<{ embedding: number[] }> {
    await new Promise(resolve => setTimeout(resolve, 20 + Math.random() * 30));
    return { embedding: new Array(1536).fill(0).map(() => Math.random()) };
  }

  private async processSearch(): Promise<{ results: unknown[]; count: number }> {
    await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * 20));
    return { results: [], count: Math.floor(Math.random() * 10) };
  }

  private async processCleanup(): Promise<{ cleaned: number }> {
    await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));
    return { cleaned: Math.floor(Math.random() * 5) };
  }

  private async processBatchInsert(): Promise<{ inserted: number }> {
    await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 500));
    const payload = this.task.data;
    const length = Array.isArray(payload) ? payload.length : 0;
    return { inserted: length };
  }

  private async processFailureEvent(): Promise<{ processed: true; event_id: unknown }> {
    const { event, handler } = parseFailureEventTaskData(this.task.data);

    await handler(event);
    const eventId =
      event !== null && typeof event === 'object' && 'id' in event
        ? (event as { id: unknown }).id
        : undefined;
    return { processed: true, event_id: eventId };
  }

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
