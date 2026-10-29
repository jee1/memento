import { describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import type { IRetryManager } from '../../interfaces/retry-manager.interface.js';
import { OpenAiChatLlm } from './openai-chat-llm.js';

const retryManager: IRetryManager = { retry: (fn) => fn() };

const request = {
  model: 'gpt-5.1',
  messages: [
    { role: 'system' as const, content: 'system rule' },
    { role: 'user' as const, content: 'user prompt' },
  ],
  temperature: 0.3,
  maxOutputTokens: 4096,
  json: true,
};

function clientWith(create: ReturnType<typeof vi.fn>): OpenAI {
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

const reply = {
  choices: [{ message: { content: '{"relations":[]}' } }],
  usage: { prompt_tokens: 12, completion_tokens: 7 },
};

describe('OpenAiChatLlm', () => {
  it('caps output with max_completion_tokens so gpt-5.x does not reject the request', async () => {
    // gpt-5.x 가 `max_tokens` 를 받으면 내는 400 을 그대로 흉내낸다.
    const create = vi.fn(async (body: Record<string, unknown>) => {
      if ('max_tokens' in body) {
        throw new Error("400 Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead.");
      }
      return reply;
    });

    const result = await new OpenAiChatLlm(clientWith(create), retryManager).complete(request);

    expect(result.content).toBe('{"relations":[]}');
    expect(create.mock.calls[0]![0]).toMatchObject({
      model: 'gpt-5.1',
      temperature: 0.3,
      max_completion_tokens: 4096,
      response_format: { type: 'json_object' },
    });
    expect(create.mock.calls[0]![0]).not.toHaveProperty('max_tokens');
  });

  it('passes messages through and maps token usage', async () => {
    const create = vi.fn().mockResolvedValue(reply);

    const result = await new OpenAiChatLlm(clientWith(create), retryManager).complete(request);

    expect(create.mock.calls[0]![0].messages).toEqual([
      { role: 'system', content: 'system rule' },
      { role: 'user', content: 'user prompt' },
    ]);
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 7 });
  });

  it('omits the JSON response mode when json is false', async () => {
    const create = vi.fn().mockResolvedValue(reply);

    await new OpenAiChatLlm(clientWith(create), retryManager).complete({ ...request, json: false });

    expect(create.mock.calls[0]![0]).not.toHaveProperty('response_format');
  });

  it('throws when the reply has no content', async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: '' } }] });

    await expect(
      new OpenAiChatLlm(clientWith(create), retryManager).complete(request),
    ).rejects.toThrow('OpenAI 응답이 비어있습니다.');
  });
});
