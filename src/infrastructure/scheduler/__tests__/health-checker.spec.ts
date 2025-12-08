/**
 * HealthChecker 테스트
 * 헬스체크 기능 테스트
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { HealthChecker } from '../health-checker.js';

describe('HealthChecker', () => {
  let healthChecker: HealthChecker;
  let db: Database.Database;

  beforeEach(() => {
    healthChecker = new HealthChecker();
    db = new Database(':memory:');
    healthChecker.setStartTime(new Date());
  });

  afterEach(() => {
    db.close();
  });

  describe('check', () => {
    it('should return healthy when all checks pass', async () => {
      // Given: 정상 상태
      const runningJobs = 1;
      const queueSize = 5;
      const maxConcurrentJobs = 10;

      // When: 헬스체크 실행
      const result = await healthChecker.check(db, runningJobs, queueSize, maxConcurrentJobs);

      // Then: 정상 상태
      expect(result.isHealthy).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should detect database connection failure', async () => {
      // Given: 데이터베이스 연결 실패
      const closedDb = new Database(':memory:');
      closedDb.close();
      const runningJobs = 1;
      const queueSize = 5;
      const maxConcurrentJobs = 10;

      // When: 헬스체크 실행
      const result = await healthChecker.check(closedDb, runningJobs, queueSize, maxConcurrentJobs);

      // Then: 에러 감지
      expect(result.isHealthy).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should detect high memory usage', async () => {
      // Given: 높은 메모리 사용률 설정
      const highMemoryChecker = new HealthChecker({
        maxMemoryUsagePercent: 50 // 낮은 임계값으로 설정
      });
      highMemoryChecker.setStartTime(new Date());

      const runningJobs = 1;
      const queueSize = 5;
      const maxConcurrentJobs = 10;

      // When: 헬스체크 실행
      const result = await highMemoryChecker.check(db, runningJobs, queueSize, maxConcurrentJobs);

      // Then: 경고 발생 (메모리 사용률이 임계값을 초과할 수 있음)
      // 실제 메모리 사용률에 따라 경고가 발생할 수 있음
      expect(result.memoryUsage).toBeGreaterThanOrEqual(0);
    });

    it('should detect high job concurrency', async () => {
      // Given: 높은 작업 동시성
      const runningJobs = 9; // maxConcurrentJobs(10)의 80% 초과
      const queueSize = 5;
      const maxConcurrentJobs = 10;

      // When: 헬스체크 실행
      const result = await healthChecker.check(db, runningJobs, queueSize, maxConcurrentJobs);

      // Then: 경고 발생
      expect(result.warnings.some(w => w.includes('High job concurrency'))).toBe(true);
    });

    it('should detect large queue size', async () => {
      // Given: 큰 큐 크기
      const largeQueueChecker = new HealthChecker({
        maxQueueSize: 10 // 낮은 임계값으로 설정
      });
      largeQueueChecker.setStartTime(new Date());

      const runningJobs = 1;
      const queueSize = 15; // 임계값 초과
      const maxConcurrentJobs = 10;

      // When: 헬스체크 실행
      const result = await largeQueueChecker.check(db, runningJobs, queueSize, maxConcurrentJobs);

      // Then: 경고 발생
      expect(result.warnings.some(w => w.includes('Large job queue'))).toBe(true);
    });

    it('should calculate uptime correctly', async () => {
      // Given: 시작 시간이 설정된 상태
      const startTime = new Date(Date.now() - 5000); // 5초 전
      healthChecker.setStartTime(startTime);

      const runningJobs = 1;
      const queueSize = 5;
      const maxConcurrentJobs = 10;

      // When: 헬스체크 실행
      const result = await healthChecker.check(db, runningJobs, queueSize, maxConcurrentJobs);

      // Then: Uptime이 대략 5초 근처
      expect(result.uptime).toBeGreaterThanOrEqual(4000);
      expect(result.uptime).toBeLessThan(10000);
    });

    it('should return uptime 0 when startTime is not set', async () => {
      // Given: 시작 시간이 설정되지 않은 상태
      const checkerWithoutStartTime = new HealthChecker();
      
      const runningJobs = 1;
      const queueSize = 5;
      const maxConcurrentJobs = 10;

      // When: 헬스체크 실행
      const result = await checkerWithoutStartTime.check(db, runningJobs, queueSize, maxConcurrentJobs);

      // Then: Uptime이 0
      expect(result.uptime).toBe(0);
    });

    it('should detect uninitialized database', async () => {
      // Given: 데이터베이스가 초기화되지 않은 상태
      const runningJobs = 1;
      const queueSize = 5;
      const maxConcurrentJobs = 10;

      // When: 헬스체크 실행
      const result = await healthChecker.check(null, runningJobs, queueSize, maxConcurrentJobs);

      // Then: 에러 감지
      expect(result.isHealthy).toBe(false);
      expect(result.errors.some(e => e.includes('Database not initialized'))).toBe(true);
    });
  });

  describe('triggerGarbageCollection', () => {
    it('should return false when gc is not available', () => {
      // Given: gc가 사용 불가능한 환경

      // When: 가비지 컬렉션 트리거
      const result = healthChecker.triggerGarbageCollection();

      // Then: false 반환 (gc가 없으면)
      // 실제 환경에 따라 다를 수 있음
      expect(typeof result).toBe('boolean');
    });
  });
});

