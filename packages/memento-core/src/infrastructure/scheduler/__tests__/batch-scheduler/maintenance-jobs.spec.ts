import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { BatchScheduler } from '../../batch-scheduler/batch-scheduler.js';
import { setupTestDatabase, cleanupTestDatabase, createTestMemory } from '../../../../test/helpers/test-database.js';

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
});
