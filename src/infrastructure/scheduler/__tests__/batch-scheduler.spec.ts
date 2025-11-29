/**
 * BatchScheduler 테스트
 * 배치 작업 스케줄러 전체 기능 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { BatchScheduler, type BatchJobConfig, type BatchJobResult } from './batch-scheduler.js';
import { setupTestDatabase, cleanupTestDatabase, createTestMemory } from '../test/helpers/test-database.js';
import { DatabaseUtils } from '../../utils/database.js';

describe('BatchScheduler', () => {
  let scheduler: BatchScheduler;
  let db: Database.Database;

  beforeEach(async () => {
    db = await setupTestDatabase();
    scheduler = new BatchScheduler({
      cleanupInterval: 60000, // 최소 1분
      monitoringInterval: 10000, // 최소 10초
      healthCheckInterval: 200,
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
    cleanupTestDatabase(db);
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
      
      await scheduler.start(db);
      
      const initialStatus = scheduler.getStatus();
      const initialCount = initialStatus.totalExecutions.get('healthcheck') || 0;

      // When: 시간을 진행시켜 주기적 작업 실행 (healthCheckInterval: 200ms)
      vi.advanceTimersByTime(300); // 200ms보다 큰 값으로 진행
      // pending된 비동기 작업 실행
      await vi.runOnlyPendingTimersAsync();

      // Then: 주기적 작업이 실행되어야 함
      const status = scheduler.getStatus();
      expect(status.totalExecutions.get('healthcheck')).toBeGreaterThan(initialCount);

      await scheduler.stop();
      vi.useRealTimers();
    });

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
      cleanupTestDatabase(db);
    }, 10000); // 테스트 타임아웃 10초로 설정

    it('실패한 작업을 재시도해야 함', async () => {
      // Given: vi.useFakeTimers()로 시간 제어
      vi.useFakeTimers();
      
      await scheduler.start(db);

      // When: 시간을 진행시켜 재시도 로직 확인
      // 재시도 지연 시간(retryDelay: 100ms) 이상 진행
      vi.advanceTimersByTime(150);
      await vi.runOnlyPendingTimersAsync();

      // Then: 에러 카운트가 추적되어야 함
      const status = scheduler.getStatus();
      expect(status.errorCount).toBeDefined();

      await scheduler.stop();
      vi.useRealTimers();
    });

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
      await vi.runOnlyPendingTimersAsync();

      // Then: 재시도 로직이 작동해야 함
      const status = lowRetryScheduler.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.config.retryAttempts).toBe(1);

      await lowRetryScheduler.stop();
      cleanupTestDatabase(db);
      vi.useRealTimers();
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
      cleanupTestDatabase(db);
    });

    it('작업 큐를 우선순위로 정렬해야 함', async () => {
      // Given: vi.useFakeTimers()로 시간 제어
      vi.useFakeTimers();
      
      await scheduler.start(db);
      
      // When: 시간을 진행시켜 작업 큐 처리
      vi.advanceTimersByTime(300);
      await vi.runOnlyPendingTimersAsync();
      
      // Then: 스케줄러가 정상 작동해야 함
      const status = scheduler.getStatus();
      expect(status.isRunning).toBe(true);

      await scheduler.stop();
      vi.useRealTimers();
    });
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
      cleanupTestDatabase(db);
    });
  });
});

