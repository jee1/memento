import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
  },
}));

import { OpenAiChatLlmAdapter } from './openai-chat-llm-adapter.js';
import { PersonalAgentLlmError } from '../errors/personal-agent-llm-error.js';

describe('OpenAiChatLlmAdapter', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('maps completion to LLMCompletionResult', async () => {
    mockCreate.mockResolvedValue({
      id: 'resp-1',
      choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
    });
    const adapter = new OpenAiChatLlmAdapter({ apiKey: 'sk-test', model: 'gpt-4o-mini' });
    const result = await adapter.complete([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ]);
    expect(mockCreate).toHaveBeenCalledWith({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
    });
    expect(result.metadata.provider).toBe('openai');
    expect(result.content).toBe('hello');
    expect(result.metadata.requestId).toBe('resp-1');
    expect(result.metadata.finishReason).toBe('stop');
  });

  it('uses empty string when content is null', async () => {
    mockCreate.mockResolvedValue({
      id: 'resp-2',
      choices: [{ message: { content: null }, finish_reason: 'stop' }],
    });
    const adapter = new OpenAiChatLlmAdapter({ apiKey: 'sk-test', model: 'gpt-4o-mini' });
    const result = await adapter.complete([{ role: 'user', content: 'x' }]);
    expect(result.content).toBe('');
  });

  it('throws PersonalAgentLlmError on API failure', async () => {
    mockCreate.mockRejectedValue(new Error('network'));
    const adapter = new OpenAiChatLlmAdapter({ apiKey: 'sk-test', model: 'gpt-4o-mini' });
    await expect(adapter.complete([{ role: 'user', content: 'x' }])).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof PersonalAgentLlmError && e.code === 'provider_runtime_failed',
    );
  });
});
