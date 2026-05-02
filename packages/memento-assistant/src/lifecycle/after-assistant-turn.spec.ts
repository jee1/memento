import { describe, it, expect, vi } from 'vitest';
import { MementoAssistant } from '../assistant.js';
import { MockTransport } from '../transport/mock-transport.js';

describe('afterAssistantTurn — turn mode', () => {
  it('saves single working memory entry', async () => {
    const t = new MockTransport();
    const a = MementoAssistant.fromEnv({ transport: t, channel: 'tg', userTags: ['persona:asst'] }, {});
    await a.afterAssistantTurn({ userMessage: '내 생일 5/10', assistantReply: '기억해둘게요', conversationId: 'c1' });
    // fire-and-forget — flush 대기
    await vi.waitFor(() => expect(t.rememberCalls).toHaveLength(1));
    const call = t.rememberCalls[0];
    expect(call.type).toBe('working');
    expect(call.content).toContain('내 생일 5/10');
    expect(call.content).toContain('기억해둘게요');
    expect(call.tags).toEqual(expect.arrayContaining(['channel:tg', 'conv:c1', 'persona:asst']));
  });

  it("with policy.autoRemember='off' skips entirely", async () => {
    const t = new MockTransport();
    const a = MementoAssistant.fromEnv({ transport: t, policy: { autoRemember: 'off' } }, {});
    await a.afterAssistantTurn({ userMessage: 'u', assistantReply: 'a', conversationId: 'c1' });
    await new Promise(r => setTimeout(r, 50));
    expect(t.rememberCalls).toHaveLength(0);
  });

  it('does not throw even when transport throws', async () => {
    const t = new MockTransport();
    t.throwOnNextRemember(new Error('boom'));
    const a = MementoAssistant.fromEnv({ transport: t }, {});
    await expect(
      a.afterAssistantTurn({ userMessage: 'u', assistantReply: 'a', conversationId: 'c1' })
    ).resolves.toBeUndefined();
  });
});
