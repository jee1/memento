/**
 * JobQueue 테스트
 * 작업 큐 관리 기능 테스트
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JobQueue, type QueuedJob } from '../job-queue.js';

describe('JobQueue', () => {
  let queue: JobQueue;

  beforeEach(() => {
    queue = new JobQueue();
  });

  describe('add', () => {
    it('should add job to queue', () => {
      // Given: 빈 큐
      const job = async () => {};

      // When: 작업 추가
      const result = queue.add('test-job', job, 1);

      // Then: 추가 성공
      expect(result).toBe(true);
      expect(queue.size).toBe(1);
    });

    it('should prevent duplicate jobs in queue', () => {
      // Given: 큐에 작업이 있는 상태
      const job = async () => {};
      queue.add('test-job', job, 1);

      // When: 동일한 이름의 작업 추가 시도
      const result = queue.add('test-job', job, 1);

      // Then: 추가 실패 (중복 방지)
      expect(result).toBe(false);
      expect(queue.size).toBe(1);
    });

    it('should allow adding job when running', () => {
      // Given: 실행 중인 작업
      const job = async () => {};
      queue.markRunning('running-job');

      // When: 실행 중인 작업을 큐에 추가
      const result = queue.add('running-job', job, 1);

      // Then: 추가 성공 (완료 후 실행되도록)
      expect(result).toBe(true);
      expect(queue.size).toBe(1);
    });

    it('should prevent duplicate when job is running and already queued', () => {
      // Given: 실행 중이고 큐에도 있는 작업
      const job = async () => {};
      queue.markRunning('running-job');
      queue.add('running-job', job, 1);

      // When: 동일한 작업 추가 시도
      const result = queue.add('running-job', job, 1);

      // Then: 추가 실패 (중복 방지)
      expect(result).toBe(false);
      expect(queue.size).toBe(1);
    });

    it('should respect maxSize limit', () => {
      // Given: 최대 크기가 2인 큐
      const limitedQueue = new JobQueue({ maxSize: 2 });
      const job = async () => {};

      // When: 최대 크기까지 작업 추가
      limitedQueue.add('job1', job, 1);
      limitedQueue.add('job2', job, 1);
      const result = limitedQueue.add('job3', job, 1);

      // Then: 추가 실패 (최대 크기 초과)
      expect(result).toBe(false);
      expect(limitedQueue.size).toBe(2);
    });
  });

  describe('getNext', () => {
    it('should return undefined when queue is empty', () => {
      // Given: 빈 큐

      // When: 다음 작업 가져오기
      const result = queue.getNext();

      // Then: undefined 반환
      expect(result).toBeUndefined();
    });

    it('should return job in priority order', () => {
      // Given: 여러 우선순위의 작업
      const job1 = async () => {};
      const job2 = async () => {};
      const job3 = async () => {};
      
      queue.add('low-priority', job3, 3);
      queue.add('high-priority', job1, 1);
      queue.add('medium-priority', job2, 2);

      // When: 다음 작업 가져오기
      const result = queue.getNext();

      // Then: 가장 높은 우선순위 작업 반환
      expect(result).toBeDefined();
      expect(result?.name).toBe('high-priority');
      expect(result?.priority).toBe(1);
    });

    it('should remove job from queue when getting next', () => {
      // Given: 큐에 작업이 있는 상태
      const job = async () => {};
      queue.add('test-job', job, 1);

      // When: 다음 작업 가져오기
      queue.getNext();

      // Then: 큐에서 제거됨
      expect(queue.size).toBe(0);
    });
  });

  describe('markRunning and markCompleted', () => {
    it('should mark job as running', () => {
      // Given: 작업이 없는 상태

      // When: 실행 중으로 표시
      queue.markRunning('test-job');

      // Then: 실행 중으로 표시됨
      expect(queue.isRunning('test-job')).toBe(true);
      expect(queue.runningCount).toBe(1);
    });

    it('should mark job as completed', () => {
      // Given: 실행 중인 작업
      queue.markRunning('test-job');

      // When: 완료로 표시
      queue.markCompleted('test-job');

      // Then: 실행 중 표시 제거됨
      expect(queue.isRunning('test-job')).toBe(false);
      expect(queue.runningCount).toBe(0);
    });
  });

  describe('size and isEmpty', () => {
    it('should return correct queue size', () => {
      // Given: 빈 큐
      expect(queue.size).toBe(0);
      expect(queue.isEmpty).toBe(true);

      // When: 작업 추가
      const job = async () => {};
      queue.add('job1', job, 1);
      queue.add('job2', job, 1);

      // Then: 크기 반영
      expect(queue.size).toBe(2);
      expect(queue.isEmpty).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all jobs from queue', () => {
      // Given: 큐에 작업이 있는 상태
      const job = async () => {};
      queue.add('job1', job, 1);
      queue.add('job2', job, 1);

      // When: 큐 비우기
      queue.clear();

      // Then: 큐가 비어있음
      expect(queue.size).toBe(0);
      expect(queue.isEmpty).toBe(true);
    });
  });

  describe('isRunning and isQueued', () => {
    it('should correctly identify running jobs', () => {
      // Given: 실행 중인 작업
      queue.markRunning('running-job');

      // When/Then: 실행 중 확인
      expect(queue.isRunning('running-job')).toBe(true);
      expect(queue.isRunning('not-running')).toBe(false);
    });

    it('should correctly identify queued jobs', () => {
      // Given: 큐에 작업이 있는 상태
      const job = async () => {};
      queue.add('queued-job', job, 1);

      // When/Then: 큐에 있는지 확인
      expect(queue.isQueued('queued-job')).toBe(true);
      expect(queue.isQueued('not-queued')).toBe(false);
    });
  });
});

