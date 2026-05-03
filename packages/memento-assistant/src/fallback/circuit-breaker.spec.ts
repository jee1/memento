import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker } from './circuit-breaker.js';

describe('CircuitBreaker', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('starts closed and allows calls', () => {
    const cb = new CircuitBreaker({ failureThreshold: 5, openMs: 30_000 });
    expect(cb.canPass()).toBe(true);
  });

  it('opens after N consecutive failures', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, openMs: 30_000 });
    cb.recordFailure(); cb.recordFailure(); cb.recordFailure();
    expect(cb.canPass()).toBe(false);
  });

  it('one success resets counter while closed', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, openMs: 30_000 });
    cb.recordFailure(); cb.recordFailure();
    cb.recordSuccess();
    cb.recordFailure(); cb.recordFailure();
    expect(cb.canPass()).toBe(true);  // only 2 failures after reset
  });

  it('after openMs, allows half-open probe', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, openMs: 30_000 });
    cb.recordFailure();
    expect(cb.canPass()).toBe(false);
    vi.advanceTimersByTime(31_000);
    expect(cb.canPass()).toBe(true);  // half-open probe
  });

  it('half-open success → closed; failure → open again', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, openMs: 30_000 });
    cb.recordFailure();
    vi.advanceTimersByTime(31_000);
    expect(cb.canPass()).toBe(true);
    cb.recordFailure();  // probe failed
    expect(cb.canPass()).toBe(false);
  });
});
