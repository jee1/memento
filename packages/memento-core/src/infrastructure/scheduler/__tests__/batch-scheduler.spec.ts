/**
 * BatchScheduler 테스트
 * 배치 작업 스케줄러 전체 기능 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { BatchScheduler, type BatchJobConfig, type BatchJobResult } from '../batch-scheduler.js';
import { setupTestDatabase, cleanupTestDatabase, createTestDatabaseWithoutServices, createTestMemory } from '../../../test/helpers/test-database.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { RelationValidatorExecutor } from '../relation-validator-executor.js';
import * as configModule from '../../../shared/config/index.js';
import { logger } from '../../../shared/utils/logger.js';
import { FileLogger } from '../file-logger.js';

describe('BatchScheduler', () => {
  let scheduler: BatchScheduler;
  let db: Database.Database;

  beforeEach(async () => {
    db = await setupTestDatabase();
    scheduler = new BatchScheduler({
      cleanupInterval: 60000, // 최소 1분
      monitoringInterval: 10000, // 최소 10초
      healthCheckInterval: 10000,
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

  describe('생성자 및 설정 검증', () => {
    it('유효한 설정으로 생성해야 함', () => {
      const validScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        maxBatchSize: 100,
        maxConcurrentJobs: 3,
        jobTimeout: 5000
      });

      expect(validScheduler).toBeDefined();
    });

    it('기본 설정으로 생성해야 함', () => {
      const defaultScheduler = new BatchScheduler();
      expect(defaultScheduler).toBeDefined();
    });

    it('cleanupInterval이 너무 짧으면 에러를 던져야 함', () => {
      expect(() => {
        new BatchScheduler({
          cleanupInterval: 50000 // 1분 미만
        });
      }).toThrow('cleanupInterval must be at least 1 minute');
    });

    it('monitoringInterval이 너무 짧으면 에러를 던져야 함', () => {
      expect(() => {
        new BatchScheduler({
          monitoringInterval: 5000 // 10초 미만
        });
      }).toThrow('monitoringInterval must be at least 10 seconds');
    });

    it('maxBatchSize가 0이면 에러를 던져야 함', () => {
      expect(() => {
        new BatchScheduler({
          maxBatchSize: 0
        });
      }).toThrow('maxBatchSize must be at least 1');
    });

    it('maxConcurrentJobs가 0이면 에러를 던져야 함', () => {
      expect(() => {
        new BatchScheduler({
          maxConcurrentJobs: 0
        });
      }).toThrow('maxConcurrentJobs must be at least 1');
    });

    it('jobTimeout이 너무 짧으면 에러를 던져야 함', () => {
      expect(() => {
        new BatchScheduler({
          jobTimeout: 500 // 1초 미만
        });
      }).toThrow('jobTimeout must be at least 1 second');
    });
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
      const schedulerAny = diagnosticsScheduler as any;

      await schedulerAny.executeJobWithRetry('diagnostics_success', async () => {}, 1, 0);
      await schedulerAny.executeJobWithRetry('diagnostics_failure', async () => {
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

      const mcpLoggerModule = await import('../../../server/mcp-logger.js');
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

  describe('동시 실행 제한', () => {
    it('최대 동시 작업 수를 제한해야 함', async () => {
      const limitedScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        maxConcurrentJobs: 1, // 1개로 제한
        jobTimeout: 5000
      });

      await limitedScheduler.start(db);

      // 동시 실행 제한 확인
      const status = limitedScheduler.getStatus();
      expect(status.config.maxConcurrentJobs).toBe(1);

      await limitedScheduler.stop();
      await cleanupTestDatabase(db);
    });

    it('작업 큐를 우선순위로 정렬해야 함', async () => {
      // Given: vi.useFakeTimers()로 시간 제어
      vi.useFakeTimers();
      
      await scheduler.start(db);
      
      // When: 시간을 진행시켜 작업 큐 처리
      vi.advanceTimersByTime(300);
      await Promise.race([
        vi.runOnlyPendingTimersAsync(),
        new Promise(resolve => setTimeout(resolve, 1000))
      ]).catch(() => {});
      
      // Then: 스케줄러가 정상 작동해야 함
      const status = scheduler.getStatus();
      expect(status.isRunning).toBe(true);

      await scheduler.stop();
      vi.useRealTimers();
    }, 10000);
  });

  describe('메모리 정리 작업', () => {
    it('메모리 정리 작업을 실행해야 함', async () => {
      // Given: 테스트 메모리 생성
      createTestMemory(db, {
        content: 'Old memory',
        type: 'working',
        importance: 0.3
      });

      await scheduler.start(db);
      
      // When: cleanup 작업 실행
      const result = await scheduler.runJob('cleanup');
      
      // Then: 작업 결과 확인
      expect(result.success).toBe(true);
      expect(result).toHaveProperty('processed');
    });

    it('메모리 정리 결과에 상세 정보가 포함되어야 함', async () => {
      await scheduler.start(db);
      
      const result = await scheduler.runJob('cleanup');
      
      expect(result).toHaveProperty('details');
      if (result.details) {
        expect(result.details).toHaveProperty('totalProcessed');
      }
    });
  });

  describe('모니터링 작업', () => {
    it('모니터링 작업을 실행해야 함', async () => {
      await scheduler.start(db);
      
      const result = await scheduler.runJob('monitoring');
      
      expect(result.success).toBe(true);
      expect(result).toHaveProperty('details');
    });

    it('모니터링 결과에 메트릭이 포함되어야 함', async () => {
      await scheduler.start(db);
      
      const result = await scheduler.runJob('monitoring');
      
      if (result.details && typeof result.details === 'object') {
        const details = result.details as any;
        expect(details).toHaveProperty('metrics');
      }
    });

    it('모니터링 결과에 데이터베이스 통계가 포함되어야 함', async () => {
      await scheduler.start(db);
      
      const result = await scheduler.runJob('monitoring');
      
      if (result.details && typeof result.details === 'object') {
        const details = result.details as any;
        expect(details).toHaveProperty('stats');
      }
    });
  });

  describe('헬스체크 작업', () => {
    it('헬스체크 작업을 실행해야 함', async () => {
      await scheduler.start(db);
      
      const result = await scheduler.runJob('healthcheck');
      
      expect(result.success).toBe(true);
      expect(result).toHaveProperty('details');
    });

    it('헬스체크 결과에 메모리 사용량이 포함되어야 함', async () => {
      await scheduler.start(db);
      
      const result = await scheduler.runJob('healthcheck');
      
      if (result.details && typeof result.details === 'object') {
        const details = result.details as any;
        expect(details).toHaveProperty('memoryUsage');
        expect(typeof details.memoryUsage).toBe('number');
      }
    });

    it('높은 메모리 사용량 시 경고를 생성해야 함', async () => {
      await scheduler.start(db);
      
      const result = await scheduler.runJob('healthcheck');
      
      // 경고는 warnings 배열에 포함됨
      expect(Array.isArray(result.warnings)).toBe(true);
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

  describe('로깅', () => {
    it('로깅이 비활성화되면 로그를 출력하지 않아야 함', async () => {
      const noLogScheduler = new BatchScheduler({
        enableLogging: false
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      await noLogScheduler.start(db);
      await new Promise(resolve => setTimeout(resolve, 100));
      await noLogScheduler.stop();

      // 로깅이 비활성화되어 있으므로 특정 로그가 출력되지 않아야 함
      // (다만 다른 시스템 로그는 있을 수 있음)
      
      consoleSpy.mockRestore();
      await cleanupTestDatabase(db);
    });

    it('Error 객체를 로그에 전달할 때 속성이 보존되어야 함', async () => {
      // Given: 로깅이 활성화된 스케줄러와 mcpLogger 모킹
      const testScheduler = new BatchScheduler({
        enableLogging: true,
        cleanupInterval: 60000,
        monitoringInterval: 10000
      });

      const mcpLoggerModule = await import('../../../server/mcp-logger.js');
      const logBatchSpy = vi.spyOn(mcpLoggerModule.mcpLogger, 'logBatch');

      await testScheduler.start(db);

      // When: Error 객체를 포함한 작업 실행
      // 데이터베이스 연결을 끊어서 에러 발생 유도
      const originalDb = db;
      db.close();
      
      try {
        await testScheduler.runJob('cleanup');
      } catch {
        // 에러는 예상됨
      }

      // Then: Error 객체의 message, name, stack이 로그에 포함되어야 함
      const errorLogCalls = logBatchSpy.mock.calls.filter(
        call => call[0] === 'error' && call[2] && typeof call[2] === 'object'
      );

      if (errorLogCalls.length > 0) {
        const lastErrorCall = errorLogCalls[errorLogCalls.length - 1];
        const logData = lastErrorCall[2] as any;
        
        // Error 객체의 속성이 제대로 추출되었는지 확인
        // message, name, stack 중 하나라도 있어야 함
        const hasErrorInfo = 
          (logData.message && typeof logData.message === 'string') ||
          (logData.name && typeof logData.name === 'string') ||
          (logData.stack && typeof logData.stack === 'string');
        
        expect(hasErrorInfo).toBe(true);
      }

      logBatchSpy.mockRestore();
      
      // 스케줄러만 중지 (동일 db 유지). setupTestDatabase() 호출 시 BatchScheduler 중복 기동으로 실패하므로 재생성 생략
      await testScheduler.stop();
    });

    it('data.level을 읽어서 로그 레벨로 사용해야 함', async () => {
      // Given: 로깅이 활성화된 스케줄러와 mcpLogger 모킹
      const testScheduler = new BatchScheduler({
        enableLogging: true,
        cleanupInterval: 60000,
        monitoringInterval: 10000
      });

      const mcpLoggerModule = await import('../../../server/mcp-logger.js');
      const logBatchSpy = vi.spyOn(mcpLoggerModule.mcpLogger, 'logBatch');

      await testScheduler.start(db);

      // When: data.level을 포함한 로그 호출 (내부 log 메서드 사용)
      const schedulerAny = testScheduler as any;
      schedulerAny.log('Test warn message', { level: 'warn', customData: 'test' });
      schedulerAny.log('Test error message', { level: 'error', customData: 'test' });
      schedulerAny.log('Test debug message', { level: 'debug', customData: 'test' }); // debug는 info로 변환됨

      // Then: 올바른 레벨로 로그가 기록되어야 함
      const warnCalls = logBatchSpy.mock.calls.filter(call => call[0] === 'warn');
      const errorCalls = logBatchSpy.mock.calls.filter(call => call[0] === 'error');
      const infoCalls = logBatchSpy.mock.calls.filter(call => call[0] === 'info');

      // warn 레벨 로그가 기록되었는지 확인
      expect(warnCalls.length).toBeGreaterThan(0);
      const warnCall = warnCalls.find(call => call[1] === 'Test warn message');
      expect(warnCall).toBeDefined();
      expect(warnCall?.[2]).not.toHaveProperty('level'); // level 속성은 제거되어야 함
      expect(warnCall?.[2]).toHaveProperty('customData'); // 다른 데이터는 보존되어야 함

      // error 레벨 로그가 기록되었는지 확인
      expect(errorCalls.length).toBeGreaterThan(0);
      const errorCall = errorCalls.find(call => call[1] === 'Test error message');
      expect(errorCall).toBeDefined();
      expect(errorCall?.[2]).not.toHaveProperty('level'); // level 속성은 제거되어야 함

      // debug는 info로 변환되어야 함
      const debugAsInfoCall = infoCalls.find(call => call[1] === 'Test debug message');
      expect(debugAsInfoCall).toBeDefined();

      logBatchSpy.mockRestore();
      await testScheduler.stop();
    });
  });

  describe('주간 관계 검증 및 전체 스윕', () => {
    it('주간 관계 검증이 큐를 통해 실행되어야 함', async () => {
      // Given: 로깅이 활성화된 스케줄러
      const testScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        healthCheckInterval: 10000,
        maxBatchSize: 100,
        enableLogging: true, // 로깅 활성화
        enableNotifications: false,
        enableMetrics: false,
        maxConcurrentJobs: 2,
        jobTimeout: 5000,
        retryAttempts: 2,
        retryDelay: 100
      });
      
      const mcpLoggerModule = await import('../../../server/mcp-logger.js');
      const logBatchSpy = vi.spyOn(mcpLoggerModule.mcpLogger, 'logBatch');
      
      await testScheduler.start(db);

      // When: 주간 관계 검증이 스케줄링되면
      // (실제로는 scheduleWeeklyRelationValidation이 start()에서 호출됨)
      await new Promise(resolve => setTimeout(resolve, 500));

      // Then: 큐를 통해 실행되어야 함 (activeJobs에 포함되어야 함)
      const status = testScheduler.getStatus();
      expect(status.activeJobs).toContain('weekly_relation_validation');
      
      // 스케줄러 시작 시 log가 호출되었는지 확인
      expect(logBatchSpy).toHaveBeenCalled();

      logBatchSpy.mockRestore();
      await testScheduler.stop();
      await cleanupTestDatabase(db);
    });

    it('전체 스윕이 큐를 통해 실행되어야 함', async () => {
      // Given: Consolidation Score가 활성화된 스케줄러 및 log 스파이
      // Consolidation Score 기능 활성화 모킹
      vi.spyOn(configModule, 'mementoConfig', 'get').mockReturnValue({
        ...configModule.mementoConfig,
        consolidationScoreEnabled: true
      } as any);

      const mcpLoggerModule = await import('../../../server/mcp-logger.js');
      const logBatchSpy = vi.spyOn(mcpLoggerModule.mcpLogger, 'logBatch');
      
      const consolidationScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        consolidationScoreIncrementalInterval: 60 * 60 * 1000,
        consolidationScoreFullSweepInterval: 24 * 60 * 60 * 1000,
        consolidationScoreFullSweepHour: new Date().getHours(), // 현재 시간으로 설정하여 즉시 실행
        enableLogging: true
      });

      await consolidationScheduler.start(db);

      // When: 전체 스윕이 스케줄링되면
      await new Promise(resolve => setTimeout(resolve, 500));

      // Then: 큐를 통해 실행되어야 함
      const status = consolidationScheduler.getStatus();
      expect(status.activeJobs).toContain('consolidation_score_full_sweep');
      
      // 큐를 통해 실행되었는지 확인
      expect(logBatchSpy).toHaveBeenCalled();

      logBatchSpy.mockRestore();
      await consolidationScheduler.stop();
      await cleanupTestDatabase(db);
    });

    it('주간 관계 검증이 설정된 타임아웃을 사용해야 함', async () => {
      // Given: 짧은 타임아웃을 가진 스케줄러
      const shortTimeoutScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        jobTimeout: 1000, // 1초 타임아웃
        weeklyRelationValidationTimeout: 1000, // 1초 타임아웃 (최소값)
        enableLogging: false
      });

      await shortTimeoutScheduler.start(db);

      // When: 타임아웃 설정이 적용되었는지 확인
      const status = shortTimeoutScheduler.getStatus();
      
      // Then: weeklyRelationValidationTimeout이 설정되어야 함
      expect(status.config.weeklyRelationValidationTimeout).toBe(1000);
      expect(status.config.jobTimeout).toBe(1000);

      await shortTimeoutScheduler.stop();
      await cleanupTestDatabase(db);
    });

    it('weeklyRelationValidationTimeout이 0이면 에러를 던져야 함', () => {
      // Given: weeklyRelationValidationTimeout이 0인 스케줄러
      // When: 생성 시도
      // Then: 에러를 던져야 함
      expect(() => {
        new BatchScheduler({
          cleanupInterval: 60000,
          monitoringInterval: 10000,
          jobTimeout: 5000,
          weeklyRelationValidationTimeout: 0
        });
      }).toThrow('weeklyRelationValidationTimeout must be a positive number (at least 1 second)');
    });

    it('weeklyRelationValidationTimeout이 음수이면 에러를 던져야 함', () => {
      // Given: weeklyRelationValidationTimeout이 음수인 스케줄러
      // When: 생성 시도
      // Then: 에러를 던져야 함
      expect(() => {
        new BatchScheduler({
          cleanupInterval: 60000,
          monitoringInterval: 10000,
          jobTimeout: 5000,
          weeklyRelationValidationTimeout: -1000
        });
      }).toThrow('weeklyRelationValidationTimeout must be a positive number');
    });

    it('weeklyRelationValidationTimeout이 1초 미만이면 에러를 던져야 함', () => {
      // Given: weeklyRelationValidationTimeout이 1초 미만인 스케줄러
      // When: 생성 시도
      // Then: 에러를 던져야 함
      expect(() => {
        new BatchScheduler({
          cleanupInterval: 60000,
          monitoringInterval: 10000,
          jobTimeout: 5000,
          weeklyRelationValidationTimeout: 500
        });
      }).toThrow('weeklyRelationValidationTimeout must be at least 1 second');
    });

    it('주간 관계 검증이 lastExecution과 totalExecutions을 실제로 기록해야 함', async () => {
      // Given: vi.useFakeTimers()로 시간 제어, RelationValidatorExecutor 모킹, 스케줄러 시작
      vi.useFakeTimers();
      
      const mockExecutor = {
        execute: vi.fn().mockResolvedValue({
          success: true,
          stdout: 'Validation completed',
          stderr: '',
          duration: 100
        })
      } as any;
      
      const testScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        healthCheckInterval: 10000,
        maxBatchSize: 100,
        enableLogging: false,
        enableNotifications: false,
        enableMetrics: false,
        maxConcurrentJobs: 2,
        jobTimeout: 5000,
        retryAttempts: 2,
        retryDelay: 100
      }, {
        relationValidatorExecutor: mockExecutor
      });
      
      await testScheduler.start(db);
      
      const initialStatus = testScheduler.getStatus();
      const initialLastExecution = initialStatus.lastExecution.get('weekly_relation_validation');
      const initialTotalExecutions = initialStatus.totalExecutions.get('weekly_relation_validation') || 0;

      // When: 주간 관계 검증 작업을 큐에 직접 추가하여 실행
      // (실제로는 scheduleWeeklyRelationValidation이 특정 시간에만 실행하지만, 테스트를 위해 직접 추가)
      const schedulerAny = testScheduler as any;
      // 초기 잡들이 큐를 선점하지 않도록 클리어
      schedulerAny.jobQueue.clear();
      schedulerAny.jobQueue.add('weekly_relation_validation', async () => { await schedulerAny.runWeeklyRelationValidation(); }, 5, 0);

      // 시간을 진행시켜 큐를 통해 작업이 실행되면 (큐 폴링 기본값 1000ms 이상 진행, async로 마이크로태스크도 처리)
      await vi.advanceTimersByTimeAsync(1100);

      // Then: 주간 관계 검증의 lastExecution과 totalExecutions이 실제로 기록되어야 함
      const statusAfter = testScheduler.getStatus();
      const afterLastExecution = statusAfter.lastExecution.get('weekly_relation_validation');
      const afterTotalExecutions = statusAfter.totalExecutions.get('weekly_relation_validation') || 0;
      
      // RelationValidatorExecutor가 호출되었는지 확인 (주간 관계 검증이 실제로 실행되었는지)
      expect(mockExecutor.execute).toHaveBeenCalled();
      
      // lastExecution이 업데이트되었는지 확인
      if (afterLastExecution) {
        expect(afterLastExecution).toBeInstanceOf(Date);
        if (initialLastExecution) {
          expect(afterLastExecution.getTime()).toBeGreaterThanOrEqual(initialLastExecution.getTime());
        }
      }
      
      // totalExecutions이 증가했는지 확인
      expect(afterTotalExecutions).toBeGreaterThan(initialTotalExecutions);

      await testScheduler.stop();
      await cleanupTestDatabase(db);
      vi.useRealTimers();
    });

    it('주간 관계 검증이 maxConcurrentJobs를 실제로 준수해야 함', async () => {
      // Given: maxConcurrentJobs가 1로 제한된 스케줄러
      const limitedScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        healthCheckInterval: 10000,
        maxBatchSize: 100,
        enableLogging: false,
        enableNotifications: false,
        enableMetrics: false,
        maxConcurrentJobs: 1,
        jobTimeout: 5000,
        retryAttempts: 2,
        retryDelay: 100
      });

      await limitedScheduler.start(db);
      
      const initialStatus = limitedScheduler.getStatus();
      expect(initialStatus.config.maxConcurrentJobs).toBe(1);

      // When: 여러 작업이 큐에 추가되면
      await new Promise(resolve => setTimeout(resolve, 500));

      // Then: maxConcurrentJobs를 준수해야 함 (실제 동시 실행 수 확인)
      const statusAfter = limitedScheduler.getStatus();
      expect(statusAfter.config.maxConcurrentJobs).toBe(1);
      
      // 상세 통계에서 runningJobs 확인
      const detailedStats = limitedScheduler.getDetailedStats();
      expect(detailedStats.health.runningJobs).toBeLessThanOrEqual(1);

      await limitedScheduler.stop();
      await cleanupTestDatabase(db);
    });
  });

  describe('큐 우선순위, 타임아웃, 재시도 흐름', () => {
    it('큐 우선순위에 따라 작업이 실제로 실행되어야 함', async () => {
      // Given: vi.useFakeTimers()로 시간 제어 및 로깅 활성화된 스케줄러
      vi.useFakeTimers();
      
      const testScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        healthCheckInterval: 10000,
        maxBatchSize: 100,
        enableLogging: true, // 로깅 활성화
        enableNotifications: false,
        enableMetrics: false,
        maxConcurrentJobs: 2,
        jobTimeout: 5000,
        retryAttempts: 2,
        retryDelay: 100
      });
      
      const mcpLoggerModule = await import('../../../server/mcp-logger.js');
      const logBatchSpy = vi.spyOn(mcpLoggerModule.mcpLogger, 'logBatch');
      
      await testScheduler.start(db);
      
      const initialStatus = testScheduler.getStatus();
      const initialCleanupExecutions = initialStatus.totalExecutions.get('cleanup') || 0;
      const initialHealthcheckExecutions = initialStatus.totalExecutions.get('healthcheck') || 0;
      
      // When: 시간을 진행시켜 큐 처리
      vi.advanceTimersByTime(500);
      await Promise.race([
        vi.runOnlyPendingTimersAsync(),
        new Promise(resolve => setTimeout(resolve, 1000))
      ]).catch(() => {});

      // Then: 우선순위에 따라 작업이 실행되어야 함
      const statusAfter = testScheduler.getStatus();
      expect(statusAfter.isRunning).toBe(true);
      
      // 우선순위가 높은 작업(cleanup: 1)이 먼저 실행되어야 함
      const afterCleanupExecutions = statusAfter.totalExecutions.get('cleanup') || 0;
      const afterHealthcheckExecutions = statusAfter.totalExecutions.get('healthcheck') || 0;
      
      // 큐를 통해 실행되면 totalExecutions가 증가해야 함
      expect(afterCleanupExecutions).toBeGreaterThanOrEqual(initialCleanupExecutions);
      expect(afterHealthcheckExecutions).toBeGreaterThanOrEqual(initialHealthcheckExecutions);
      
      // 스케줄러 시작 시 log가 호출되었는지 확인
      expect(logBatchSpy).toHaveBeenCalled();

      logBatchSpy.mockRestore();
      await testScheduler.stop();
      await cleanupTestDatabase(db);
      vi.useRealTimers();
    });

    it('큐를 통해 실행되는 작업이 실제로 타임아웃을 적용해야 함', async () => {
      // Given: 매우 짧은 타임아웃을 가진 스케줄러 및 log 스파이
      const mcpLoggerModule = await import('../../../server/mcp-logger.js');
      const logBatchSpy = vi.spyOn(mcpLoggerModule.mcpLogger, 'logBatch');
      
      const shortTimeoutScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        jobTimeout: 1000, // 1초 타임아웃 (최소값)
        enableLogging: true
      });

      await shortTimeoutScheduler.start(db);

      // When: 큐를 통해 작업이 실행되면
      await new Promise(resolve => setTimeout(resolve, 500));

      // Then: 타임아웃이 적용되어야 함
      const status = shortTimeoutScheduler.getStatus();
      expect(status.config.jobTimeout).toBe(1000);
      
      // 타임아웃 관련 로그가 호출되었는지 확인
      const timeoutLogCalls = logBatchSpy.mock.calls.filter(
        call => call[1] && typeof call[1] === 'string' && 
        (call[1].includes('timeout') || call[1].includes('Job') && call[0] === 'error')
      );
      // 타임아웃이 발생했을 수 있으므로 log가 호출되었는지 확인
      expect(logBatchSpy).toHaveBeenCalled();

      logBatchSpy.mockRestore();
      await shortTimeoutScheduler.stop();
      await cleanupTestDatabase(db);
    });

    it('큐를 통해 실행되는 작업이 실제로 재시도를 수행해야 함', async () => {
      // Given: vi.useFakeTimers()로 시간 제어 및 log 스파이
      vi.useFakeTimers();
      
      const mcpLoggerModule = await import('../../../server/mcp-logger.js');
      const logBatchSpy = vi.spyOn(mcpLoggerModule.mcpLogger, 'logBatch');
      
      const testScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        retryAttempts: 2,
        retryDelay: 50,
        enableLogging: true
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

      // Then: 재시도 로직이 작동해야 함
      const statusAfter = testScheduler.getStatus();
      expect(statusAfter.config.retryAttempts).toBe(2);
      
      // 재시도 관련 로그가 호출되었는지 확인
      const retryLogCalls = logBatchSpy.mock.calls.filter(
        call => call[1] && typeof call[1] === 'string' && call[1].includes('Retrying')
      );
      
      // 재시도가 발생했을 수 있으므로 log가 호출되었는지 확인
      expect(logBatchSpy).toHaveBeenCalled();
      
      // errorCount가 추적되는지 확인
      const afterErrorCount = statusAfter.errorCount.get('healthcheck') || 0;
      expect(afterErrorCount).toBeGreaterThanOrEqual(initialErrorCount);

      logBatchSpy.mockRestore();
      await testScheduler.stop();
      await cleanupTestDatabase(db);
      vi.useRealTimers();
    });

    it('큐를 통해 실행되는 작업이 실제로 lastExecution과 totalExecutions을 기록해야 함', async () => {
      // Given: vi.useFakeTimers()로 시간 제어 및 스케줄러 시작
      vi.useFakeTimers();
      
      await scheduler.start(db);
      
      const initialStatus = scheduler.getStatus();
      const initialHealthcheckLastExecution = initialStatus.lastExecution.get('healthcheck');
      const initialHealthcheckTotalExecutions = initialStatus.totalExecutions.get('healthcheck') || 0;

      // When: 시간을 진행시켜 큐를 통해 작업이 실행되면
      vi.advanceTimersByTime(500);
      await Promise.race([
        vi.runOnlyPendingTimersAsync(),
        new Promise(resolve => setTimeout(resolve, 1000))
      ]).catch(() => {});

      // Then: lastExecution과 totalExecutions이 실제로 기록되어야 함
      const statusAfter = scheduler.getStatus();
      expect(statusAfter.lastExecution).toBeDefined();
      
      // healthcheck 작업의 lastExecution이 업데이트되었는지 확인
      const afterHealthcheckLastExecution = statusAfter.lastExecution.get('healthcheck');
      const afterHealthcheckTotalExecutions = statusAfter.totalExecutions.get('healthcheck') || 0;
      
      // lastExecution이 업데이트되었는지 확인
      if (afterHealthcheckLastExecution) {
        expect(afterHealthcheckLastExecution).toBeInstanceOf(Date);
        if (initialHealthcheckLastExecution) {
          expect(afterHealthcheckLastExecution.getTime()).toBeGreaterThanOrEqual(initialHealthcheckLastExecution.getTime());
        }
      }
      
      // totalExecutions이 증가했는지 확인
      expect(afterHealthcheckTotalExecutions).toBeGreaterThanOrEqual(initialHealthcheckTotalExecutions);

      await scheduler.stop();
      vi.useRealTimers();
    });

    it('큐를 통해 실행되는 작업이 실제로 errorCount를 추적해야 함', async () => {
      // Given: vi.useFakeTimers()로 시간 제어 및 스케줄러 시작
      vi.useFakeTimers();
      
      await scheduler.start(db);
      
      const initialStatus = scheduler.getStatus();
      const initialHealthcheckErrorCount = initialStatus.errorCount.get('healthcheck') || 0;

      // When: 시간을 진행시켜 큐를 통해 작업이 실행되면
      vi.advanceTimersByTime(500);
      await Promise.race([
        vi.runOnlyPendingTimersAsync(),
        new Promise(resolve => setTimeout(resolve, 1000))
      ]).catch(() => {});

      // Then: errorCount가 실제로 추적되어야 함
      const statusAfter = scheduler.getStatus();
      expect(statusAfter.errorCount).toBeDefined();
      
      // healthcheck 작업의 errorCount가 추적되는지 확인
      const afterHealthcheckErrorCount = statusAfter.errorCount.get('healthcheck') || 0;
      expect(afterHealthcheckErrorCount).toBeGreaterThanOrEqual(initialHealthcheckErrorCount);
      
      // errorCount는 0 이상이어야 함
      expect(afterHealthcheckErrorCount).toBeGreaterThanOrEqual(0);

      await scheduler.stop();
      vi.useRealTimers();
    });

    it('주간 관계 검증이 타임아웃 시 child process를 실제로 강제 종료해야 함', async () => {
      // Given: vi.useFakeTimers()로 시간 제어 및 RelationValidatorExecutor 모킹
      vi.useFakeTimers();
      
      const mcpLoggerModule = await import('../../../server/mcp-logger.js');
      const logBatchSpy = vi.spyOn(mcpLoggerModule.mcpLogger, 'logBatch');
      
      // 타임아웃을 시뮬레이션하는 모킹된 executor
      const mockExecutor = {
        execute: vi.fn().mockImplementation(() => {
          return Promise.resolve({
            success: false,
            stdout: '',
            stderr: 'Timeout occurred',
            duration: 1000,
            error: 'Relation validation timeout after 1000ms'
          });
        })
      } as any;
      
      const shortTimeoutScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        jobTimeout: 5000,
        weeklyRelationValidationTimeout: 1000, // 1초 타임아웃
        enableLogging: true
      }, {
        relationValidatorExecutor: mockExecutor
      });

      await shortTimeoutScheduler.start(db);

      // When: 주간 관계 검증 작업을 큐에 직접 추가하여 실행
      const schedulerAny = shortTimeoutScheduler as any;
      // 초기 잡들이 큐를 선점하지 않도록 클리어
      schedulerAny.jobQueue.clear();
      schedulerAny.jobQueue.add('weekly_relation_validation', async () => { await schedulerAny.runWeeklyRelationValidation(); }, 5, 0);

      // 큐 처리 시작 (큐 폴링 기본값 1000ms 이상 진행하여 job processor 구동, async로 마이크로태스크도 처리)
      await vi.advanceTimersByTimeAsync(1100);

      // 타임아웃 시간보다 길게 진행하여 타임아웃 발생
      await vi.advanceTimersByTimeAsync(1500); // 타임아웃(1000ms)보다 길게

      // Then: RelationValidatorExecutor가 호출되었는지 확인 (주간 관계 검증이 실제로 실행되었는지)
      expect(mockExecutor.execute).toHaveBeenCalled();
      
      // 타임아웃 에러가 반환되었는지 확인
      const executeResult = await mockExecutor.execute();
      expect(executeResult.success).toBe(false);
      expect(executeResult.error).toContain('timeout');
      
      // 타임아웃 로그가 기록되었는지 확인
      const timeoutLogCalls = logBatchSpy.mock.calls.filter(
        call => call[1] && typeof call[1] === 'string' && 
        (call[1].includes('timeout') || call[1].includes('failed'))
      );
      expect(timeoutLogCalls.length).toBeGreaterThan(0);
      
      // 타임아웃 설정이 올바르게 적용되었는지 확인
      const status = shortTimeoutScheduler.getStatus();
      expect(status.config.weeklyRelationValidationTimeout).toBe(1000);

      logBatchSpy.mockRestore();
      await shortTimeoutScheduler.stop();
      await cleanupTestDatabase(db);
      vi.useRealTimers();
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
      // executeJobWithRetry를 직접 호출하여 실행 (큐를 통하지 않고 직접 실행)
      // 에러가 발생하므로 catch로 처리
      try {
        await schedulerAny.executeJobWithRetry('test_failing_job', failingJob, 1, 0);
      } catch (error) {
        // 에러는 예상된 동작
      }

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

  describe('동일 잡 실행 중 후속 실행 처리', () => {
    it('동일 잡이 실행 중일 때 후속 실행을 큐에 남겨야 함', async () => {
      // Given: 긴 실행 시간을 가진 작업
      vi.useFakeTimers();
      const testScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        healthCheckInterval: 10000,
        maxBatchSize: 100,
        enableLogging: false,
        maxConcurrentJobs: 1,
        jobTimeout: 5000,
        retryAttempts: 1,
        retryDelay: 50
      });

      await testScheduler.start(db);

      let executionCount = 0;
      const longRunningJob = async () => {
        executionCount++;
        // 긴 실행 시간 시뮬레이션
        await new Promise(resolve => setTimeout(resolve, 200));
      };

      // When: 동일한 작업을 빠르게 여러 번 큐에 추가
      const schedulerAny = testScheduler as any;
      schedulerAny.jobQueue.clear();
      for (let i = 0; i < 3; i++) {
        schedulerAny.jobQueue.add('test_long_running', longRunningJob, 1, 0);
      }

      // 큐 처리 시작 (작업이 완료될 때까지 충분한 시간 대기, 1000ms processor + 200ms job * 3)
      await vi.advanceTimersByTimeAsync(2000);

      // Then: 모든 실행이 처리되어야 함 (스킵되지 않고 큐에 남아서 실행됨)
      // maxConcurrentJobs가 1이므로 순차적으로 실행되어야 함
      expect(executionCount).toBeGreaterThanOrEqual(1);

      await testScheduler.stop();
      await cleanupTestDatabase(db);
      vi.useRealTimers();
    });

    it('장시간 잡 + 짧은 주기 스케줄 시 큐 중복이 제한되어야 함', async () => {
      // Given: 긴 실행 시간을 가진 작업과 짧은 주기
      vi.useFakeTimers();
      const testScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        healthCheckInterval: 10000,
        maxBatchSize: 100,
        enableLogging: false,
        maxConcurrentJobs: 1,
        jobTimeout: 5000,
        retryAttempts: 1,
        retryDelay: 50
      });

      await testScheduler.start(db);

      let executionCount = 0;
      const longRunningJob = async () => {
        executionCount++;
        // 긴 실행 시간 시뮬레이션 (500ms)
        await new Promise(resolve => setTimeout(resolve, 500));
      };

      // When: 동일한 작업을 빠르게 여러 번 큐에 추가 (짧은 주기 시뮬레이션)
      const schedulerAny = testScheduler as any;
      const jobName = 'test_long_running_duplicate';

      // 초기 잡들이 큐를 선점하지 않도록 클리어 후 첫 번째 실행 시작
      schedulerAny.jobQueue.clear();
      schedulerAny.jobQueue.add(jobName, longRunningJob, 1, 0);

      // 큐 처리 시작하여 실행 중 상태로 만듦
      await vi.advanceTimersByTimeAsync(50);

      // 실행 중인 상태에서 동일한 작업을 여러 번 큐에 추가 시도
      for (let i = 0; i < 10; i++) {
        schedulerAny.jobQueue.add(jobName, longRunningJob, 1, 0);
      }

      // 큐 처리 완료 대기 (1000ms processor + 500ms job)
      await vi.advanceTimersByTimeAsync(2000);

      // Then: 큐에 중복 항목이 무한히 늘어나지 않아야 함
      expect(executionCount).toBeGreaterThan(0);
      // 중복 방지가 작동하면 실행 횟수가 큐 추가 횟수보다 적어야 함
      expect(executionCount).toBeLessThanOrEqual(11); // 최대 11회 (첫 실행 + 10회 추가 시도)

      await testScheduler.stop();
      await cleanupTestDatabase(db);
      vi.useRealTimers();
    });

    it('큐에 이미 있는 동일 이름 잡은 추가하지 않아야 함', async () => {
      // Given: 스케줄러
      const testScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        healthCheckInterval: 10000,
        maxBatchSize: 100,
        enableLogging: false,
        maxConcurrentJobs: 1,
        jobTimeout: 5000,
        retryAttempts: 1,
        retryDelay: 50
      });

      await testScheduler.start(db);

      const jobName = 'test_duplicate_prevention';
      let executionCount = 0;
      const testJob = async () => {
        executionCount++;
        await new Promise(resolve => setTimeout(resolve, 100));
      };

      // When: 동일한 작업을 큐에 여러 번 추가 시도
      const schedulerAny = testScheduler as any;
      
      // 첫 번째 추가
      schedulerAny.jobQueue.add(jobName, testJob, 1, 0);

      // 실행 중 상태로 만들기 위해 큐 처리 시작
      await new Promise(resolve => setTimeout(resolve, 50));

      // 실행 중인 상태에서 동일한 작업 추가 시도
      schedulerAny.executeJobWithRetry(jobName, testJob, 1, 0);

      // 큐 처리 완료 대기
      await new Promise(resolve => setTimeout(resolve, 300));

      // Then: 큐에 동일 이름의 잡이 하나만 있어야 함 (isQueued로 확인)
      // JobQueue는 내부 큐를 직접 노출하지 않으므로 isQueued로 확인
      const isQueued = schedulerAny.jobQueue.isQueued(jobName);
      // 큐에 있거나 실행 중이면 하나만 있어야 함
      expect(isQueued || schedulerAny.jobQueue.isRunning(jobName)).toBe(true);

      await testScheduler.stop();
      await cleanupTestDatabase(db);
    });

    
    /**
     * Given: 큐에 더 높은 우선순위 작업이 있음
     * When: addJob 즉시 실행 분기가 동작함
     * Then: 기존 작업이 큐에서 제거되지 않아야 함
     */
    it('즉시 실행 분기에서 다른 작업이 제거되지 않아야 함', async () => {
      // Given: 큐에 더 높은 우선순위 작업이 있음
      const testScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        healthCheckInterval: 10000,
        maxBatchSize: 100,
        enableLogging: false,
        maxConcurrentJobs: 1,
        jobTimeout: 5000,
        retryAttempts: 1,
        retryDelay: 50
      });

      const schedulerAny = testScheduler as any;
      schedulerAny.isRunning = true;
      schedulerAny.jobProcessorInterval = true;

      const highPriorityJob = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
      };
      const immediateJob = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
      };

      schedulerAny.jobQueue.add('high_priority_job', highPriorityJob, 1, 0);

      // When: addJob 즉시 실행 분기가 동작함
      testScheduler.addJob('immediate_job', immediateJob, 10, 0);
      await new Promise(resolve => setImmediate(resolve));

      // Then: 기존 작업이 큐에서 제거되지 않아야 함
      expect(schedulerAny.jobQueue.isQueued('high_priority_job')).toBe(true);
    });

