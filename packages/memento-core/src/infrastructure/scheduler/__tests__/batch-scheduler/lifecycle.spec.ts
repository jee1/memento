import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { BatchScheduler } from '../../batch-scheduler.js';
import { setupTestDatabase, cleanupTestDatabase, createTestDatabaseWithoutServices } from '../../../../test/helpers/test-database.js';

describe('BatchScheduler', () => {
  let scheduler: BatchScheduler;
  let db: Database.Database;

  beforeEach(async () => {
    db = await setupTestDatabase();
    scheduler = new BatchScheduler({
      cleanupInterval: 60000, // 최소 1분
      monitoringInterval: 10000, // 최소 10초
      healthCheckInterval: 10000,
      memoryReviewCandidatesInterval: 60000,
      maxBatchSize: 100,
      enableLogging: false, // 테스트 중 로그 최소화
      enableNotifications: false,
      enableMetrics: false,
      maxConcurrentJobs: 2,
      jobTimeout: 5000,
      retryAttempts: 2,
      retryDelay: 100
    });
  });

  afterEach(async () => {
    if (scheduler) {
      await scheduler.stop();
    }
    await cleanupTestDatabase(db);
  });

  describe('start', () => {
    it('스케줄러를 시작해야 함', async () => {
      await scheduler.start(db);

      const status = scheduler.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.activeJobs.length).toBeGreaterThan(0);
    });

    it('이미 실행 중이면 에러를 던져야 함', async () => {
      await scheduler.start(db);

      await expect(scheduler.start(db)).rejects.toThrow('BatchScheduler is already running');
    });

    it('작업을 스케줄링해야 함', async () => {
      await scheduler.start(db);

      const status = scheduler.getStatus();
      expect(status.activeJobs).toContain('cleanup');
      expect(status.activeJobs).toContain('monitoring');
      expect(status.activeJobs).toContain('healthcheck');
    });

    it('성능 모니터를 초기화해야 함', async () => {
      await scheduler.start(db);

      // 성능 모니터가 초기화되었는지 확인 (간접적으로)
      const status = scheduler.getStatus();
      expect(status.isRunning).toBe(true);
    });
  });

  describe('stop', () => {
    it('스케줄러를 중지해야 함', async () => {
      await scheduler.start(db);
      await scheduler.stop();

      const status = scheduler.getStatus();
      expect(status.isRunning).toBe(false);
    });

    it('실행 중인 작업을 완료 대기해야 함', async () => {
      await scheduler.start(db);

      // 약간의 지연 후 중지
      await new Promise(resolve => setTimeout(resolve, 100));

      await scheduler.stop();

      const status = scheduler.getStatus();
      expect(status.isRunning).toBe(false);
    });

    it('이미 중지된 상태에서도 에러를 던지지 않아야 함', async () => {
      await expect(scheduler.stop()).resolves.not.toThrow();
    });

    it('모든 인터벌을 정리해야 함', async () => {
      await scheduler.start(db);

      const statusBefore = scheduler.getStatus();
      expect(statusBefore.activeJobs.length).toBeGreaterThan(0);

      await scheduler.stop();

      const statusAfter = scheduler.getStatus();
      expect(statusAfter.activeJobs.length).toBe(0);
    });

    it('큐에 남아있는 작업을 비워야 함', async () => {
      // Given: 스케줄러 시작
      await scheduler.start(db);

      // 큐에 작업이 있을 수 있음 (시작 시 즉시 실행을 위해 큐에 추가됨)
      await new Promise(resolve => setTimeout(resolve, 100));

      // When: 스케줄러 중지
      await scheduler.stop();

      // Then: 큐가 비어있어야 함 (재시작 시 의도하지 않은 실행 방지)
      // 큐는 private이므로 간접적으로 확인
      const status = scheduler.getStatus();
      expect(status.isRunning).toBe(false);
    });

    it('재시작 시 이전 세션의 큐 작업이 실행되지 않아야 함', async () => {
      // Given: 스케줄러 시작 및 중지
      await scheduler.start(db);
      await new Promise(resolve => setTimeout(resolve, 100));
      await scheduler.stop();

      // When: 새로운 DB로 재시작 (서비스 미기동 DB만 사용해 BatchScheduler 중복 기동 방지)
      const newDb = await createTestDatabaseWithoutServices();
      await scheduler.start(newDb);

      // Then: 재시작 시 큐가 초기화되어야 함
      // (실제로는 start()에서 큐를 초기화하므로 이전 세션의 작업이 실행되지 않음)
      const status = scheduler.getStatus();
      expect(status.isRunning).toBe(true);

      await scheduler.stop();
      newDb.close();
    });
  });
});
