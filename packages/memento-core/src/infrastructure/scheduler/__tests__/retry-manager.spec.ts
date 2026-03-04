/**
 * RetryManager 테스트
 * 
 * 외부 API 호출용 retry 메서드 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RetryManager, RetryConfig } from '../retry-manager.js';

describe('RetryManager', () => {
  describe('2.1.1 외부 API 호출용 retry 메서드', () => {
    let retryManager: RetryManager;

    beforeEach(() => {
      const config: RetryConfig = {
        maxAttempts: 3,
        baseDelay: 100,
        maxErrorCount: 10
      };
      retryManager = new RetryManager(config);
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('성공적인 함수 호출은 즉시 반환', async () => {
      // Given: 성공하는 함수
      const fn = vi.fn().mockResolvedValue('success');

      // When: retry 호출
      const result = await retryManager.retry(fn);

      // Then: 즉시 성공하고 재시도 없음
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('일시적 실패 후 성공 (재시도)', async () => {
      // Given: 처음 실패 후 성공하는 함수
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce('success');

      // When: retry 호출
      const promise = retryManager.retry(fn);
      
      // 지수 백오프 대기
      await vi.advanceTimersByTimeAsync(100);
      
      const result = await promise;

      // Then: 재시도 후 성공
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('최대 재시도 횟수 초과 시 마지막 에러 throw', async () => {
      // Given: 항상 실패하는 함수
      const error = new Error('Persistent error');
      const fn = vi.fn().mockRejectedValue(error);

      // When: retry 호출 (최대 3회 시도)
      // promise를 즉시 처리하여 unhandled rejection 방지
      const promise = retryManager.retry(fn).catch(err => err);
      
      // 모든 재시도 대기
      await vi.advanceTimersByTimeAsync(1000);
      // promise 완료 대기
      await vi.runAllTimersAsync();

      // Then: 마지막 에러 throw
      const result = await promise;
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe('Persistent error');
      expect(fn).toHaveBeenCalledTimes(3); // 초기 시도 + 2회 재시도
    });

    it('지수 백오프 적용 확인', async () => {
      // Given: 처음 2회 실패 후 성공하는 함수
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockResolvedValueOnce('success');

      const callTimes: number[] = [];
      const originalFn = fn;
      fn.mockImplementation(async () => {
        callTimes.push(Date.now());
        return originalFn();
      });

      // When: retry 호출
      const promise = retryManager.retry(fn);
      
      // 첫 번째 재시도 대기 (100ms)
      await vi.advanceTimersByTimeAsync(100);
      
      // 두 번째 재시도 대기 (200ms)
      await vi.advanceTimersByTimeAsync(200);
      
      await promise;

      // Then: 지수 백오프가 적용되었는지 확인
      expect(fn).toHaveBeenCalledTimes(3);
      if (callTimes.length >= 2) {
        const delay1 = callTimes[1] - callTimes[0];
        const delay2 = callTimes[2] - callTimes[1];
        // 지수 백오프: 100ms, 200ms
        expect(delay1).toBeGreaterThanOrEqual(100);
        expect(delay2).toBeGreaterThanOrEqual(200);
      }
    });

    it('재시도 조건 함수로 특정 에러만 재시도', async () => {
      // Given: 특정 에러만 재시도하는 조건
      const retryableError = new Error('Network error');
      const nonRetryableError = new Error('Invalid input');
      
      const fn = vi.fn()
        .mockRejectedValueOnce(retryableError)
        .mockRejectedValueOnce(nonRetryableError);

      // When: 재시도 조건 함수 제공
      const shouldRetry = (error: Error) => error.message === 'Network error';
      // promise를 즉시 처리하여 unhandled rejection 방지
      const promise = retryManager.retry(fn, { shouldRetry }).catch(err => err);
      
      // 모든 타이머 실행 및 promise 완료 대기
      await vi.advanceTimersByTimeAsync(100);
      await vi.runAllTimersAsync();

      // Then: 재시도 가능한 에러만 재시도하고, 재시도 불가능한 에러는 즉시 throw
      const result = await promise;
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe('Invalid input');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('재시도 조건 함수가 false를 반환하면 즉시 throw', async () => {
      // Given: 재시도하지 않는 조건
      const error = new Error('Non-retryable error');
      const fn = vi.fn().mockRejectedValue(error);

      // When: 재시도 조건이 항상 false
      const shouldRetry = () => false;
      const promise = retryManager.retry(fn, { shouldRetry });

      // Then: 즉시 throw (재시도 없음)
      await expect(promise).rejects.toThrow('Non-retryable error');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('onRetry 콜백 호출 확인', async () => {
      // Given: 실패 후 성공하는 함수
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockResolvedValueOnce('success');

      const onRetry = vi.fn();

      // When: retry 호출
      const promise = retryManager.retry(fn, { onRetry });
      
      await vi.advanceTimersByTimeAsync(100);
      
      await promise;

      // Then: onRetry 콜백이 호출됨
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(
        expect.any(Error),
        1, // attempt number
        expect.any(Number) // delay
      );
    });

    it('커스텀 최대 재시도 횟수 적용', async () => {
      // Given: 항상 실패하는 함수
      const fn = vi.fn().mockRejectedValue(new Error('Error'));

      // When: 커스텀 최대 재시도 횟수 2회
      // promise를 즉시 처리하여 unhandled rejection 방지
      const promise = retryManager.retry(fn, { maxAttempts: 2 }).catch(err => err);
      
      // 모든 타이머 실행 및 promise 완료 대기
      await vi.advanceTimersByTimeAsync(1000);
      await vi.runAllTimersAsync();

      // Then: 2회만 시도
      const result = await promise;
      expect(result).toBeInstanceOf(Error);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('커스텀 baseDelay 적용', async () => {
      // Given: 처음 실패 후 성공하는 함수
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('Error'))
        .mockResolvedValueOnce('success');

      const callTimes: number[] = [];
      const originalFn = fn;
      fn.mockImplementation(async () => {
        callTimes.push(Date.now());
        return originalFn();
      });

      // When: 커스텀 baseDelay 50ms
      const promise = retryManager.retry(fn, { baseDelay: 50 });
      
      await vi.advanceTimersByTimeAsync(50);
      
      await promise;

      // Then: 커스텀 delay가 적용됨
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
});
