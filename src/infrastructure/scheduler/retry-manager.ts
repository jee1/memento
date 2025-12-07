/**
 * 재시도 관리 모듈
 * 배치 작업의 재시도 로직, 지수 백오프, 최대 재시도 횟수 관리
 */

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
 * 재시도 관리자
 * 
 * 역할:
 * - 재시도 횟수 추적
 * - 지수 백오프 계산
 * - 최대 에러 카운트 기반 중단 결정
 */
export class RetryManager {
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
}

