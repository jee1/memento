import { describe, expect, it } from 'vitest';
import { AsyncTaskQueue } from '../async-task-queue.js';
import type { TaskResult } from '../async-optimizer.types.js';

describe('AsyncTaskQueue', () => {
  describe('버그 재현: completed/failed 결과 Map 상한 제한', () => {
    it('completed 결과가 maxHistorySize를 초과하면 가장 오래된 항목이 제거되어야 함', () => {
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

    it('failed 결과가 maxHistorySize를 초과하면 가장 오래된 항목이 제거되어야 함', () => {
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
  });

  describe('버그 재현: throughput 계산 버그', () => {
    it('작업 완료 시 throughput이 0이 아니라 최근 60초 내 처리량으로 계산되어야 함', () => {
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
      // 기존 버그에서는 executionTime(15)을 Date.now()와 비교하여 throughput이 항상 0이었음
      expect(stats.throughput).toBeGreaterThan(0);
      expect(stats.throughput).toBeCloseTo(1 / 60, 4);
    });
  });
});
