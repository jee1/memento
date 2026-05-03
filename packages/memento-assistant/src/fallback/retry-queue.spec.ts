import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RetryQueue } from './retry-queue.js';

describe('RetryQueue', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('runs successful job once and removes it', async () => {
    const q = new RetryQueue({ maxAttempts: 3, capacity: 100, backoffMs: [1000, 2000, 4000] });
    const fn = vi.fn().mockResolvedValue(undefined);
    q.enqueue(fn);
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(q.size()).toBe(0);
  });

  it('retries on failure with backoff', async () => {
    const q = new RetryQueue({ maxAttempts: 3, capacity: 100, backoffMs: [1000, 2000, 4000] });
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('1'))
      .mockRejectedValueOnce(new Error('2'))
      .mockResolvedValueOnce(undefined);
    q.enqueue(fn);
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(q.size()).toBe(0);
  });

  it('drops job after maxAttempts and emits drop event', async () => {
    const drops: string[] = [];
    const q = new RetryQueue({ maxAttempts: 3, capacity: 100, backoffMs: [10, 20, 40], onDrop: () => drops.push('x') });
    q.enqueue(vi.fn().mockRejectedValue(new Error('always')));
    await vi.advanceTimersByTimeAsync(100);
    expect(drops).toHaveLength(1);
    expect(q.size()).toBe(0);
  });

  it('drops oldest when capacity exceeded', () => {
    const q = new RetryQueue({ maxAttempts: 3, capacity: 2, backoffMs: [10, 20, 40] });
    q.enqueue(vi.fn().mockResolvedValue(undefined));
    q.enqueue(vi.fn().mockResolvedValue(undefined));
    q.enqueue(vi.fn().mockResolvedValue(undefined));
    expect(q.size()).toBeLessThanOrEqual(2);
  });

  it('dropped job does not execute after capacity overflow', async () => {
    const q = new RetryQueue({ maxAttempts: 3, capacity: 1, backoffMs: [100, 200, 400] });
    const first = vi.fn().mockResolvedValue(undefined);
    const second = vi.fn().mockResolvedValue(undefined);
    q.enqueue(first);       // occupies capacity slot
    q.enqueue(second);      // capacity exceeded → first is dropped
    await vi.advanceTimersByTimeAsync(0);
    expect(first).not.toHaveBeenCalled();  // dropped job should NOT run
    expect(second).toHaveBeenCalledTimes(1);
  });
});
