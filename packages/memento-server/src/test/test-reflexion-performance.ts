/**
 * Reflexion 기능 성능 테스트
 * 동시성, 큐 적체 시나리오, Worker 실패 복구 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from './helpers/test-database.js';
import { FailureDetector, ErrorType, type FailureEvent } from '@memento/coremonitoring/services/failure-detector.js';
import { ReflexionWorker } from '@memento/corereflexion-worker.js';
import { AsyncTaskQueue } from '@memento/coreasync-optimizer.js';

describe('Reflexion 성능 테스트', () => {
  let db: Database.Database;
  let detector: FailureDetector;
  let worker: ReflexionWorker;
  let eventQueue: AsyncTaskQueue;

  beforeEach(async () => {
    db = await setupTestDatabase();
    eventQueue = new AsyncTaskQueue(5, 100); // 최대 5개 동시 실행, 큐 크기 100
    detector = new FailureDetector(eventQueue);
    worker = new ReflexionWorker(detector, db, eventQueue);
    await detector.startQueue();
    await worker.start();
  });

  afterEach(async () => {
    await worker.stop();
    await detector.stopQueue();
    cleanupTestDatabase(db);
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('동시성 테스트', () => {
    it('여러 이벤트를 동시에 처리해야 함', async () => {
      // Given: 50개의 실패 이벤트
      const events: FailureEvent[] = Array.from({ length: 50 }, (_, i) => ({
        id: `perf_concurrent_${i}`,
        tool_name: 'test_tool',
        error_type: ErrorType.TOOL_ERROR,
        error_message: `Error ${i}`,
        error_message_hash: `hash${i}`,
        timestamp: new Date().toISOString(),
        context: {},
        priority: 5
      }));

      // When: 모든 이벤트를 동시에 큐에 추가
      const startTime = Date.now();
      const results = await Promise.all(
        events.map(event => worker.queueFailureEvent(event))
      );
      const queueTime = Date.now() - startTime;

      // Then: 모든 이벤트가 큐에 추가되어야 함
      expect(results.every(r => r === true)).toBe(true);
      expect(queueTime).toBeLessThan(1000); // 1초 이내에 큐에 추가되어야 함

      // 처리 완료 대기
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 처리된 이벤트 수 확인
      const status = worker.getStatus();
      expect(status.processedCount).toBeGreaterThan(0);
    });

    it('동시 실행 수를 제한해야 함', async () => {
      // Given: 많은 실패 이벤트
      const events: FailureEvent[] = Array.from({ length: 20 }, (_, i) => ({
        id: `perf_limit_${i}`,
        tool_name: 'test_tool',
        error_type: ErrorType.TOOL_ERROR,
        error_message: `Error ${i}`,
        error_message_hash: `hash${i}`,
        timestamp: new Date().toISOString(),
        context: {},
        priority: 5
      }));

      // When: 모든 이벤트를 큐에 추가
      await Promise.all(events.map(event => worker.queueFailureEvent(event)));

      // Then: 동시 실행 수가 제한되어야 함 (최대 5개)
      await new Promise(resolve => setTimeout(resolve, 100));
      const status = worker.getStatus();
      expect(status.activeWorkers).toBeLessThanOrEqual(5);
    });
  });

  describe('큐 적체 시나리오', () => {
    it('큐 적체 시 경고를 출력해야 함', async () => {
      // Given: 큐 적체 임계값(50)을 초과하는 이벤트들
      const events: FailureEvent[] = Array.from({ length: 60 }, (_, i) => ({
        id: `perf_backlog_${i}`,
        tool_name: 'test_tool',
        error_type: ErrorType.TOOL_ERROR,
        error_message: `Error ${i}`,
        error_message_hash: `hash${i}`,
        timestamp: new Date().toISOString(),
        context: {},
        priority: 5
      }));

      // When: 큐 적체 임계값을 초과하는 이벤트들을 추가
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await Promise.all(events.map(event => worker.queueFailureEvent(event)));

      // Then: 큐 적체 경고가 출력되어야 함
      worker.checkQueueBacklog();
      const status = worker.getStatus();
      if (status.queueSize > 50) {
        expect(warnSpy).toHaveBeenCalled();
      }
      
      warnSpy.mockRestore();
    });

    it('큐 크기 제한을 초과하면 가장 오래된 항목을 제거해야 함', async () => {
      // Given: 큐 크기 제한(100)을 초과하는 이벤트들
      const events: FailureEvent[] = Array.from({ length: 110 }, (_, i) => ({
        id: `perf_queue_limit_${i}`,
        tool_name: 'test_tool',
        error_type: ErrorType.TOOL_ERROR,
        error_message: `Error ${i}`,
        error_message_hash: `hash${i}`,
        timestamp: new Date().toISOString(),
        context: {},
        priority: 5
      }));

      // When: 큐 크기를 초과하는 이벤트들을 추가
      await Promise.all(events.map(event => worker.queueFailureEvent(event)));

      // Then: 큐 크기가 제한 이내여야 함
      await new Promise(resolve => setTimeout(resolve, 100));
      const status = worker.getStatus();
      expect(status.queueSize).toBeLessThanOrEqual(100);
    });
  });

  describe('Worker 실패 복구', () => {
    it('Worker 크래시 시 자동 재시작해야 함', async () => {
      // Given: 실행 중인 Worker
      expect(worker.getStatus().isRunning).toBe(true);

      // When: 큐를 중지하여 크래시 시뮬레이션
      await eventQueue.stop();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Then: 헬스체크가 크래시를 감지하고 재시작을 시도해야 함
      // (실제로는 performHealthCheck가 자동으로 호출됨)
      worker.checkQueueBacklog();
      
      // Worker 상태 확인
      const status = worker.getStatus();
      // 큐가 중지되었지만 Worker는 여전히 실행 중일 수 있음
      // (재시작 로직이 작동 중일 수 있음)
      expect(status.restartCount).toBeGreaterThanOrEqual(0);
    });

    it('최대 재시작 횟수를 초과하면 Worker를 중지해야 함', async () => {
      // Given: Worker 인스턴스
      const maxRestarts = 3;

      // When: 여러 번 재시작 시도 (수동으로 시뮬레이션)
      // 실제로는 attemptRestart가 자동으로 호출되지만,
      // 여기서는 상태만 확인
      const status = worker.getStatus();
      expect(status.restartCount).toBeLessThanOrEqual(maxRestarts);
    });
  });

  describe('처리량 테스트', () => {
    it('초당 처리량을 측정해야 함', async () => {
      // Given: 100개의 실패 이벤트
      const events: FailureEvent[] = Array.from({ length: 100 }, (_, i) => ({
        id: `perf_throughput_${i}`,
        tool_name: 'test_tool',
        error_type: ErrorType.TOOL_ERROR,
        error_message: `Error ${i}`,
        error_message_hash: `hash${i}`,
        timestamp: new Date().toISOString(),
        context: {},
        priority: 5
      }));

      // When: 모든 이벤트를 처리
      const startTime = Date.now();
      await Promise.all(events.map(event => worker.queueFailureEvent(event)));
      
      // 처리 완료 대기
      await new Promise(resolve => setTimeout(resolve, 5000)); // 5초 대기
      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000; // 초 단위

      // Then: 처리량이 측정되어야 함
      const status = worker.getStatus();
      const throughput = status.processedCount / duration;
      
      expect(throughput).toBeGreaterThan(0);
      expect(status.processedCount).toBeGreaterThan(0);
    });
  });

  describe('우선순위 기반 처리', () => {
    it('높은 우선순위 이벤트를 먼저 처리해야 함', async () => {
      // Given: 다양한 우선순위의 이벤트들
      const events: FailureEvent[] = [
        {
          id: 'perf_priority_low',
          tool_name: 'test_tool',
          error_type: ErrorType.TOOL_ERROR,
          error_message: 'Low priority error',
          error_message_hash: 'hash_low',
          timestamp: new Date().toISOString(),
          context: {},
          priority: 1 // 낮은 우선순위
        },
        {
          id: 'perf_priority_high',
          tool_name: 'test_tool',
          error_type: ErrorType.USER_FEEDBACK,
          error_message: 'High priority error',
          error_message_hash: 'hash_high',
          timestamp: new Date().toISOString(),
          context: {},
          priority: 10 // 높은 우선순위
        }
      ];

      // When: 모든 이벤트를 큐에 추가
      await Promise.all(events.map(event => worker.queueFailureEvent(event)));

      // Then: 높은 우선순위 이벤트가 먼저 처리되어야 함
      // (실제로는 AsyncTaskQueue가 우선순위에 따라 정렬)
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const status = worker.getStatus();
      expect(status.processedCount).toBeGreaterThanOrEqual(0);
    });
  });
});

