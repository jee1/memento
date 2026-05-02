type State = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOpts {
  failureThreshold: number;
  openMs: number;
}

export class CircuitBreaker {
  private state: State = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  constructor(private readonly opts: CircuitBreakerOpts) {}

  canPass(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open') {
      if (Date.now() - this.openedAt >= this.opts.openMs) {
        this.state = 'half-open';
        return true;
      }
      return false;
    }
    // half-open
    return true;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.consecutiveFailures++;
    if (this.state === 'half-open') {
      this.state = 'open';
      this.openedAt = Date.now();
      return;
    }
    if (this.consecutiveFailures >= this.opts.failureThreshold) {
      this.state = 'open';
      this.openedAt = Date.now();
    }
  }
}
