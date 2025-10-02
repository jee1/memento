import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AsyncTaskQueue, type Task, type TaskResult, type QueueStats } from './async-optimizer.js';

// Mock Worker
class MockWorker {
  onmessage: ((event: any) => void) | null = null;
  onerror: ((error: any) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
}

// Mock global Worker
global.Worker = MockWorker as any;

describe('AsyncTaskQueue', () => {
  let taskQueue: AsyncTaskQueue;
  let mockWorker: MockWorker;

  beforeEach(() => {
    vi.clearAllMocks();
    taskQueue = new AsyncTaskQueue(2); // 2 workers
    mockWorker = new MockWorker();
  });

  afterEach(async () => {
    await taskQueue.stop();
  });

  describe('생성자', () => {
    it('기본 설정으로 생성되어야 함', () => {
      const defaultQueue = new AsyncTaskQueue();
      expect(defaultQueue).toBeInstanceOf(AsyncTaskQueue);
    });

    it('사용자 정의 설정으로 생성되어야 함', () => {
      const customQueue = new AsyncTaskQueue(5);
      expect(customQueue).toBeInstanceOf(AsyncTaskQueue);
    });
  });

  describe('addTask', () => {
    it('작업을 큐에 추가해야 함', () => {
      const task: Task = {
        id: 'task-1',
        type: 'test',
        data: { message: 'hello' },
        priority: 1,
        createdAt: new Date(),
        maxRetries: 3,
        retryCount: 0,
        timeout: 5000
      };

      taskQueue.addTask(task);

      const stats = taskQueue.getStats();
      expect(stats.pending).toBe(1);
    });

    it('중복 ID 작업을 거부해야 함', () => {
      const task: Task = {
        id: 'task-1',
        type: 'test',
        data: { message: 'hello' },
        priority: 1,
        createdAt: new Date(),
        maxRetries: 3,
        retryCount: 0,
        timeout: 5000
      };

      taskQueue.addTask(task);
      const result = taskQueue.addTask(task);

      expect(result).toBe(false);
      const stats = taskQueue.getStats();
      expect(stats.pending).toBe(1);
    });

    it('우선순위에 따라 정렬되어야 함', () => {
      const highPriorityTask: Task = {
        id: 'task-high',
        type: 'test',
        data: { message: 'high' },
        priority: 10,
        createdAt: new Date(),
        maxRetries: 3,
        retryCount: 0,
        timeout: 5000
      };

      const lowPriorityTask: Task = {
        id: 'task-low',
        type: 'test',
        data: { message: 'low' },
        priority: 1,
        createdAt: new Date(),
        maxRetries: 3,
        retryCount: 0,
        timeout: 5000
      };

      taskQueue.addTask(lowPriorityTask);
      taskQueue.addTask(highPriorityTask);

      const nextTask = taskQueue.getNextTask();
      expect(nextTask?.id).toBe('task-high');
    });
  });

  describe('getNextTask', () => {
    it('큐가 비어있으면 null을 반환해야 함', () => {
      const nextTask = taskQueue.getNextTask();
      expect(nextTask).toBeNull();
    });

    it('가장 높은 우선순위 작업을 반환해야 함', () => {
      const task1: Task = {
        id: 'task-1',
        type: 'test',
        data: { message: 'low' },
        priority: 1,
        createdAt: new Date(),
        maxRetries: 3,
        retryCount: 0,
        timeout: 5000
      };

      const task2: Task = {
        id: 'task-2',
        type: 'test',
        data: { message: 'high' },
        priority: 10,
        createdAt: new Date(),
        maxRetries: 3,
        retryCount: 0,
        timeout: 5000
      };

      taskQueue.addTask(task1);
      taskQueue.addTask(task2);

      const nextTask = taskQueue.getNextTask();
      expect(nextTask?.id).toBe('task-2');
    });

    it('동일한 우선순위일 때 먼저 추가된 작업을 반환해야 함', () => {
      const task1: Task = {
        id: 'task-1',
        type: 'test',
        data: { message: 'first' },
        priority: 5,
        createdAt: new Date(Date.now() - 1000),
        maxRetries: 3,
        retryCount: 0,
        timeout: 5000
      };

      const task2: Task = {
        id: 'task-2',
        type: 'test',
        data: { message: 'second' },
        priority: 5,
        createdAt: new Date(),
        maxRetries: 3,
        retryCount: 0,
        timeout: 5000
      };

      taskQueue.addTask(task1);
      taskQueue.addTask(task2);

      const nextTask = taskQueue.getNextTask();
      expect(nextTask?.id).toBe('task-1');
    });
  });

  describe('start', () => {
    it('워커 풀을 시작해야 함', async () => {
      await taskQueue.start();
      expect(taskQueue.isRunning()).toBe(true);
    });

    it('이미 실행 중일 때 중복 시작을 방지해야 함', async () => {
      await taskQueue.start();
      const result = await taskQueue.start();
      expect(result).toBe(false);
    });
  });

  describe('stop', () => {
    it('워커 풀을 중지해야 함', async () => {
      await taskQueue.start();
      await taskQueue.stop();
      expect(taskQueue.isRunning()).toBe(false);
    });

    it('이미 중지된 상태에서 중복 중지를 방지해야 함', async () => {
      const result = await taskQueue.stop();
      expect(result).toBe(false);
    });
  });

  describe('isRunning', () => {
    it('초기 상태에서는 false를 반환해야 함', () => {
      expect(taskQueue.isRunning()).toBe(false);
    });

    it('시작 후에는 true를 반환해야 함', async () => {
      await taskQueue.start();
      expect(taskQueue.isRunning()).toBe(true);
    });

    it('중지 후에는 false를 반환해야 함', async () => {
      await taskQueue.start();
      await taskQueue.stop();
      expect(taskQueue.isRunning()).toBe(false);
    });
  });

  describe('getStats', () => {
    it('초기 통계를 반환해야 함', () => {
      const stats = taskQueue.getStats();
      
      expect(stats.pending).toBe(0);
      expect(stats.processing).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.totalProcessed).toBe(0);
      expect(stats.averageProcessingTime).toBe(0);
      expect(stats.throughput).toBe(0);
    });

    it('작업 추가 후 통계를 업데이트해야 함', () => {
      const task: Task = {
        id: 'task-1',
        type: 'test',
        data: { message: 'hello' },
        priority: 1,
        createdAt: new Date(),
        maxRetries: 3,
        retryCount: 0,
        timeout: 5000
      };

      taskQueue.addTask(task);
      const stats = taskQueue.getStats();
      expect(stats.pending).toBe(1);
    });
  });

  describe('getTaskStatus', () => {
    it('존재하지 않는 작업에 대해 null을 반환해야 함', () => {
      const status = taskQueue.getTaskStatus('nonexistent');
      expect(status).toBeNull();
    });

    it('대기 중인 작업의 상태를 반환해야 함', () => {
      const task: Task = {
        id: 'task-1',
        type: 'test',
        data: { message: 'hello' },
        priority: 1,
        createdAt: new Date(),
        maxRetries: 3,
        retryCount: 0,
        timeout: 5000
      };

      taskQueue.addTask(task);
      const status = taskQueue.getTaskStatus('task-1');
      expect(status).toBe('pending');
    });
  });

  describe('cancelTask', () => {
    it('대기 중인 작업을 취소해야 함', () => {
      const task: Task = {
        id: 'task-1',
        type: 'test',
        data: { message: 'hello' },
        priority: 1,
        createdAt: new Date(),
        maxRetries: 3,
        retryCount: 0,
        timeout: 5000
      };

      taskQueue.addTask(task);
      const result = taskQueue.cancelTask('task-1');
      
      expect(result).toBe(true);
      const stats = taskQueue.getStats();
      expect(stats.pending).toBe(0);
    });

    it('존재하지 않는 작업 취소 시 false를 반환해야 함', () => {
      const result = taskQueue.cancelTask('nonexistent');
      expect(result).toBe(false);
    });

    it('처리 중인 작업은 취소할 수 없어야 함', async () => {
      const task: Task = {
        id: 'task-1',
        type: 'test',
        data: { message: 'hello' },
        priority: 1,
        createdAt: new Date(),
        maxRetries: 3,
        retryCount: 0,
        timeout: 5000
      };

      taskQueue.addTask(task);
      await taskQueue.start();
      
      // 작업이 처리되기 전에 취소 시도
      const result = taskQueue.cancelTask('task-1');
      expect(result).toBe(false);
    });
  });

  describe('clear', () => {
    it('모든 대기 중인 작업을 제거해야 함', () => {
      const task1: Task = {
        id: 'task-1',
        type: 'test',
        data: { message: 'hello' },
        priority: 1,
        createdAt: new Date(),
        maxRetries: 3,
        retryCount: 0,
        timeout: 5000
      };

      const task2: Task = {
        id: 'task-2',
        type: 'test',
        data: { message: 'world' },
        priority: 2,
        createdAt: new Date(),
        maxRetries: 3,
        retryCount: 0,
        timeout: 5000
      };

      taskQueue.addTask(task1);
      taskQueue.addTask(task2);
      
      expect(taskQueue.getStats().pending).toBe(2);
      
      taskQueue.clear();
      
      expect(taskQueue.getStats().pending).toBe(0);
    });
  });

  describe('getCompletedTasks', () => {
    it('완료된 작업 목록을 반환해야 함', () => {
      const completed = taskQueue.getCompletedTasks();
      expect(Array.isArray(completed)).toBe(true);
    });
  });

  describe('getFailedTasks', () => {
    it('실패한 작업 목록을 반환해야 함', () => {
      const failed = taskQueue.getFailedTasks();
      expect(Array.isArray(failed)).toBe(true);
    });
  });

  describe('retryTask', () => {
    it('실패한 작업을 재시도해야 함', () => {
      const task: Task = {
        id: 'task-1',
        type: 'test',
        data: { message: 'hello' },
        priority: 1,
        createdAt: new Date(),
        maxRetries: 3,
        retryCount: 1,
        timeout: 5000
      };

      // 실패한 작업으로 설정
      (taskQueue as any).failed.set('task-1', {
        taskId: 'task-1',
        success: false,
        error: 'Test error',
        executionTime: 100,
        retryCount: 1
      });

      const result = taskQueue.retryTask('task-1');
      expect(result).toBe(true);
      
      const stats = taskQueue.getStats();
      expect(stats.pending).toBe(1);
    });

    it('존재하지 않는 작업 재시도 시 false를 반환해야 함', () => {
      const result = taskQueue.retryTask('nonexistent');
      expect(result).toBe(false);
    });

    it('최대 재시도 횟수 초과 시 false를 반환해야 함', () => {
      const task: Task = {
        id: 'task-1',
        type: 'test',
        data: { message: 'hello' },
        priority: 1,
        createdAt: new Date(),
        maxRetries: 3,
        retryCount: 3, // 최대 재시도 횟수
        timeout: 5000
      };

      (taskQueue as any).failed.set('task-1', {
        taskId: 'task-1',
        success: false,
        error: 'Test error',
        executionTime: 100,
        retryCount: 3
      });

      const result = taskQueue.retryTask('task-1');
      expect(result).toBe(false);
    });
  });

  describe('getQueueLength', () => {
    it('큐 길이를 반환해야 함', () => {
      expect(taskQueue.getQueueLength()).toBe(0);
      
      const task: Task = {
        id: 'task-1',
        type: 'test',
        data: { message: 'hello' },
        priority: 1,
        createdAt: new Date(),
        maxRetries: 3,
        retryCount: 0,
        timeout: 5000
      };

      taskQueue.addTask(task);
      expect(taskQueue.getQueueLength()).toBe(1);
    });
  });

  describe('isQueueEmpty', () => {
    it('빈 큐에 대해 true를 반환해야 함', () => {
      expect(taskQueue.isQueueEmpty()).toBe(true);
    });

    it('작업이 있는 큐에 대해 false를 반환해야 함', () => {
      const task: Task = {
        id: 'task-1',
        type: 'test',
        data: { message: 'hello' },
        priority: 1,
        createdAt: new Date(),
        maxRetries: 3,
        retryCount: 0,
        timeout: 5000
      };

      taskQueue.addTask(task);
      expect(taskQueue.isQueueEmpty()).toBe(false);
    });
  });

  describe('getProcessingTasks', () => {
    it('처리 중인 작업 목록을 반환해야 함', () => {
      const processing = taskQueue.getProcessingTasks();
      expect(Array.isArray(processing)).toBe(true);
    });
  });

  describe('getTaskById', () => {
    it('존재하는 작업을 반환해야 함', () => {
      const task: Task = {
        id: 'task-1',
        type: 'test',
        data: { message: 'hello' },
        priority: 1,
        createdAt: new Date(),
        maxRetries: 3,
        retryCount: 0,
        timeout: 5000
      };

      taskQueue.addTask(task);
      const foundTask = taskQueue.getTaskById('task-1');
      expect(foundTask).toEqual(task);
    });

    it('존재하지 않는 작업에 대해 null을 반환해야 함', () => {
      const foundTask = taskQueue.getTaskById('nonexistent');
      expect(foundTask).toBeNull();
    });
  });

  describe('getTasksByType', () => {
    it('특정 타입의 작업을 반환해야 함', () => {
      const task1: Task = {
        id: 'task-1',
        type: 'test',
        data: { message: 'hello' },
        priority: 1,
        createdAt: new Date(),
        maxRetries: 3,
        retryCount: 0,
        timeout: 5000
      };

      const task2: Task = {
        id: 'task-2',
        type: 'other',
        data: { message: 'world' },
        priority: 1,
        createdAt: new Date(),
        maxRetries: 3,
        retryCount: 0,
        timeout: 5000
      };

      taskQueue.addTask(task1);
      taskQueue.addTask(task2);

      const testTasks = taskQueue.getTasksByType('test');
      expect(testTasks).toHaveLength(1);
      expect(testTasks[0].id).toBe('task-1');
    });
  });

  describe('getTasksByPriority', () => {
    it('특정 우선순위의 작업을 반환해야 함', () => {
      const task1: Task = {
        id: 'task-1',
        type: 'test',
        data: { message: 'hello' },
        priority: 5,
        createdAt: new Date(),
        maxRetries: 3,
        retryCount: 0,
        timeout: 5000
      };

      const task2: Task = {
        id: 'task-2',
        type: 'test',
        data: { message: 'world' },
        priority: 10,
        createdAt: new Date(),
        maxRetries: 3,
        retryCount: 0,
        timeout: 5000
      };

      taskQueue.addTask(task1);
      taskQueue.addTask(task2);

      const highPriorityTasks = taskQueue.getTasksByPriority(10);
      expect(highPriorityTasks).toHaveLength(1);
      expect(highPriorityTasks[0].id).toBe('task-2');
    });
  });
});
