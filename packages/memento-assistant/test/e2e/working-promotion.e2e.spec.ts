import { describe, it, expect, vi } from 'vitest';
import { MementoAssistant } from '../../src/assistant.js';
import { MockTransport } from '../../src/transport/mock-transport.js';

// SDK 책임은 '입력 정확성': afterAssistantTurn이 5턴에 걸쳐 working 메모리를
// 올바른 type/tags로 transport에 전달하는지 검증.
// 실제 sleep-consolidation 트리거는 SDK 범위 밖이므로 MockTransport로 검증한다.
describe('E2E: working memory input accuracy', () => {
  it('5 turns → 5 working entries with correct type and tags', async () => {
    const t = new MockTransport();
    const a = MementoAssistant.fromEnv(
      { transport: t, ownerId: 'u3', channel: 'test', userTags: ['session:wp'] },
      {},
    );

    for (let i = 0; i < 5; i++) {
      await a.afterAssistantTurn({
        userMessage: `user turn ${i}`, assistantReply: `reply ${i}`, conversationId: 'c3',
      });
    }

    await vi.waitFor(() => expect(t.rememberCalls.length).toBeGreaterThanOrEqual(5));

    const workingEntries = t.rememberCalls.filter(c => c.type === 'working');
    expect(workingEntries.length).toBeGreaterThanOrEqual(5);

    for (const entry of workingEntries) {
      expect(entry.tags).toEqual(expect.arrayContaining(['channel:test', 'conv:c3', 'session:wp']));
      expect(entry.content).toMatch(/user turn \d/);
    }
  });
});
