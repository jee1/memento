import { describe, expect, it } from 'vitest';
import { DeterministicMockLlmAdapter } from './deterministic-mock-llm-adapter.js';
import type { LLMMessage } from '../ports/llm-port.js';

describe('DeterministicMockLlmAdapter', () => {
  const messages: LLMMessage[] = [
    { role: 'system', content: 'context' },
    { role: 'user', content: 'hello' },
  ];

  it('같은 입력에 같은 응답과 requestId를 반환한다', async () => {
    const adapter = new DeterministicMockLlmAdapter();

    const first = await adapter.complete(messages);
    const second = await adapter.complete(messages);

    expect(second).toEqual(first);
  });

  it('다른 입력에 다른 requestId를 반환한다', async () => {
    const adapter = new DeterministicMockLlmAdapter();

    const first = await adapter.complete(messages);
    const second = await adapter.complete([
      { role: 'system', content: 'context' },
      { role: 'user', content: 'different' },
    ]);

    expect(second.metadata.requestId).not.toBe(first.metadata.requestId);
  });

  it('fixture 응답을 기본 응답보다 우선한다', async () => {
    const adapter = new DeterministicMockLlmAdapter();
    const initial = await adapter.complete(messages);
    const fixtureAdapter = new DeterministicMockLlmAdapter({
      fixtures: {
        [initial.metadata.requestId ?? '']: 'fixture response',
      },
    });

    const result = await fixtureAdapter.complete(messages);

    expect(result.content).toBe('fixture response');
    expect(result.metadata.requestId).toBe(initial.metadata.requestId);
  });

  it('안전한 mock provider metadata만 반환한다', async () => {
    const adapter = new DeterministicMockLlmAdapter({ model: 'test-model' });

    const result = await adapter.complete(messages);

    expect(result.metadata).toEqual({
      provider: 'mock',
      model: 'test-model',
      requestId: result.metadata.requestId,
      finishReason: 'stop',
    });
    expect(Object.keys(result.metadata).sort()).toEqual([
      'finishReason',
      'model',
      'provider',
      'requestId',
    ]);
  });
});
