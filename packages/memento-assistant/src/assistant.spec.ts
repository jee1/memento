import { describe, it, expect } from 'vitest';
import { MementoAssistant } from './assistant.js';
import { MockTransport } from './transport/mock-transport.js';

describe('MementoAssistant constructor', () => {
  it('uses defaults when no options', () => {
    const a = MementoAssistant.fromEnv({ transport: new MockTransport() }, {});
    expect(a.policy.autoRecall).toBe('always');
    expect(a.policy.autoRemember).toBe('turn');
    expect(a.policy.crossChannelRecall).toBe('on');
    expect(a.policy.tokenBudget).toBe(1200);
    expect(a.policy.recallLimit).toBe(8);
    expect(a.policy.recallTimeoutMs).toBe(1500);
    expect(a.policy.degradeOnError).toBe(true);
  });

  it('explicit options override env defaults', () => {
    const a = MementoAssistant.fromEnv(
      { transport: new MockTransport(), ownerId: 'u', channel: 'tg', policy: { autoRecall: 'off' } },
      { MEMENTO_OWNER_ID: 'env-u', MEMENTO_CHANNEL: 'discord' }
    );
    expect(a.ownerId).toBe('u');
    expect(a.channel).toBe('tg');
    expect(a.policy.autoRecall).toBe('off');
  });

  it('falls back to env when options missing', () => {
    const a = MementoAssistant.fromEnv(
      { transport: new MockTransport() },
      { MEMENTO_OWNER_ID: 'env-u', MEMENTO_CHANNEL: 'discord' }
    );
    expect(a.ownerId).toBe('env-u');
    expect(a.channel).toBe('discord');
  });
});
