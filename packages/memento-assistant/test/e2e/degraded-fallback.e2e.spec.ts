import { describe, it, expect } from 'vitest';
import { MementoAssistant } from '../../src/assistant.js';
import { HttpTransport } from '../../src/transport/http-transport.js';

describe('E2E: degraded fallback', { timeout: 10_000 }, () => {
  it('beforeUserTurn returns degraded when server is unreachable', async () => {
    const t = new HttpTransport({ baseUrl: 'http://127.0.0.1:19999', token: 'x' });
    const a = MementoAssistant.fromEnv({ transport: t, policy: { recallTimeoutMs: 500 } }, {});
    const r = await a.beforeUserTurn({ userMessage: 'test', conversationId: 'c1' });
    expect(r.degraded).toBe(true);
    expect(r.systemContext).toBe('');
    await t.close();
  });

  it('afterAssistantTurn does not throw when server is unreachable', async () => {
    const t = new HttpTransport({ baseUrl: 'http://127.0.0.1:19999', token: 'x' });
    const a = MementoAssistant.fromEnv({ transport: t }, {});
    await expect(
      a.afterAssistantTurn({ userMessage: 'u', assistantReply: 'a', conversationId: 'c1' })
    ).resolves.toBeUndefined();
    await t.close();
  });
});
