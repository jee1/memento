// packages/memento-assistant/src/transport/mock-transport.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { MockTransport } from './mock-transport.js';

describe('MockTransport', () => {
  let t: MockTransport;
  beforeEach(() => { t = new MockTransport(); });

  it('records remember calls', async () => {
    await t.remember({ content: 'hello', type: 'working' });
    expect(t.rememberCalls).toHaveLength(1);
    expect(t.rememberCalls[0].content).toBe('hello');
  });

  it('returns recall fixtures', async () => {
    t.fixture('memory:1', { content: 'hello', type: 'semantic' });
    t.fixture('memory:2', { content: 'world', type: 'episodic' });
    const r = await t.recall('hello', { tags: [] }, 5);
    expect(r.items).toHaveLength(2);
  });

  it('throwOnNext recall makes one call reject', async () => {
    t.throwOnNextRecall(new Error('boom'));
    await expect(t.recall('x', undefined, 1)).rejects.toThrow('boom');
    // next call is normal
    const r = await t.recall('x', undefined, 1);
    expect(r.items).toEqual([]);
  });

  it('close is idempotent', async () => {
    await t.close();
    await t.close();
    expect(t.closed).toBe(true);
  });
});
