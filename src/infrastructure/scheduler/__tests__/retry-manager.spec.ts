/**
 * RetryManager 테스트
 * 재시도 관리 기능 테스트
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RetryManager, type RetryConfig } from '../retry-manager.js';

describe('RetryManager', () => {
  let retryManager: RetryManager;
  let config: RetryConfig;

  beforeEach(() => {
    config = {
      maxAttempts: 3,
      baseDelay: 1000,
      maxErrorCount: 9 // maxAttempts * 3
    };
    retryManager = new RetryManager(config);
  });

  describe('shouldRetry', () => {
    it('should return shouldRetry=true when retry count is below max', () => {
      // Given: 재시도 횟수가 최대값 미만
      const jobName = 'test-job';
      const currentRetryCount = 1;
      const errorCount = 1;

      // When: 재시도 여부 결정
      const result = retryManager.shouldRetry(jobName, currentRetryCount, errorCount);

      // Then: 재시도 가능
      expect(result.shouldRetry).toBe(true);
      expect(result.retryCount).toBe(2);
      expect(result.nextRetryDelay).toBeGreaterThan(0);
    });

    it('should return shouldRetry=false when retry count exceeds max', () => {
      // Given: 재시도 횟수가 최대값 초과
      const jobName = 'test-job';
      const currentRetryCount = 3; // maxAttempts와 동일
      const errorCount = 3;

      // When: 재시도 여부 결정
      const result = retryManager.shouldRetry(jobName, currentRetryCount, errorCount);

      // Then: 재시도 불가
      expect(result.shouldRetry).toBe(false);
      expect(result.nextRetryDelay).toBe(0);
    });

    it('should calculate exponential backoff correctly', () => {
      // Given: 재시도 횟수별 지수 백오프
      const jobName = 'test-job';
      const baseDelay = 1000;

      // When: 재시도 횟수별 지연 시간 계산
      const result1 = retryManager.shouldRetry(jobName, 0, 1);
      const result2 = retryManager.shouldRetry(jobName, 1, 2);
      const result3 = retryManager.shouldRetry(jobName, 2, 3);

      // Then: 지수 백오프 적용
      expect(result1.nextRetryDelay).toBe(baseDelay * Math.pow(2, 0)); // 1000ms
      expect(result2.nextRetryDelay).toBe(baseDelay * Math.pow(2, 1)); // 2000ms
      expect(result3.nextRetryDelay).toBe(baseDelay * Math.pow(2, 2)); // 4000ms
    });

    it('should return exceededMaxErrors=true when error count exceeds limit', () => {
      // Given: 에러 카운트가 최대값 초과
      const jobName = 'test-job';
      const currentRetryCount = 1;
      const errorCount = 10; // maxErrorCount(9) 초과

      // When: 재시도 여부 결정
      const result = retryManager.shouldRetry(jobName, currentRetryCount, errorCount);

      // Then: 최대 에러 카운트 초과로 재시도 불가
      expect(result.shouldRetry).toBe(false);
      expect(result.exceededMaxErrors).toBe(true);
      expect(result.nextRetryDelay).toBe(0);
    });

    it('should use default maxErrorCount when not provided', () => {
      // Given: maxErrorCount가 없는 설정
      const managerWithoutMaxError = new RetryManager({
        maxAttempts: 3,
        baseDelay: 1000
      });
      const jobName = 'test-job';
      const errorCount = 9; // maxAttempts * 3

      // When: 재시도 여부 결정
      const result = managerWithoutMaxError.shouldRetry(jobName, 1, errorCount);

      // Then: 기본값(maxAttempts * 3) 사용
      expect(result.exceededMaxErrors).toBe(true);
    });
  });

  describe('resetErrorCount', () => {
    it('should reset error count for job', () => {
      // Given: 에러 카운트가 있는 작업
      const jobName = 'test-job';
      retryManager.incrementErrorCount(jobName);
      retryManager.incrementErrorCount(jobName);

      // When: 에러 카운트 리셋
      retryManager.resetErrorCount(jobName);

      // Then: 에러 카운트가 0이 됨
      expect(retryManager.getErrorCount(jobName)).toBe(0);
    });
  });

  describe('incrementErrorCount', () => {
    it('should increment error count', () => {
      // Given: 에러 카운트가 없는 작업
      const jobName = 'test-job';

      // When: 에러 카운트 증가
      const count1 = retryManager.incrementErrorCount(jobName);
      const count2 = retryManager.incrementErrorCount(jobName);

      // Then: 에러 카운트 증가
      expect(count1).toBe(1);
      expect(count2).toBe(2);
      expect(retryManager.getErrorCount(jobName)).toBe(2);
    });
  });

  describe('getErrorCount', () => {
    it('should return 0 for job with no errors', () => {
      // Given: 에러가 없는 작업
      const jobName = 'test-job';

      // When: 에러 카운트 조회
      const count = retryManager.getErrorCount(jobName);

      // Then: 0 반환
      expect(count).toBe(0);
    });

    it('should return current error count', () => {
      // Given: 에러 카운트가 있는 작업
      const jobName = 'test-job';
      retryManager.incrementErrorCount(jobName);
      retryManager.incrementErrorCount(jobName);

      // When: 에러 카운트 조회
      const count = retryManager.getErrorCount(jobName);

      // Then: 현재 에러 카운트 반환
      expect(count).toBe(2);
    });
  });

  describe('clearAllErrorCounts', () => {
    it('should clear all error counts', () => {
      // Given: 여러 작업의 에러 카운트
      retryManager.incrementErrorCount('job1');
      retryManager.incrementErrorCount('job2');
      retryManager.incrementErrorCount('job1');

      // When: 모든 에러 카운트 초기화
      retryManager.clearAllErrorCounts();

      // Then: 모든 에러 카운트가 0이 됨
      expect(retryManager.getErrorCount('job1')).toBe(0);
      expect(retryManager.getErrorCount('job2')).toBe(0);
    });
  });
});

