export interface RetryQueueOpts {
  maxAttempts: number;
  capacity: number;
  backoffMs: number[];   // length = maxAttempts - 1
  onDrop?: (reason: 'maxAttempts' | 'capacity', err?: Error) => void;
}

interface Job {
  fn: () => Promise<void>;
  attempts: number;
}

export class RetryQueue {
  private queue: Job[] = [];

  constructor(private readonly opts: RetryQueueOpts) {}

  enqueue(fn: () => Promise<void>): void {
    if (this.queue.length >= this.opts.capacity) {
      const dropped = this.queue.shift();
      if (dropped) {
        this.opts.onDrop?.('capacity');
      }
    }
    const job: Job = { fn, attempts: 0 };
    this.queue.push(job);
    setTimeout(() => this.run(job), 0);
  }

  size(): number {
    return this.queue.length;
  }

  private run(job: Job): void {
    job.attempts++;
    job.fn().then(
      () => {
        this.remove(job);
      },
      (err: Error) => {
        if (job.attempts >= this.opts.maxAttempts) {
          this.remove(job);
          this.opts.onDrop?.('maxAttempts', err);
        } else {
          const delay = this.opts.backoffMs[job.attempts - 1] ?? 0;
          setTimeout(() => this.run(job), delay);
        }
      },
    );
  }

  private remove(job: Job): void {
    const idx = this.queue.indexOf(job);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
    }
  }
}
