import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

  describe('runJob - 수동 작업 실행', () => {
    it('cleanup 작업을 수동으로 실행해야 함', async () => {
      await scheduler.start(db);

      const result = await scheduler.runJob('cleanup');

      expect(result).toBeDefined();
      expect(result.jobType).toBe('memory_cleanup');
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('processed');
    });

    it('monitoring 작업을 수동으로 실행해야 함', async () => {
      await scheduler.start(db);

      const result = await scheduler.runJob('monitoring');

      expect(result).toBeDefined();
      expect(result.jobType).toBe('monitoring');
      expect(result).toHaveProperty('success');
    });

    it('healthcheck 작업을 수동으로 실행해야 함', async () => {
      await scheduler.start(db);

      const result = await scheduler.runJob('healthcheck');

      expect(result).toBeDefined();
      expect(result.jobType).toBe('healthcheck');
      expect(result).toHaveProperty('success');
    });

    it('memory_review_candidates 작업을 수동으로 실행해야 함', async () => {
      await scheduler.start(db);

      const result = await scheduler.runJob('memory_review_candidates');

      expect(result).toBeDefined();
      expect(result.jobType).toBe('memory_review_candidates');
      expect(result).toHaveProperty('success');
    });

    it('memory_review_candidates 수동 실행 시 표준 run 메타 diagnostics를 남겨야 함', async () => {
      const writeEvent = vi.fn().mockResolvedValue(undefined);
      const diagnosticsScheduler = new BatchScheduler(
        {
          cleanupInterval: 60000,
          monitoringInterval: 10000,
          healthCheckInterval: 10000,
          enableLogging: false,
          maxConcurrentJobs: 1,
          jobTimeout: 5000,
          retryAttempts: 1,
          retryDelay: 10
        },
        {
          diagnosticsLogger: { writeEvent } as any
        }
      );

      await diagnosticsScheduler.start(db);
      await diagnosticsScheduler.runJob('memory_review_candidates');

      expect(writeEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'memory_review_candidates_run',
          schema_version: 1,
          job_name: 'memory_review_candidates',
          result: 'success',
          error_count: 0
        })
      );

      await diagnosticsScheduler.stop();
    });

    it('시작 후 activeJobs에 memory_review_candidates가 포함되어야 함', async () => {
      await scheduler.start(db);
      const status = scheduler.getStatus();
      expect(status.activeJobs).toContain('memory_review_candidates');
    });

    it('memoryReviewCandidatesSchedulerEnabled=false이면 주기 등록 없이 runJob는 동작해야 함', async () => {
      const s = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        healthCheckInterval: 10000,
        memoryReviewCandidatesInterval: 60000,
        memoryReviewCandidatesSchedulerEnabled: false,
        maxBatchSize: 100,
        enableLogging: false,
        enableNotifications: false,
        enableMetrics: false,
        maxConcurrentJobs: 2,
        jobTimeout: 5000,
        retryAttempts: 2,
        retryDelay: 100
      });
      await s.start(db);
      expect(s.getStatus().activeJobs).not.toContain('memory_review_candidates');
      const result = await s.runJob('memory_review_candidates');
      expect(result.jobType).toBe('memory_review_candidates');
      await s.stop();
    });
  });
});
