/**
 * 재시도 관리 모듈
 * 
 * 배치 작업과 외부 API 호출 모두를 위한 통합 재시도 전략 제공
 * 
 * 주요 기능:
 * - 지수 백오프 (Exponential Backoff)
 * - 최대 재시도 횟수 제한
 * - 재시도 조건 커스터마이징
 * - 재시도 콜백 지원
 * 
 * 사용 예시:
 * 
 * 1. 배치 작업용 (기존 방식):
 * ```typescript
 * const retryManager = new RetryManager({
 *   maxAttempts: 3,
 *   baseDelay: 1000,
 *   maxErrorCount: 10
 * });
 * 
 * const result = retryManager.shouldRetry('job-name', retryCount, errorCount);
 * if (result.shouldRetry) {
 *   await new Promise(resolve => setTimeout(resolve, result.nextRetryDelay));
 *   // 재시도 로직
 * }
 * ```
 * 
 * 2. 외부 API 호출용 (새로운 방식):
 * ```typescript
 * const result = await retryManager.retry(
 *   () => fetch('https://api.example.com/data'),
 *   {
 *     maxAttempts: 3,
 *     baseDelay: 100,
 *     shouldRetry: (error) => error.message.includes('Network'),
 *     onRetry: (error, attempt, delay) => {
 *       logger.warn('API 호출 재시도', { attempt, delay, error: error.message });
 *     }
 *   }
 * );
 * ```
 * 
 * 재시도 전략:
 * - 지수 백오프: baseDelay * 2^attempt (예: 100ms, 200ms, 400ms, ...)
 * - 기본 재시도 조건: 모든 에러에 대해 재시도 (shouldRetry 옵션으로 커스터마이징 가능)
 * - 최대 재시도 횟수: 기본값은 RetryConfig의 maxAttempts, 옵션으로 오버라이드 가능
 */

import type { IRetryManager, IRetryOptions } from '../../shared/interfaces/retry-manager.interface.js';

export interface RetryConfig {
  maxAttempts: number; // 최대 재시도 횟수
  baseDelay: number; // 기본 지연 시간 (밀리초)
  maxErrorCount?: number; // 최대 에러 카운트 (무한 재시도 방지)
}

export interface RetryResult {
  shouldRetry: boolean;
  retryCount: number;
  nextRetryDelay: number;
  exceededMaxErrors: boolean;
}

/**
 * 외부 API 호출용 재시도 옵션
 */
export interface RetryOptions {
  /**
   * 최대 재시도 횟수 (기본값: RetryConfig의 maxAttempts)
   */
  maxAttempts?: number;

  /**
   * 기본 지연 시간 (밀리초, 기본값: RetryConfig의 baseDelay)
   */
  baseDelay?: number;

  /**
   * 재시도 조건 함수
   * @param error 발생한 에러
   * @returns true면 재시도, false면 즉시 throw
   */
  shouldRetry?: (error: Error) => boolean;

  /**
   * 재시도 시 호출되는 콜백
   * @param error 발생한 에러
   * @param attempt 현재 시도 횟수 (1부터 시작)
   * @param delay 다음 재시도까지의 지연 시간 (밀리초)
   */
  onRetry?: (error: Error, attempt: number, delay: number) => void;
}

/**
 * 재시도 관리자
 * 
 * 역할:
 * - 재시도 횟수 추적
 * - 지수 백오프 계산
 * - 최대 에러 카운트 기반 중단 결정
 */
export class RetryManager implements IRetryManager {
  private config: RetryConfig;
  private errorCounts: Map<string, number> = new Map();

  constructor(config: RetryConfig) {
    this.config = config;
  }

