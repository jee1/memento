import { TIME } from '../../../../shared/constants/relation-constants.js';

/**
 * 토큰 버킷 Rate Limiter
 *
 * 경쟁 조건을 방지하기 위해 락 메커니즘을 사용합니다.
 */
export class TokenBucketRateLimiter {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillRate: number;
  private lastRefill: number;
  private lock: Promise<void> = Promise.resolve();

  constructor(capacity: number = 1, refillRate: number = 1) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  async consume(): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      this.lock = this.lock.then(async () => {
        this.refill();

        if (this.tokens >= 1) {
          this.tokens -= 1;
          resolve(true);
          return;
        }

        const waitTime = ((1 - this.tokens) / this.refillRate) * TIME.SECOND_MS;
        await new Promise((r) => setTimeout(r, waitTime));

        this.refill();

        if (this.tokens >= 1) {
          this.tokens -= 1;
          resolve(true);
        } else {
          resolve(false);
        }
      });
    });
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / TIME.SECOND_MS;
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}
