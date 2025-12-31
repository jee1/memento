/**
 * 로깅 Rate Limiter 테스트
 * 
 * MCP 스펙 준수: 로그 전송 빈도 제한 검증
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LoggingRateLimiter } from '../logging-rate-limiter.js';

describe('로깅 Rate Limiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('초당 최대 로그 수 제한 검증', () => {
    // Given: 초당 2개 로그로 제한된 Rate Limiter
    const limiter = new LoggingRateLimiter({
      maxLogsPerSecond: 2,
      burstSize: 2
    });

    // When: 3개의 로그 전송 시도
    const result1 = limiter.consume();
    const result2 = limiter.consume();
    const result3 = limiter.consume();

    // Then: 처음 2개는 성공, 3번째는 실패
    expect(result1).toBe(true);
    expect(result2).toBe(true);
    expect(result3).toBe(false);
  });

  it('토큰 리필 검증', () => {
    // Given: 초당 1개 로그로 제한된 Rate Limiter
    const limiter = new LoggingRateLimiter({
      maxLogsPerSecond: 1,
      burstSize: 1
    });

    // When: 첫 번째 로그 전송
    const result1 = limiter.consume();
    expect(result1).toBe(true);

    // 두 번째 로그는 즉시 실패
    const result2 = limiter.consume();
    expect(result2).toBe(false);

    // 1초 후 토큰 리필
    vi.advanceTimersByTime(1000);
    const result3 = limiter.consume();
    expect(result3).toBe(true);
  });

  it('버스트 크기 검증', () => {
    // Given: 버스트 크기 5, 초당 1개 리필
    const limiter = new LoggingRateLimiter({
      maxLogsPerSecond: 1,
      burstSize: 5
    });

    // When: 5개의 로그 전송 시도
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(limiter.consume());
    }

    // Then: 모두 성공 (버스트 허용)
    expect(results.every(r => r === true)).toBe(true);

    // 6번째는 실패
    const result6 = limiter.consume();
    expect(result6).toBe(false);
  });

  it('드롭된 로그 수 추적', () => {
    // Given: 초당 1개 로그로 제한
    const limiter = new LoggingRateLimiter({
      maxLogsPerSecond: 1,
      burstSize: 1
    });

    // When: 여러 로그 전송 시도
    limiter.consume(); // 성공
    limiter.consume(); // 드롭
    limiter.consume(); // 드롭

    // Then: 드롭된 로그 수 확인
    expect(limiter.getDroppedCount()).toBe(2);
  });

  it('드롭된 로그 수 리셋', () => {
    // Given: Rate Limiter와 드롭된 로그
    const limiter = new LoggingRateLimiter({
      maxLogsPerSecond: 1,
      burstSize: 1
    });

    limiter.consume();
    limiter.consume(); // 드롭
    expect(limiter.getDroppedCount()).toBe(1);

    // When: 리셋
    limiter.resetDroppedCount();

    // Then: 드롭된 로그 수가 0으로 리셋
    expect(limiter.getDroppedCount()).toBe(0);
  });

  it('현재 사용 가능한 토큰 수 조회', () => {
    // Given: 버스트 크기 5
    const limiter = new LoggingRateLimiter({
      maxLogsPerSecond: 1,
      burstSize: 5
    });

    // When: 초기 상태
    expect(limiter.getAvailableTokens()).toBe(5);

    // 2개 소비
    limiter.consume();
    limiter.consume();
    expect(limiter.getAvailableTokens()).toBe(3);

    // 1초 후 리필
    vi.advanceTimersByTime(1000);
    expect(limiter.getAvailableTokens()).toBe(4); // 3 + 1 = 4 (최대 5)
  });
});

