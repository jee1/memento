import { afterEach, describe, expect, it, vi } from 'vitest';
import { TokenBucketRateLimiter } from '../token-bucket-rate-limiter.js';

describe('TokenBucketRateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows the initial burst and waits for refill', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new TokenBucketRateLimiter(1, 1);

    await expect(limiter.consume()).resolves.toBe(true);
    const second = limiter.consume();
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(second).resolves.toBe(true);
  });

  it('serializes concurrent consumers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new TokenBucketRateLimiter(1, 1);

    const first = limiter.consume();
    const second = limiter.consume();
    const third = limiter.consume();
    await expect(first).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(second).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(third).resolves.toBe(true);
  });
});
