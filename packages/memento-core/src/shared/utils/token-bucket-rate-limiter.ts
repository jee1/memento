const SECOND_MS = 1_000;

/** Async token bucket that serializes consumers while they wait for refill. */
export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private lock: Promise<void> = Promise.resolve();

  constructor(
    private readonly capacity: number = 1,
    private readonly refillRate: number = 1,
  ) {
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

        const waitTime = ((1 - this.tokens) / this.refillRate) * SECOND_MS;
        await new Promise((waitResolve) => setTimeout(waitResolve, waitTime));
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
    const elapsed = (now - this.lastRefill) / SECOND_MS;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}
