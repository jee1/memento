/**
 * 로깅 Rate Limiter
 * 
 * MCP 스펙 준수: 로그 전송 빈도를 제한하여 클라이언트에 과부하를 주지 않도록 함
 * 
 * 참조:
 * - MCP 스펙: https://spec.modelcontextprotocol.io/specification/server/#logging
 */

/**
 * Rate Limiter 설정
 */
export interface RateLimiterConfig {
  /**
   * 최대 로그 전송 빈도 (초당 로그 수)
   * 기본값: 10 (초당 10개 로그)
   */
  maxLogsPerSecond?: number;

  /**
   * 버스트 허용 크기 (한 번에 전송 가능한 로그 수)
   * 기본값: 20
   */
  burstSize?: number;
}

/**
 * 로깅 Rate Limiter 클래스
 * Token Bucket 알고리즘 사용
 */
export class LoggingRateLimiter {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per second
  private lastRefill: number;
  private droppedCount: number = 0;

  constructor(config: RateLimiterConfig = {}) {
    const maxLogsPerSecond = config.maxLogsPerSecond ?? 10;
    const burstSize = config.burstSize ?? 20;
    
    this.capacity = burstSize;
    this.refillRate = maxLogsPerSecond;
    this.tokens = burstSize;
    this.lastRefill = Date.now();
  }

  /**
   * 로그 전송 가능 여부 확인
   * @returns true면 전송 가능, false면 rate limit에 걸림
   */
  canSend(): boolean {
    this.refill();
    return this.tokens >= 1;
  }

  /**
   * 로그 전송 (토큰 소비)
   * @returns true면 전송 성공, false면 rate limit에 걸림
   */
  consume(): boolean {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    this.droppedCount++;
    return false;
  }

  /**
   * 토큰 리필
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;
    
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * 드롭된 로그 수 조회
   */
  getDroppedCount(): number {
    return this.droppedCount;
  }

  /**
   * 드롭된 로그 수 리셋
   */
  resetDroppedCount(): void {
    this.droppedCount = 0;
  }

  /**
   * 현재 토큰 수 조회
   */
  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }
}

/**
 * 전역 Rate Limiter 인스턴스
 * 환경 변수로 설정 가능:
 * - LOG_RATE_LIMIT_MAX_LOGS_PER_SECOND: 초당 최대 로그 수 (기본값: 10)
 * - LOG_RATE_LIMIT_BURST_SIZE: 버스트 크기 (기본값: 20)
 */
export const loggingRateLimiter = new LoggingRateLimiter({
  maxLogsPerSecond: process.env.LOG_RATE_LIMIT_MAX_LOGS_PER_SECOND
    ? parseInt(process.env.LOG_RATE_LIMIT_MAX_LOGS_PER_SECOND, 10)
    : 10,
  burstSize: process.env.LOG_RATE_LIMIT_BURST_SIZE
    ? parseInt(process.env.LOG_RATE_LIMIT_BURST_SIZE, 10)
    : 20
});

