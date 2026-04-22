import type { IRetryManager, IRetryOptions } from '../../../shared/interfaces/retry-manager.interface.js';

type RetryConfig = {
  maxAttempts: number;
  baseDelay: number;
};

export class RelationRetryManager implements IRetryManager {
  constructor(private readonly config: RetryConfig) {}

  async retry<T>(fn: () => Promise<T>, options: IRetryOptions = {}): Promise<T> {
    const maxAttempts = options.maxAttempts ?? this.config.maxAttempts;
    const baseDelay = options.baseDelay ?? this.config.baseDelay;
    const shouldRetry = options.shouldRetry ?? (() => true);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (!shouldRetry(lastError) || attempt === maxAttempts - 1) {
          throw lastError;
        }

        const delay = baseDelay * Math.pow(2, attempt);
        options.onRetry?.(lastError, attempt + 1, delay);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError ?? new Error('Retry attempts exhausted');
  }
}