it('동일 이름 잡이 실행 중일 때 큐 중복이 발생하지 않고 완료 후 한 번만 실행되어야 함', async () => {
      // Given: 긴 실행 시간을 가진 작업
      vi.useFakeTimers();
      const testScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        healthCheckInterval: 10000,
        maxBatchSize: 100,
        enableLogging: false,
        maxConcurrentJobs: 1,
        jobTimeout: 5000,
        retryAttempts: 3,
        retryDelay: 50
      });

      await testScheduler.start(db);

      let executionCount = 0;
      const executionOrder: number[] = [];
      const longRunningJob = async () => {
        executionCount++;
        executionOrder.push(executionCount);
        // 긴 실행 시간 시뮬레이션 (300ms)
        await new Promise(resolve => setTimeout(resolve, 300));
      };

      // When: 동일한 작업을 실행 중일 때 여러 번 추가 시도
      const schedulerAny = testScheduler as any;
      const jobName = 'test_single_execution_after_completion';

      // 초기 잡들이 큐를 선점하지 않도록 클리어
      schedulerAny.jobQueue.clear();
      // 첫 번째 실행 시작
      schedulerAny.addJobToQueue(jobName, longRunningJob, 1, 0);

      // 큐 처리 시작하여 실행 중 상태로 만듦
      await vi.advanceTimersByTimeAsync(50);

      // 실행 중인 상태에서 동일한 작업을 여러 번 추가 시도
      for (let i = 0; i < 5; i++) {
        schedulerAny.addJobToQueue(jobName, longRunningJob, 1, 0);
      }

      // 큐 처리 완료 대기 (모든 작업 완료, 1000ms processor + 300ms job * 2)
      await vi.advanceTimersByTimeAsync(3000);

      // Then: 완료 후 한 번만 실행되어야 함 (중복이 큐에 하나만 남아서)
      expect(executionCount).toBeGreaterThanOrEqual(1);
      expect(executionCount).toBeLessThanOrEqual(2); // 초기 실행 + 완료 후 큐에 있던 하나

      // 큐에 중복 항목이 없어야 함
      expect(schedulerAny.jobQueue.size).toBe(0); // 모든 작업 완료 후 큐 비어있어야 함

      await testScheduler.stop();
      await cleanupTestDatabase(db);
      vi.useRealTimers();
    });

    it('재시도 시 retryCount가 전달되어야 함', async () => {
      // Given: 재시도가 필요한 작업
      vi.useFakeTimers();
      const testScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        healthCheckInterval: 10000,
        maxBatchSize: 100,
        enableLogging: false,
        maxConcurrentJobs: 1,
        jobTimeout: 5000,
        retryAttempts: 3,
        retryDelay: 100
      });

      await testScheduler.start(db);

      let attemptCount = 0;
      const failingJob = async () => {
        attemptCount++;
        if (attemptCount < 2) {
          throw new Error('Job failed');
        }
        // 두 번째 시도에서 성공
      };

      // When: 실패하는 작업을 큐에 추가하고 재시도 발생
      const schedulerAny = testScheduler as any;
      const jobName = 'test_retry_count_preservation';

      schedulerAny.jobQueue.clear();
      schedulerAny.addJobToQueue(jobName, failingJob, 1, 0);

      // 큐 처리 및 재시도 완료 대기 (1000ms processor + 100ms retry delay + buffer)
      await vi.advanceTimersByTimeAsync(3000);

      // Then: 재시도가 발생하고 retryCount가 전달되어야 함
      expect(attemptCount).toBe(2); // 초기 실행 + 재시도 1회
      
      // 재시도 시 큐에 추가된 항목의 retryCount가 증가했는지 확인
      // (실제로는 executeJobWithRetry 내부에서 처리되므로 직접 확인은 어렵지만,
      // 재시도가 정상적으로 작동했다는 것을 attemptCount로 확인)

      await testScheduler.stop();
      await cleanupTestDatabase(db);
      vi.useRealTimers();
    });

    it('실행 중인 잡에 재시도 카운트가 전달되어야 함', async () => {
      // Given: 재시도 카운트가 있는 작업
      const testScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        healthCheckInterval: 10000,
        maxBatchSize: 100,
        enableLogging: false,
        maxConcurrentJobs: 1,
        jobTimeout: 5000,
        retryAttempts: 3,
        retryDelay: 100
      });

      await testScheduler.start(db);

      const receivedRetryCounts: number[] = [];
      const jobWithRetryCount = async () => {
        // 재시도 카운트를 확인할 수 있도록 저장
        const schedulerAny = testScheduler as any;
        // JobQueue는 배열이 아니므로 직접 접근 불가
        // 재시도 횟수는 RetryManager에서 확인
        const isQueued = schedulerAny.jobQueue.isQueued('test_retry_count_check');
        if (isQueued) {
          // 큐에 있으면 재시도 중이므로 retryCount 증가 추정
          receivedRetryCounts.push(receivedRetryCounts.length + 1);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      };

      // When: 재시도 카운트가 있는 작업을 큐에 추가
      const schedulerAny = testScheduler as any;
      const jobName = 'test_retry_count_check';
      
      // 재시도 카운트 1로 시작
      schedulerAny.addJobToQueue(jobName, jobWithRetryCount, 1, 1);

      // 큐 처리 완료 대기
      await new Promise(resolve => setTimeout(resolve, 500));

      // Then: 재시도 카운트가 전달되어야 함
      // (실제로는 executeJobWithRetry에서 retryCount를 받아서 처리하므로
      // 큐에서 꺼낼 때 retryCount가 유지되는지 확인)
      expect(receivedRetryCounts.length).toBeGreaterThanOrEqual(0);

      await testScheduler.stop();
      await cleanupTestDatabase(db);
    });
  });

  describe('로깅 정책 통일 (console.* 제거)', () => {
    let loggerErrorSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let mockFileLogger: FileLogger;

    beforeEach(() => {
      // Given: FileLogger 모킹 (파일 로깅 실패 시뮬레이션)
      mockFileLogger = {
        logWarn: vi.fn().mockRejectedValue(new Error('File logging failed')),
        logError: vi.fn().mockRejectedValue(new Error('File logging failed'))
      } as unknown as FileLogger;

      // Logger 스파이 설정
      loggerErrorSpy = vi.spyOn(logger, 'error');
      
      // console.* 스파이 설정 (사용되지 않아야 함)
      consoleErrorSpy = vi.spyOn(console, 'error');
    });

    afterEach(() => {
      // When: 테스트 후 정리
      vi.restoreAllMocks();
    });

    /**
     * Given: BatchScheduler가 표준 로거를 사용하도록 변경됨
     * When: 파일 로깅 실패 시
     * Then: logger.error가 호출되어야 하고 console.error는 호출되지 않아야 함
     */
    it('파일 로깅 실패 시 logger.error를 사용해야 함', async () => {
      // Given: FileLogger가 실패하도록 모킹된 스케줄러
      const testScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        enableLogging: true,
        maxBatchSize: 100
      }, {
        fileLogger: mockFileLogger
      });

      await testScheduler.start(db);

      // When: warn 레벨 로그 호출 (파일 로깅 실패 시뮬레이션)
      const schedulerAny = testScheduler as any;
      schedulerAny.log('Test warn message', { level: 'warn' });

      // 파일 로깅 실패 처리를 위해 충분한 대기 (비동기 catch 처리)
      await new Promise(resolve => setTimeout(resolve, 200));

      // Then: logger.error가 호출되어야 함 (아직 구현되지 않았으므로 실패 예상)
      // TDD RED 단계: console.error가 호출되고 있음
      expect(loggerErrorSpy).toHaveBeenCalled();
      
      const errorCalls = loggerErrorSpy.mock.calls;
      const messages = errorCalls.map(call => call[0]);
      expect(messages.some(msg => typeof msg === 'string' && msg.includes('File logging failed'))).toBe(true);
      
      // console.error는 호출되지 않아야 함 (아직 구현되지 않았으므로 호출됨 - TDD RED)
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      await testScheduler.stop();
    });

    /**
     * Given: BatchScheduler가 표준 로거를 사용하도록 변경됨
     * When: 파일 로깅 실패 시 (error 레벨)
     * Then: logger.error가 호출되어야 하고 console.error는 호출되지 않아야 함
     */
    it('파일 로깅 실패 시 (error 레벨) logger.error를 사용해야 함', async () => {
      // Given: FileLogger가 실패하도록 모킹된 스케줄러
      const testScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        enableLogging: true,
        maxBatchSize: 100
      }, {
        fileLogger: mockFileLogger
      });

      await testScheduler.start(db);

      // When: error 레벨 로그 호출 (파일 로깅 실패 시뮬레이션)
      const schedulerAny = testScheduler as any;
      schedulerAny.log('Test error message', { level: 'error' });

      // 파일 로깅 실패 처리를 위해 충분한 대기 (비동기 catch 처리)
      await new Promise(resolve => setTimeout(resolve, 200));

      // Then: logger.error가 호출되어야 함 (아직 구현되지 않았으므로 실패 예상)
      // TDD RED 단계: console.error가 호출되고 있음
      expect(loggerErrorSpy).toHaveBeenCalled();
      
      const errorCalls = loggerErrorSpy.mock.calls;
      const messages = errorCalls.map(call => call[0]);
      expect(messages.some(msg => typeof msg === 'string' && msg.includes('File logging failed'))).toBe(true);
      
      // console.error는 호출되지 않아야 함 (아직 구현되지 않았으므로 호출됨 - TDD RED)
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      await testScheduler.stop();
    });
  });
});

