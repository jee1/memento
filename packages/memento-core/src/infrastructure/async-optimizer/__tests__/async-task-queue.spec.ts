import { describe, expect, it } from 'vitest';
import { AsyncTaskQueue } from '../async-task-queue.js';
import type { TaskResult } from '../async-optimizer.types.js';

describe('AsyncTaskQueue', () => {
  describe('completed/failed 결과 Map 상한 제한', () => {
    it('completed 결과가 maxHistorySize를 초과하면 가장 오래된 항목이 제거됨', () => {
      const queue = new AsyncTaskQueue(2, null, 3);

      for (let i = 1; i <= 5; i++) {
        const result: TaskResult = {
          taskId: `task_${i}`,
          success: true,
          executionTime: 10,
          retryCount: 0,
          completedAt: new Date(Date.now() + i * 10)
        };
        queue.onTaskCompleted(`task_${i}`, result);
      }

      const completed = queue.getCompletedTasks();
      expect(completed.length).toBe(3);
      expect(queue.getResult('task_1')).toBeNull();
      expect(queue.getResult('task_2')).toBeNull();
      expect(queue.getResult('task_3')).not.toBeNull();
      expect(queue.getResult('task_4')).not.toBeNull();
      expect(queue.getResult('task_5')).not.toBeNull();
    });

    it('failed 결과가 maxHistorySize를 초과하면 가장 오래된 항목이 제거됨', () => {
      const queue = new AsyncTaskQueue(2, null, 2);

      for (let i = 1; i <= 4; i++) {
        const result: TaskResult = {
          taskId: `fail_${i}`,
          success: false,
          error: `Error ${i}`,
          executionTime: 10,
          retryCount: 0,
          completedAt: new Date(Date.now() + i * 10)
        };
        queue.onTaskFailed(`fail_${i}`, result);
      }

      const failed = queue.getFailedTasks();
      expect(failed.length).toBe(2);
      expect(queue.getResult('fail_1')).toBeNull();
      expect(queue.getResult('fail_2')).toBeNull();
      expect(queue.getResult('fail_3')).not.toBeNull();
      expect(queue.getResult('fail_4')).not.toBeNull();
    });

    it('maxHistorySize가 null이면 결과 수 제한 없이 유지됨', () => {
      const queue = new AsyncTaskQueue(2, null, null);

      for (let i = 1; i <= 10; i++) {
        queue.onTaskCompleted(`task_${i}`, {
          taskId: `task_${i}`,
          success: true,
          executionTime: 10,
          retryCount: 0
        });
      }

      expect(queue.getCompletedTasks().length).toBe(10);
    });
  });

  describe('throughput 계산', () => {
    it('작업 완료 시 throughput이 최근 60초 내 처리량으로 계산됨', () => {
      const queue = new AsyncTaskQueue(2);
      const now = new Date();

      queue.onTaskCompleted('task_1', {
        taskId: 'task_1',
        success: true,
        executionTime: 15,
        retryCount: 0,
        completedAt: now
      });

      const stats = queue.getStats();
      expect(stats.completed).toBe(1);
      expect(stats.throughput).toBeGreaterThan(0);
      expect(stats.throughput).toBeCloseTo(1 / 60, 4);
    });

    it('60초 이전 완료된 작업은 throughput 계산에서 제외됨', () => {
      const queue = new AsyncTaskQueue(2);
      const oldTime = new Date(Date.now() - 70000);

      queue.onTaskCompleted('task_old', {
        taskId: 'task_old',
        success: true,
        executionTime: 20,
        retryCount: 0,
        completedAt: oldTime
      });

      const stats = queue.getStats();
      expect(stats.completed).toBe(1);
      expect(stats.throughput).toBe(0);
    });

    it('completedAt이 number이거나 생략된 경우도 정상 처리됨', () => {
      const queue = new AsyncTaskQueue(2);

      queue.onTaskCompleted('task_num', {
        taskId: 'task_num',
        success: true,
        executionTime: 10,
        retryCount: 0,
        completedAt: Date.now() as unknown as Date
      });

      queue.onTaskFailed('task_fallback', {
        taskId: 'task_fallback',
        success: false,
        executionTime: 10,
        retryCount: 0
      });

      const stats = queue.getStats();
      expect(stats.totalProcessed).toBe(2);
      expect(stats.throughput).toBeCloseTo(2 / 60, 4);
    });
  });

  describe('clear 및 clearHistory', () => {
    it('clear() 기본 호출 시 대기 큐만 비우고 히스토리는 유지됨', () => {
      const queue = new AsyncTaskQueue(2);
      queue.addTask({ type: 'search', data: {}, priority: 1 });
      queue.onTaskCompleted('task_1', {
        taskId: 'task_1',
        success: true,
        executionTime: 10,
        retryCount: 0
      });

      expect(queue.getQueueLength()).toBe(1);
      expect(queue.getCompletedTasks().length).toBe(1);

      queue.clear();

      expect(queue.getQueueLength()).toBe(0);
      expect(queue.getCompletedTasks().length).toBe(1);
      expect(queue.getStats().pending).toBe(0);
      expect(queue.getStats().completed).toBe(1);
    });

    it('clear(true) 호출 시 큐와 히스토리가 모두 삭제되고 지표가 초기화됨', () => {
      const queue = new AsyncTaskQueue(2);
      queue.addTask({ type: 'search', data: {}, priority: 1 });
      queue.onTaskCompleted('task_1', {
        taskId: 'task_1',
        success: true,
        executionTime: 50,
        retryCount: 0
      });
      queue.onTaskFailed('task_2', {
        taskId: 'task_2',
        success: false,
        executionTime: 30,
        retryCount: 0
      });

      queue.clear(true);

      expect(queue.getQueueLength()).toBe(0);
      expect(queue.getCompletedTasks().length).toBe(0);
      expect(queue.getFailedTasks().length).toBe(0);
      const stats = queue.getStats();
      expect(stats.totalProcessed).toBe(0);
      expect(stats.averageProcessingTime).toBe(0);
      expect(stats.throughput).toBe(0);
    });

    it('clear({ clearHistory: true }) 옵션 객체 호출 시 큐와 히스토리가 모두 삭제됨', () => {
      const queue = new AsyncTaskQueue(2);
      queue.addTask({ type: 'search', data: {}, priority: 1 });
      queue.onTaskCompleted('task_1', {
        taskId: 'task_1',
        success: true,
        executionTime: 20,
        retryCount: 0
      });

      queue.clear({ clearHistory: true });

      expect(queue.getQueueLength()).toBe(0);
      expect(queue.getCompletedTasks().length).toBe(0);
    });

    it('clearHistory() 호출 시 대기 큐는 유지되고 완료/실패 히스토리만 삭제됨', () => {
      const queue = new AsyncTaskQueue(2);
      queue.addTask({ type: 'search', data: {}, priority: 1 });
      queue.onTaskCompleted('task_1', {
        taskId: 'task_1',
        success: true,
        executionTime: 20,
        retryCount: 0
      });

      queue.clearHistory();

      expect(queue.getQueueLength()).toBe(1);
      expect(queue.getCompletedTasks().length).toBe(0);
      expect(queue.getStats().completed).toBe(0);
      expect(queue.getStats().averageProcessingTime).toBe(0);
    });
  });

  describe('retryTask', () => {
    it('재시도 횟수가 남은 실패 작업은 큐로 복귀함', () => {
      const queue = new AsyncTaskQueue(2);
      queue.onTaskFailed('task_fail', {
        taskId: 'task_fail',
        success: false,
        error: 'Network timeout',
        executionTime: 20,
        retryCount: 1,
        data: {
          type: 'search',
          data: { query: 'test' },
          priority: 5,
          maxRetries: 3,
          timeout: 5000
        }
      });

      expect(queue.getFailedTasks().length).toBe(1);

      const retried = queue.retryTask('task_fail');
      expect(retried).toBe(true);
      expect(queue.getFailedTasks().length).toBe(0);
      expect(queue.getQueueLength()).toBe(1);

      const requeuedTask = queue.getNextTask();
      expect(requeuedTask?.id).toBe('task_fail');
      expect(requeuedTask?.retryCount).toBe(1);
    });

    it('최대 재시도 횟수를 소진한 실패 작업은 재시도되지 않음', () => {
      const queue = new AsyncTaskQueue(2);
      queue.onTaskFailed('task_exhausted', {
        taskId: 'task_exhausted',
        success: false,
        error: 'Fatal error',
        executionTime: 20,
        retryCount: 3,
        data: {
          type: 'search',
          data: {},
          priority: 1,
          maxRetries: 3
        }
      });

      const retried = queue.retryTask('task_exhausted');
      expect(retried).toBe(false);
      expect(queue.getFailedTasks().length).toBe(1);
      expect(queue.getQueueLength()).toBe(0);
    });

    it('존재하지 않는 작업 ID는 false 반환', () => {
      const queue = new AsyncTaskQueue(2);
      expect(queue.retryTask('non_existent')).toBe(false);
    });
  });

  describe('AsyncTaskWorker end-to-end 실행', () => {
    it('작업 실행 완료 시 completedAt이 설정되고 throughput이 반영됨', async () => {
      const queue = new AsyncTaskQueue(2);
      await queue.start();

      const taskId = queue.addTask({
        type: 'search',
        data: {},
        priority: 1,
        maxRetries: 1,
        timeout: 2000
      });
      expect(typeof taskId).toBe('string');

      await new Promise(resolve => setTimeout(resolve, 100));

      const result = queue.getResult(taskId as string);
      expect(result).not.toBeNull();
      expect(result?.success).toBe(true);
      expect(result?.completedAt).toBeInstanceOf(Date);

      const stats = queue.getStats();
      expect(stats.completed).toBe(1);
      expect(stats.throughput).toBeGreaterThan(0);

      await queue.stop();
    });

    it('실패한 작업 완료 시에도 completedAt이 설정됨', async () => {
      const queue = new AsyncTaskQueue(2);
      await queue.start();

      const taskId = queue.addTask({
        type: 'invalid_task_type',
        data: {},
        priority: 1,
        maxRetries: 0,
        timeout: 2000
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      const result = queue.getResult(taskId as string);
      expect(result).not.toBeNull();
      expect(result?.success).toBe(false);
      expect(result?.completedAt).toBeInstanceOf(Date);

      const stats = queue.getStats();
      expect(stats.failed).toBe(1);

      await queue.stop();
    });
  });
});
