import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRateLimitedLogger } from './logger.js';

describe('rate-limited logger', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('respects MEMENTO_ASSISTANT_LOG=warn (no info output)', () => {
    const sink = vi.fn();
    const log = createRateLimitedLogger({ level: 'warn', sink });
    log.info('x');
    expect(sink).not.toHaveBeenCalled();
    log.warn('first');
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it('rate-limits same warn to once per minute', () => {
    const sink = vi.fn();
    const log = createRateLimitedLogger({ level: 'warn', sink });
    log.warn('boom: timeout');
    log.warn('boom: timeout');
    log.warn('boom: timeout');
    expect(sink).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(61_000);
    log.warn('boom: timeout');
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it('different keys are independent', () => {
    const sink = vi.fn();
    const log = createRateLimitedLogger({ level: 'warn', sink });
    log.warn('a');
    log.warn('b');
    expect(sink).toHaveBeenCalledTimes(2);
  });
});
