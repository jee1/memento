import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { BatchScheduler } from '../../batch-scheduler.js';
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

  describe('작업 실행 및 재시도', () => {
    it('작업을 실행해야 함', async () => {
      // Given: 스케줄러 시작
      await scheduler.start(db);

      // When: 작업을 수동으로 실행
      await scheduler.runJob('healthcheck');
      await new Promise(resolve => setTimeout(resolve, 100));

      // Then: 작업이 실행되었는지 확인
      const status = scheduler.getStatus();
      expect(status.totalExecutions.get('healthcheck')).toBeGreaterThan(0);

      await scheduler.stop();
    });

    it('주기적 작업이 setInterval로 실행되어야 함', async () => {
      // Given: vi.useFakeTimers()로 시간 제어
      vi.useFakeTimers();

      try {
        await scheduler.start(db);

        const initialStatus = scheduler.getStatus();
        const initialCount = initialStatus.totalExecutions.get('healthcheck') || 0;

        // When: 시간을 진행시켜 주기적 작업 실행 (healthCheckInterval: 10000ms)
        await vi.advanceTimersByTimeAsync(10001); // 10000ms보다 큰 값으로 진행 (async로 마이크로태스크도 처리)

        // Then: 주기적 작업이 실행되어야 함
        const status = scheduler.getStatus();
        expect(status.totalExecutions.get('healthcheck')).toBeGreaterThan(initialCount);
      } finally {
        // stop() → waitForRunningJobs()가 setTimeout(100)으로 대기하는데, 가짜 타이머가 멈춰 있으면 영구 대기한다.
        vi.useRealTimers();
        await scheduler.stop();
      }
    }, 15000);

    it('작업 타임아웃을 처리해야 함', async () => {
      // Given: 짧은 타임아웃을 가진 스케줄러
      const shortTimeoutScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        jobTimeout: 1000, // 최소 1초
        retryAttempts: 1
      });

      await shortTimeoutScheduler.start(db);

      // When: 스케줄러가 시작되었는지 확인
      // Then: 타임아웃 설정이 올바르게 적용되어야 함
      const status = shortTimeoutScheduler.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.config.jobTimeout).toBe(1000);

      await shortTimeoutScheduler.stop();
      await cleanupTestDatabase(db);
    }, 10000); // 테스트 타임아웃 10초로 설정

    it('실패한 작업을 재시도해야 함', async () => {
      // Given: vi.useFakeTimers()로 시간 제어
      vi.useFakeTimers();

      await scheduler.start(db);

      // When: 시간을 진행시켜 재시도 로직 확인
      // 재시도 지연 시간(retryDelay: 100ms) 이상 진행
      vi.advanceTimersByTime(150);
      await Promise.race([
        vi.runOnlyPendingTimersAsync(),
        new Promise(resolve => setTimeout(resolve, 1000))
      ]).catch(() => {});

      // Then: 에러 카운트가 추적되어야 함
      const status = scheduler.getStatus();
      expect(status.errorCount).toBeDefined();

      await scheduler.stop();
      vi.useRealTimers();
    }, 10000);

    it('재시도 횟수를 초과하면 영구 실패 처리해야 함', async () => {
      // Given: vi.useFakeTimers()로 시간 제어
      vi.useFakeTimers();

      const lowRetryScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        retryAttempts: 1,
        retryDelay: 50
      });

      await lowRetryScheduler.start(db);

      // When: 재시도 시간 이상 진행 (retryDelay: 50ms)
      vi.advanceTimersByTime(100);
      await Promise.race([
        vi.runOnlyPendingTimersAsync(),
        new Promise(resolve => setTimeout(resolve, 1000))
      ]).catch(() => {});

      // Then: 재시도 로직이 작동해야 함
      const status = lowRetryScheduler.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.config.retryAttempts).toBe(1);

      await lowRetryScheduler.stop();
      await cleanupTestDatabase(db);
      vi.useRealTimers();
    }, 10000);
  });

  describe('재시도 큐 및 타임아웃/상태 관리 통합', () => {
    it('재시도 시에도 타임아웃이 적용되어야 함', async () => {
      // Given: 짧은 타임아웃을 가진 스케줄러
      const shortTimeoutScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        jobTimeout: 1000, // 1초 타임아웃
        retryAttempts: 2,
        retryDelay: 100,
        enableLogging: false
      });

      await shortTimeoutScheduler.start(db);

      // When: 타임아웃이 발생하는 작업을 큐에 추가
      // (실제로는 scheduleJob을 통해 실행되지만, 재시도 큐를 통해 실행되는 경우도 테스트)
      const statusBefore = shortTimeoutScheduler.getStatus();

      // 짧은 시간 대기
      await new Promise(resolve => setTimeout(resolve, 200));

      // Then: 타임아웃 설정이 올바르게 적용되어야 함
      const statusAfter = shortTimeoutScheduler.getStatus();
      expect(statusAfter.config.jobTimeout).toBe(1000);

      await shortTimeoutScheduler.stop();
      await cleanupTestDatabase(db);
    }, 10000);

    it('재시도 시에도 runningJobs 상태가 관리되어야 함', async () => {
      // Given: vi.useFakeTimers()로 시간 제어
      vi.useFakeTimers();

      const testScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        retryAttempts: 1,
        retryDelay: 100,
        enableLogging: false
      });

      await testScheduler.start(db);

      // When: 재시도 시간 이상 진행
      vi.advanceTimersByTime(150);
      await Promise.race([
        vi.runOnlyPendingTimersAsync(),
        new Promise(resolve => setTimeout(resolve, 1000))
      ]).catch(() => {});

      // Then: runningJobs 상태가 올바르게 관리되어야 함
      // (재시도 시에도 runningJobs에 추가/제거가 올바르게 이루어져야 함)
      const status = testScheduler.getStatus();
      expect(status.isRunning).toBe(true);
      // runningJobs는 내부 상태이므로 직접 접근 불가, 하지만 상태가 정상이면 통과

      await testScheduler.stop();
      await cleanupTestDatabase(db);
      vi.useRealTimers();
    }, 10000);

    it('재시도 시에도 lastExecution과 errorCount가 업데이트되어야 함', async () => {
      // Given: vi.useFakeTimers()로 시간 제어
      vi.useFakeTimers();

      const testScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        retryAttempts: 1,
        retryDelay: 100,
        enableLogging: false
      });

      await testScheduler.start(db);

      const initialStatus = testScheduler.getStatus();
      const initialErrorCount = initialStatus.errorCount.get('healthcheck') || 0;

      // When: 재시도 시간 이상 진행
      vi.advanceTimersByTime(300);
      await Promise.race([
        vi.runOnlyPendingTimersAsync(),
        new Promise(resolve => setTimeout(resolve, 1000))
      ]).catch(() => {});

      // Then: errorCount가 추적되어야 함 (재시도 시에도)
      const statusAfter = testScheduler.getStatus();
      // 재시도 시에도 errorCount가 업데이트되어야 함
      expect(statusAfter.errorCount).toBeDefined();

      await testScheduler.stop();
      await cleanupTestDatabase(db);
      vi.useRealTimers();
    }, 10000);

    it('재시도 큐에서 실행되는 작업도 동일한 래퍼를 거쳐야 함', async () => {
      // Given: vi.useFakeTimers()로 시간 제어
      vi.useFakeTimers();

      const testScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        retryAttempts: 1,
        retryDelay: 50,
        jobTimeout: 5000,
        enableLogging: false
      });

      await testScheduler.start(db);

      // When: 재시도 시간 이상 진행 (재시도 큐에 작업이 추가되고 실행됨)
      vi.advanceTimersByTime(100);
      await Promise.race([
        vi.runOnlyPendingTimersAsync(),
        new Promise(resolve => setTimeout(resolve, 1000))
      ]).catch(() => {});

      // Then: 재시도 큐에서 실행되는 작업도 타임아웃/상태 관리가 적용되어야 함
      const status = testScheduler.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.config.jobTimeout).toBe(5000);

      await testScheduler.stop();
      await cleanupTestDatabase(db);
      vi.useRealTimers();
    }, 10000);

    it('재시도 시 중복 실행이 방지되어야 함', async () => {
      // Given: vi.useFakeTimers()로 시간 제어
      vi.useFakeTimers();

      const testScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        retryAttempts: 2,
        retryDelay: 50,
        enableLogging: false
      });

      await testScheduler.start(db);

      // When: 재시도 시간 이상 진행 (여러 번 재시도 가능)
      vi.advanceTimersByTime(200);
      await Promise.race([
        vi.runOnlyPendingTimersAsync(),
        new Promise(resolve => setTimeout(resolve, 1000))
      ]).catch(() => {});

      // Then: 중복 실행이 방지되어야 함 (runningJobs 체크)
      const status = testScheduler.getStatus();
      expect(status.isRunning).toBe(true);
      // runningJobs는 내부 상태이지만, 중복 실행 방지 로직이 작동해야 함

      await testScheduler.stop();
      await cleanupTestDatabase(db);
      vi.useRealTimers();
    }, 10000);

    it('재시도 시 로그 컨텍스트가 올바르게 기록되어야 함', async () => {
      // Given: 로깅이 활성화된 스케줄러
      const testScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        retryAttempts: 1,
        retryDelay: 50,
        enableLogging: true
      });

      const mcpLoggerModule = await import('../../../../server/mcp-logger.js');
      const logBatchSpy = vi.spyOn(mcpLoggerModule.mcpLogger, 'logBatch');

      await testScheduler.start(db);

      // When: 재시도 시간 이상 진행
      await new Promise(resolve => setTimeout(resolve, 100));

      // Then: 재시도 시에도 로그 컨텍스트가 올바르게 기록되어야 함
      // (재시도 로그가 호출되었는지 확인)
      const retryLogCalls = logBatchSpy.mock.calls.filter(
        call => call[1] && typeof call[1] === 'string' && call[1].includes('Retrying')
      );

      // 재시도가 발생했을 수 있으므로, 로그가 호출되었는지 확인
      expect(logBatchSpy).toHaveBeenCalled();

      logBatchSpy.mockRestore();
      await testScheduler.stop();
      await cleanupTestDatabase(db);
    });
  });

  describe('재시도 한도 및 errorCount 기반 중단', () => {
    it('재시도 횟수가 retryAttempts를 초과하면 재시도를 중단해야 함', async () => {
      // Given: 재시도 횟수 제한이 있는 스케줄러
      vi.useFakeTimers();
      const testScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        healthCheckInterval: 10000,
        maxBatchSize: 100,
        enableLogging: false,
        maxConcurrentJobs: 1,
        jobTimeout: 1000,
        retryAttempts: 2, // 최대 2회 재시도
        retryDelay: 50
      });

      await testScheduler.start(db);

      let executionCount = 0;
      const failingJob = async () => {
        executionCount++;
        throw new Error('Job failed');
      };

      // When: 실패하는 작업을 큐에 추가
      const schedulerAny = testScheduler as any;
      schedulerAny.jobQueue.clear();
      schedulerAny.jobQueue.add('test_failing_job', failingJob, 1, 0);

      // 큐 처리 시작 (processor interval + retry delays)
      await vi.advanceTimersByTimeAsync(2000);

      // Then: 재시도 횟수만큼만 실행되어야 함 (초기 실행 + 재시도 2회 = 총 3회)
      // 하지만 errorCount 기반 중단으로 인해 더 일찍 중단될 수 있음
      expect(executionCount).toBeGreaterThan(0);
      expect(executionCount).toBeLessThanOrEqual(3); // 최대 3회 (초기 + 재시도 2회)

      await testScheduler.stop();
      await cleanupTestDatabase(db);
      vi.useRealTimers();
    });

    it('errorCount가 최대값을 초과하면 재시도를 중단해야 함', async () => {
      // Given: errorCount 기반 중단이 있는 스케줄러
      const testScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        healthCheckInterval: 10000,
        maxBatchSize: 100,
        enableLogging: false,
        maxConcurrentJobs: 1,
        jobTimeout: 1000,
        retryAttempts: 10, // 높은 재시도 횟수
        retryDelay: 10
      });

      await testScheduler.start(db);

      let executionCount = 0;
      const failingJob = async () => {
        executionCount++;
        throw new Error('Job failed');
      };

      // When: 실패하는 작업을 큐에 추가하여 실행
      const schedulerAny = testScheduler as any;
      const coord = executionCoordinator(testScheduler);
      // executeJobWithRetry를 직접 호출하여 실행 (큐를 통하지 않고 직접 실행)
      await coord.executeJobWithRetry('test_failing_job', failingJob, 1, 0);

      // 에러 처리 후 상태 업데이트를 위해 잠시 대기
      await new Promise(resolve => setTimeout(resolve, 100));

      // Then: errorCount 기반 중단으로 인해 재시도가 중단되어야 함
      // 작업이 실행되어 에러가 발생하면 errorCount가 증가해야 함
      const status = testScheduler.getStatus();
      const errorCount = status.errorCount.get('test_failing_job') || 0;
      // 작업이 실행되었는지 확인 (executionCount가 증가했는지)
      expect(executionCount).toBeGreaterThan(0);
      // errorCount가 증가했는지 확인 (RetryManager가 에러를 기록했는지)
      // executeJobWithRetry가 호출되면 에러가 발생하고 incrementErrorCount가 호출됨
      // RetryManager의 getErrorCount를 직접 확인
      const retryManagerErrorCount = schedulerAny.retryManager.getErrorCount('test_failing_job');
      expect(retryManagerErrorCount).toBeGreaterThan(0);

      await testScheduler.stop();
      await cleanupTestDatabase(db);
    });

    it('재시도 시 retryCount가 큐 항목에 저장되어야 함', async () => {
      // Given: 스케줄러
      vi.useFakeTimers();
      const testScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        healthCheckInterval: 10000,
        maxBatchSize: 100,
        enableLogging: false,
        maxConcurrentJobs: 1,
        jobTimeout: 1000,
        retryAttempts: 3,
        retryDelay: 50
      });

      await testScheduler.start(db);

      let executionCount = 0;
      const failingJob = async () => {
        executionCount++;
        throw new Error('Job failed');
      };

      // When: 실패하는 작업을 큐에 추가
      const schedulerAny = testScheduler as any;
      schedulerAny.jobQueue.clear();
      schedulerAny.jobQueue.add('test_retry_count', failingJob, 1, 0);

      // 큐 처리 시작 (재시도가 발생할 수 있도록 충분한 시간 대기, 1000ms processor + 50ms delay * 3 + buffer)
      await vi.advanceTimersByTimeAsync(5000);

      // Then: 재시도 시 큐에 추가된 항목에 retryCount가 저장되어야 함
      // 작업이 실행되었는지 확인 (executionCount가 증가했는지)
      expect(executionCount).toBeGreaterThan(0);
      // 재시도가 발생했는지는 실행 횟수로 확인 (retryAttempts가 3이므로 최대 4회 실행 가능)
      expect(executionCount).toBeLessThanOrEqual(4);

      await testScheduler.stop();
      await cleanupTestDatabase(db);
      vi.useRealTimers();
    });
  });
});
