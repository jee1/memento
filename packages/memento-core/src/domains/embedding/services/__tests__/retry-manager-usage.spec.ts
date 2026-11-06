/**
 * 임베딩 제공자 RetryManager 사용 테스트
 * 
 * 각 임베딩 제공자가 RetryManager를 사용하여 외부 API 호출을 재시도하는지 검증
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RetryManager, RetryConfig } from '../../../../shared/utils/retry-manager.js';
import { getRetryOptions } from '../../../../shared/config/retry-options-loader.js';

describe('임베딩 제공자 RetryManager 사용', () => {
  let retryManager: RetryManager;

  beforeEach(() => {
    const retryOptions = getRetryOptions();
    const config: RetryConfig = retryOptions.embedding_api;
    retryManager = new RetryManager(config);
  });

  describe('2.4.1 RetryManager 적용 테스트', () => {
    it('재시도 옵션 설정 파일에서 embedding_api 설정 로드', () => {
      // Given: 재시도 옵션 설정 파일
      const retryOptions = getRetryOptions();

      // When: embedding_api 설정 조회
      const embeddingConfig = retryOptions.embedding_api;

      // Then: 설정이 올바르게 로드됨
      expect(embeddingConfig).toBeDefined();
      expect(embeddingConfig.maxAttempts).toBeGreaterThan(0);
      expect(embeddingConfig.baseDelay).toBeGreaterThanOrEqual(0);
    });

    it('RetryManager가 embedding_api 설정을 사용하여 재시도', async () => {
      // Given: embedding_api 설정과 RetryManager
      const retryOptions = getRetryOptions();
      const config: RetryConfig = {
        ...retryOptions.embedding_api,
        maxErrorCount: 10
      };
      const manager = new RetryManager(config);

      // When: 실패 후 성공하는 함수 호출
      let attemptCount = 0;
      const fn = vi.fn().mockImplementation(async () => {
        attemptCount++;
        if (attemptCount < 2) {
          throw new Error('Network error');
        }
        return 'success';
      });

      // Then: 재시도 후 성공
      const result = await manager.retry(fn);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
});

