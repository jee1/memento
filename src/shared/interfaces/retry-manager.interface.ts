/**
 * 재시도 관리자 인터페이스 (DIP)
 * 도메인은 이 인터페이스만 참조하고, 인프라 구현체를 주입받음.
 */

export interface IRetryOptions {
  maxAttempts?: number;
  baseDelay?: number;
  shouldRetry?: (error: Error) => boolean;
  onRetry?: (error: Error, attempt: number, delay: number) => void;
}

export interface IRetryManager {
  retry<T>(fn: () => Promise<T>, options?: IRetryOptions): Promise<T>;
}
