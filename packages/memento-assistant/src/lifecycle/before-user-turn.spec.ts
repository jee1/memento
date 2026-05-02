import { describe, it, expect } from 'vitest';
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