  /**
   * 재시도 여부 결정
   * 
   * @param jobName 작업 이름
   * @param currentRetryCount 현재 재시도 횟수
   * @param errorCount 현재 에러 카운트
   * @returns 재시도 결과
   */
  shouldRetry(jobName: string, currentRetryCount: number, errorCount: number): RetryResult {
    // 에러 카운트 업데이트
    this.errorCounts.set(jobName, errorCount);

    // 최대 에러 카운트 체크 (무한 재시도 방지)
    const maxErrorCount = this.config.maxErrorCount ?? (this.config.maxAttempts * 3);
    const exceededMaxErrors = errorCount >= maxErrorCount;

    if (exceededMaxErrors) {
      return {
        shouldRetry: false,
        retryCount: currentRetryCount,
        nextRetryDelay: 0,
        exceededMaxErrors: true
      };
    }

    // 재시도 횟수 체크
    const shouldRetry = currentRetryCount < this.config.maxAttempts;
    const nextRetryCount = currentRetryCount + 1;

    // 지수 백오프 계산
    const nextRetryDelay = shouldRetry 
      ? this.config.baseDelay * Math.pow(2, currentRetryCount)
      : 0;

    return {
      shouldRetry,
      retryCount: nextRetryCount,
      nextRetryDelay,
      exceededMaxErrors: false
    };
  }

  /**
   * 작업 성공 시 에러 카운트 리셋
   * 
   * @param jobName 작업 이름
   */
  resetErrorCount(jobName: string): void {
    this.errorCounts.set(jobName, 0);
  }

  /**
   * 에러 카운트 증가
   * 
   * @param jobName 작업 이름
   * @returns 새로운 에러 카운트
   */
  incrementErrorCount(jobName: string): number {
    const current = this.errorCounts.get(jobName) || 0;
    const newCount = current + 1;
    this.errorCounts.set(jobName, newCount);
    return newCount;
  }

  /**
   * 특정 작업의 에러 카운트 조회
   * 
   * @param jobName 작업 이름
   * @returns 에러 카운트
   */
  getErrorCount(jobName: string): number {
    return this.errorCounts.get(jobName) || 0;
  }

  /**
   * 모든 에러 카운트 초기화
   */
  clearAllErrorCounts(): void {
    this.errorCounts.clear();
  }

  /**
   * 외부 API 호출용 재시도 메서드
   * 
   * @param fn 재시도할 비동기 함수
   * @param options 재시도 옵션
   * @returns 함수 실행 결과
   * @throws 마지막 시도에서 발생한 에러
   * 
   * @example
   * ```typescript
   * import { logger } from '../../shared/utils/logger.js';
   * 
   * const result = await retryManager.retry(
   *   () => fetch('https://api.example.com/data'),
   *   {
   *     maxAttempts: 3,
   *     baseDelay: 100,
   *     shouldRetry: (error) => error.message.includes('Network'),
   *     onRetry: (error, attempt, delay) => {
   *       // logger는 자동으로 PII 마스킹을 적용합니다
   *       logger.warn('API 호출 재시도', { attempt, delay, error: error.message });
   *     }
   *   }
   * );
   * ```
   */
  async retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
    const maxAttempts = options.maxAttempts ?? this.config.maxAttempts;
    const baseDelay = options.baseDelay ?? this.config.baseDelay;
    const shouldRetry = options.shouldRetry ?? (() => true); // 기본값: 항상 재시도
    const onRetry = options.onRetry;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const result = await fn();
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // 재시도 조건 확인
        if (!shouldRetry(lastError)) {
          throw lastError;
        }

        // 마지막 시도인 경우 에러 throw
        if (attempt === maxAttempts - 1) {
          throw lastError;
        }

        // 지수 백오프 계산
        const delay = baseDelay * Math.pow(2, attempt);

        // onRetry 콜백 호출
        if (onRetry) {
          onRetry(lastError, attempt + 1, delay);
        }

        // 지연 후 재시도
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // 이 코드는 실행되지 않아야 하지만 TypeScript를 위해 필요
    if (lastError) {
      throw lastError;
    }
    throw new Error('Unexpected error in retry method');
  }
}

