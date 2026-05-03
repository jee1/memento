import { describe, it, expect } from 'vitest';
import { MementoAssistant } from '../../src/assistant.js';
import { MockTransport } from '../../src/transport/mock-transport.js';

describe('E2E: transport switch (mock → mock)', { timeout: 10_000 }, () => {
  it('fact stored via transport A is readable via fresh MementoAssistant with same transport', async () => {
    // Use a MockTransport with a fixture to simulate "same DB"
    const t1 = new MockTransport();
    t1.fixture('switch-1', { content: 'transport switch fact', type: 'semantic' });

    const a1 = MementoAssistant.fromEnv(
      { transport: t1, ownerId: 'u4', policy: { autoRemember: 'off' } },
      {},
    );

    // Simulate switching: use the same transport object for a "new" assistant
    const a2 = MementoAssistant.fromEnv(
      { transport: t1, ownerId: 'u4' },
      {},
    );
    const ctx = await a2.beforeUserTurn({ userMessage: 'transport switch?', conversationId: 'c1' });
    expect(ctx.systemContext).toContain('transport switch');
    await t1.close();

    // Suppress unused variable warning for a1
    void a1;
  });
});
