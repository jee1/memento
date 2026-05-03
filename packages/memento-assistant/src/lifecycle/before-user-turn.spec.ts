import { describe, it, expect, vi } from 'vitest';
import { MementoAssistant } from '../assistant.js';
import { MockTransport } from '../transport/mock-transport.js';

describe('beforeUserTurn — always mode', () => {
  it('calls transport.recall and formats systemContext with <memento> fence', async () => {
    const t = new MockTransport();
    t.fixture('m:1', { content: '저번에 5/10이 생일이라 했음', type: 'semantic' });
    t.fixture('m:2', { content: '회사: A', type: 'semantic' });
    const a = MementoAssistant.fromEnv({ transport: t, ownerId: 'u' }, {});
    const r = await a.beforeUserTurn({ userMessage: '내 생일 언제?', conversationId: 'c1' });
    expect(r.degraded).toBe(false);
    expect(r.systemContext).toMatch(/^<memento>/);
    expect(r.systemContext).toMatch(/<\/memento>$/);
    expect(r.systemContext).toContain('5/10');
    expect(r.references).toHaveLength(2);
    expect(t.recallCalls).toHaveLength(1);
    expect(t.recallCalls[0].query).toBe('내 생일 언제?');
  });

  it('passes ownerId via filters', async () => {
    const t = new MockTransport();
    const a = MementoAssistant.fromEnv({ transport: t, ownerId: 'u' }, {});
    await a.beforeUserTurn({ userMessage: 'q', conversationId: 'c1' });
    expect(t.recallCalls[0].filters?.ownerId).toBe('u');
  });

  it('honors recallLimit policy', async () => {
    const t = new MockTransport();
    const a = MementoAssistant.fromEnv({ transport: t, policy: { recallLimit: 3 } }, {});
    await a.beforeUserTurn({ userMessage: 'q', conversationId: 'c1' });
    expect(t.recallCalls[0].limit).toBe(3);
  });
});

describe('beforeUserTurn — off mode', () => {
  it('skips transport call entirely', async () => {
    const t = new MockTransport();
    const a = MementoAssistant.fromEnv({ transport: t, policy: { autoRecall: 'off' } }, {});
    const r = await a.beforeUserTurn({ userMessage: 'anything?', conversationId: 'c1' });
    expect(t.recallCalls).toHaveLength(0);
    expect(r.systemContext).toBe('');
    expect(r.degraded).toBe(false);
  });
});

describe('beforeUserTurn — heuristic mode', () => {
  it('does not recall on short greeting', async () => {
    const t = new MockTransport();
    const a = MementoAssistant.fromEnv({ transport: t, policy: { autoRecall: 'heuristic' } }, {});
    await a.beforeUserTurn({ userMessage: 'hi', conversationId: 'c1' });
    expect(t.recallCalls).toHaveLength(0);
  });

  it('recalls on question', async () => {
    const t = new MockTransport();
    const a = MementoAssistant.fromEnv({ transport: t, policy: { autoRecall: 'heuristic' } }, {});
    await a.beforeUserTurn({ userMessage: 'where did we go last time?', conversationId: 'c1' });
    expect(t.recallCalls).toHaveLength(1);
  });
});

describe('beforeUserTurn — crossChannelRecall', () => {
  it("'on' (default) sends no channel tag filter", async () => {
    const t = new MockTransport();
    const a = MementoAssistant.fromEnv({ transport: t, channel: 'tg', ownerId: 'u' }, {});
    await a.beforeUserTurn({ userMessage: 'q', conversationId: 'c1' });
    expect(t.recallCalls[0].filters?.tags).toBeUndefined();
  });

  it("'off' includes channel:* tag filter", async () => {
    const t = new MockTransport();
    const a = MementoAssistant.fromEnv(
      { transport: t, channel: 'discord', ownerId: 'u', policy: { crossChannelRecall: 'off' } },
      {},
    );
    await a.beforeUserTurn({ userMessage: 'q', conversationId: 'c1' });
    expect(t.recallCalls[0].filters?.tags).toContain('channel:discord');
  });

  it("'sameContext' WARNs once and behaves like 'on'", async () => {
    const t = new MockTransport();
    const a = MementoAssistant.fromEnv(
      { transport: t, channel: 'tg', policy: { crossChannelRecall: 'sameContext' } },
      { MEMENTO_ASSISTANT_LOG: 'warn' },
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await a.beforeUserTurn({ userMessage: 'q', conversationId: 'c1' });
    await a.beforeUserTurn({ userMessage: 'q2', conversationId: 'c1' });
    const sameContextWarns = spy.mock.calls.flat().join(' ').match(/sameContext/g) ?? [];
    expect(sameContextWarns.length).toBe(1);  // rate-limited
    expect(t.recallCalls[0].filters?.tags).toBeUndefined();
    spy.mockRestore();
  });
});

describe('beforeUserTurn — degraded mode', () => {
  it('returns degraded=true when transport throws', async () => {
    const t = new MockTransport();
    t.throwOnNextRecall(new Error('network down'));
    const a = MementoAssistant.fromEnv({ transport: t }, {});
    const r = await a.beforeUserTurn({ userMessage: 'q', conversationId: 'c1' });
    expect(r.degraded).toBe(true);
    expect(r.systemContext).toBe('');
    expect(r.references).toEqual([]);
  });

  it('returns degraded=true on timeout', async () => {
    vi.useFakeTimers();
    try {
      class SlowTransport extends MockTransport {
        async recall(): Promise<any> { return new Promise<any>(() => {}); }  // never resolves
      }
      const t = new SlowTransport();
      const a = MementoAssistant.fromEnv({ transport: t, policy: { recallTimeoutMs: 500 } }, {});
      const p = a.beforeUserTurn({ userMessage: 'q', conversationId: 'c1' });
      await vi.advanceTimersByTimeAsync(600);
      const r = await p;
      expect(r.degraded).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('opens circuit breaker after 5 consecutive failures and short-circuits next call', async () => {
    const t = new MockTransport();
    const a = MementoAssistant.fromEnv({ transport: t }, {});
    for (let i = 0; i < 5; i++) {
      t.throwOnNextRecall(new Error('boom'));
      await a.beforeUserTurn({ userMessage: 'q', conversationId: 'c1' });
    }
    // 6th call: transport should NOT be called
    const beforeCount = t.recallCalls.length;
    const r = await a.beforeUserTurn({ userMessage: 'q', conversationId: 'c1' });
    expect(t.recallCalls.length).toBe(beforeCount);  // short-circuit
    expect(r.degraded).toBe(true);
  });
});