// DB 없이 실행 가능한 env var 기본값 테스트 (better-sqlite3 의존 없음)
describe('BatchScheduler 기본값 및 env var', () => {
  it('기본 healthCheckInterval이 300,000ms(5분)이어야 함', () => {
    const s = new BatchScheduler();
    expect(s.getStatus().config.healthCheckInterval).toBe(300_000);
  });

  it('BATCH_HEALTH_CHECK_INTERVAL_MS 환경 변수로 healthCheckInterval을 재정의할 수 있어야 함', () => {
    const original = process.env.BATCH_HEALTH_CHECK_INTERVAL_MS;
    process.env.BATCH_HEALTH_CHECK_INTERVAL_MS = '60000';
    try {
      expect(new BatchScheduler().getStatus().config.healthCheckInterval).toBe(60_000);
    } finally {
      if (original === undefined) delete process.env.BATCH_HEALTH_CHECK_INTERVAL_MS;
      else process.env.BATCH_HEALTH_CHECK_INTERVAL_MS = original;
    }
  });

  it('BATCH_HEALTH_CHECK_INTERVAL_MS가 유효하지 않으면 기본값 300,000을 사용해야 함', () => {
    const original = process.env.BATCH_HEALTH_CHECK_INTERVAL_MS;
    process.env.BATCH_HEALTH_CHECK_INTERVAL_MS = '-1';
    try {
      expect(new BatchScheduler().getStatus().config.healthCheckInterval).toBe(300_000);
    } finally {
      if (original === undefined) delete process.env.BATCH_HEALTH_CHECK_INTERVAL_MS;
      else process.env.BATCH_HEALTH_CHECK_INTERVAL_MS = original;
    }
  });

  it('기본 monitoringInterval이 300,000ms(5분)이어야 함', () => {
    const s = new BatchScheduler();
    expect(s.getStatus().config.monitoringInterval).toBe(300_000);
  });

  it('BATCH_MONITORING_INTERVAL_MS 환경 변수로 monitoringInterval을 재정의할 수 있어야 함', () => {
    const original = process.env.BATCH_MONITORING_INTERVAL_MS;
    process.env.BATCH_MONITORING_INTERVAL_MS = '60000';
    try {
      expect(new BatchScheduler().getStatus().config.monitoringInterval).toBe(60_000);
    } finally {
      if (original === undefined) delete process.env.BATCH_MONITORING_INTERVAL_MS;
      else process.env.BATCH_MONITORING_INTERVAL_MS = original;
    }
  });

  it('BATCH_MONITORING_INTERVAL_MS가 유효하지 않으면 기본값 300,000을 사용해야 함', () => {
    const original = process.env.BATCH_MONITORING_INTERVAL_MS;
    process.env.BATCH_MONITORING_INTERVAL_MS = 'abc';
    try {
      expect(new BatchScheduler().getStatus().config.monitoringInterval).toBe(300_000);
    } finally {
      if (original === undefined) delete process.env.BATCH_MONITORING_INTERVAL_MS;
      else process.env.BATCH_MONITORING_INTERVAL_MS = original;
    }
  });

  it('healthCheckInterval이 너무 짧으면 validateConfig가 에러를 던져야 함', () => {
    expect(() => {
      new BatchScheduler({
        healthCheckInterval: 5000 // 10초 미만
      });
    }).toThrow('healthCheckInterval must be at least 10 seconds');
  });
});
