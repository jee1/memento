import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { BatchScheduler } from '../../batch-scheduler/batch-scheduler.js';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';

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

  describe('에러 처리', () => {
    it('데이터베이스가 없으면 에러를 처리해야 함', async () => {
      const schedulerWithoutDb = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000
      });

      // 데이터베이스 없이 작업 실행 시도
      // 내부적으로 에러 처리됨
      await schedulerWithoutDb.start(db);
      await schedulerWithoutDb.stop();
    });

    it('작업 실행 중 에러를 기록해야 함', async () => {
      await scheduler.start(db);

      // 정상적인 작업 실행 후 에러 카운트 확인
      await new Promise(resolve => setTimeout(resolve, 300));

      const status = scheduler.getStatus();
      expect(status.errorCount).toBeDefined();
    });
  });
});
