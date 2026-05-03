// packages/memento-assistant/src/transport/mock-transport.ts
import type { Transport, RecallResult, RememberParams, RememberResult } from './transport.js';

export class MockTransport implements Transport {
  rememberCalls: RememberParams[] = [];
  recallCalls: { query: string; filters?: any; limit?: number }[] = [];
  closed = false;
  private fixtures = new Map<string, { content: string; type: string; importance?: number; score?: number }>();
  private nextRecallError: Error | null = null;
  private nextRememberError: Error | null = null;

  fixture(id: string, item: { content: string; type: string; importance?: number; score?: number }) {
    this.fixtures.set(id, item);
  }

  throwOnNextRecall(err: Error) { this.nextRecallError = err; }
  throwOnNextRemember(err: Error) { this.nextRememberError = err; }

  async recall(query: string, filters?: any, limit?: number): Promise<RecallResult> {
    this.recallCalls.push({ query, filters, limit });
    if (this.nextRecallError) {
      const e = this.nextRecallError; this.nextRecallError = null; throw e;
    }
    const items = [...this.fixtures.entries()].map(([id, v]) => ({ id, ...v }));
    return { items: items.slice(0, limit ?? items.length) };
  }

  async remember(params: RememberParams): Promise<RememberResult> {
    this.rememberCalls.push(params);
    if (this.nextRememberError) {
      const e = this.nextRememberError; this.nextRememberError = null; throw e;
    }
    return { id: `mock:${this.rememberCalls.length}` };
  }

  /** Post-close calls still succeed — MockTransport does not enforce rejection after close. Production transports may differ. */
  async close() { this.closed = true; }
}
