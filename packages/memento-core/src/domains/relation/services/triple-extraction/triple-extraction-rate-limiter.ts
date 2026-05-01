/**
 * 토큰 버킷 Rate Limiter — LLM 호출 빈도 제한
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

        const waitTime = ((1 - this.tokens) / this.refillRate) * 1000;
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
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}
