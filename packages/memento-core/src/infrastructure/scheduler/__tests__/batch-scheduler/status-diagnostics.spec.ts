import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { BatchScheduler } from '../../batch-scheduler/batch-scheduler.js';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import { executionCoordinator } from './batch-scheduler.test-setup.js';

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

  describe('diagnostics events', () => {
    it('start와 stop 시 diagnostics 이벤트를 기록해야 함', async () => {
      const writeEvent = vi.fn().mockResolvedValue(undefined);
      const diagnosticsScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        healthCheckInterval: 10000,
        enableLogging: false,
        maxConcurrentJobs: 1,
        jobTimeout: 5000,
        retryAttempts: 1,
        retryDelay: 10
      }, {
        diagnosticsLogger: { writeEvent } as any
      });

      await diagnosticsScheduler.start(db);
      await diagnosticsScheduler.stop();

      expect(writeEvent).toHaveBeenCalledWith(expect.objectContaining({
        type: 'batch_scheduler_start'
      }));
      expect(writeEvent).toHaveBeenCalledWith(expect.objectContaining({
        type: 'batch_scheduler_stop'
      }));
    });

    it('작업 성공/실패 시 diagnostics 이벤트를 기록해야 함', async () => {
      const writeEvent = vi.fn().mockResolvedValue(undefined);
      const diagnosticsScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        healthCheckInterval: 10000,
        enableLogging: false,
        maxConcurrentJobs: 1,
        jobTimeout: 5000,
        retryAttempts: 1,
        retryDelay: 10
      }, {
        diagnosticsLogger: { writeEvent } as any
      });

      await diagnosticsScheduler.start(db);
      const coord = executionCoordinator(diagnosticsScheduler);

      await coord.executeJobWithRetry('diagnostics_success', async () => {}, 1, 0);
      await coord.executeJobWithRetry('diagnostics_failure', async () => {
        throw new Error('boom');
      }, 1, 0);

      expect(writeEvent).toHaveBeenCalledWith(expect.objectContaining({
        type: 'batch_job_start',
        jobName: 'diagnostics_success'
      }));
      expect(writeEvent).toHaveBeenCalledWith(expect.objectContaining({
        type: 'batch_job_finish',
        jobName: 'diagnostics_success'
      }));
      expect(writeEvent).toHaveBeenCalledWith(expect.objectContaining({
        type: 'batch_job_failure',
        jobName: 'diagnostics_failure',
        error: 'boom'
      }));

      await diagnosticsScheduler.stop();
    });
  });

  describe('getStatus', () => {
    it('스케줄러 상태를 반환해야 함', async () => {
      await scheduler.start(db);

      const status = scheduler.getStatus();

      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('activeJobs');
      expect(status).toHaveProperty('lastExecution');
      expect(status).toHaveProperty('totalExecutions');
      expect(status).toHaveProperty('errorCount');
      expect(status).toHaveProperty('uptime');
      expect(status).toHaveProperty('config');
    });

    it('실행 시간을 계산해야 함', async () => {
      // Given: 스케줄러 시작
      await scheduler.start(db);

      // When: 짧은 시간 대기
      await new Promise(resolve => setTimeout(resolve, 100));

      // Then: 실행 시간이 계산되어야 함
      const status = scheduler.getStatus();
      expect(status.uptime).toBeGreaterThan(0);

      await scheduler.stop();
    });

    it('활성 작업 목록을 반환해야 함', async () => {
      await scheduler.start(db);

      const status = scheduler.getStatus();
      expect(Array.isArray(status.activeJobs)).toBe(true);
      expect(status.activeJobs.length).toBeGreaterThan(0);
    });

    it('마지막 실행 시간을 추적해야 함', async () => {
      // Given: 스케줄러 시작
      await scheduler.start(db);

      // When: 짧은 시간 대기 후 작업 실행
      await new Promise(resolve => setTimeout(resolve, 200));
      await scheduler.runJob('healthcheck');

      // Then: 마지막 실행 시간이 추적되어야 함
      const status = scheduler.getStatus();
      expect(status.lastExecution.size).toBeGreaterThan(0);

      await scheduler.stop();
    });

    it('총 실행 횟수를 추적해야 함', async () => {
      // Given: 스케줄러 시작
      await scheduler.start(db);

      // When: 작업을 수동으로 실행
      await scheduler.runJob('healthcheck');
      await new Promise(resolve => setTimeout(resolve, 100));

      // Then: 총 실행 횟수가 추적되어야 함
      const status = scheduler.getStatus();
      expect(status.totalExecutions.size).toBeGreaterThan(0);

      await scheduler.stop();
    });
  });

  describe('getDetailedStats', () => {
    it('상세 통계를 반환해야 함', async () => {
      await scheduler.start(db);

      await new Promise(resolve => setTimeout(resolve, 100));

      const stats = scheduler.getDetailedStats();

      expect(stats).toHaveProperty('status');
      expect(stats).toHaveProperty('health');
      expect(stats).toHaveProperty('jobs');
    });

    it('헬스 정보를 포함해야 함', async () => {
      await scheduler.start(db);

      await new Promise(resolve => setTimeout(resolve, 100));

      const stats = scheduler.getDetailedStats();

      expect(stats.health).toHaveProperty('memoryUsage');
      expect(stats.health).toHaveProperty('runningJobs');
      expect(stats.health).toHaveProperty('queueSize');
      expect(stats.health).toHaveProperty('errorRate');
      expect(stats.health).toHaveProperty('uptime');
    });

    it('작업별 상세 정보를 포함해야 함', async () => {
      await scheduler.start(db);

      await new Promise(resolve => setTimeout(resolve, 100));

      const stats = scheduler.getDetailedStats();

      expect(Array.isArray(stats.jobs)).toBe(true);
      if (stats.jobs.length > 0) {
        const job = stats.jobs[0];
        expect(job).toHaveProperty('name');
        expect(job).toHaveProperty('lastExecution');
        expect(job).toHaveProperty('totalExecutions');
        expect(job).toHaveProperty('errorCount');
        expect(job).toHaveProperty('errorRate');
        expect(job).toHaveProperty('isRunning');
      }
    });
  });
});
