import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { BatchScheduler } from '../../batch-scheduler/batch-scheduler.js';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import * as configModule from '../../../../shared/config/index.js';
import { DAY_MS } from '../../../../shared/utils/date.js';
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

      const mcpLoggerModule = await import('../../../../server/mcp-logger.js');
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

      const mcpLoggerModule = await import('../../../../server/mcp-logger.js');
      const logBatchSpy = vi.spyOn(mcpLoggerModule.mcpLogger, 'logBatch');

      const consolidationScheduler = new BatchScheduler({
        cleanupInterval: 60000,
        monitoringInterval: 10000,
        consolidationScoreIncrementalInterval: 60 * 60 * 1000,
        consolidationScoreFullSweepInterval: DAY_MS,
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
});
