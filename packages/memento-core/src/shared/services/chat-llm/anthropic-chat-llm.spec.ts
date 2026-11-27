import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import type { IRetryManager } from '../../interfaces/retry-manager.interface.js';
import { AnthropicChatLlm, isRetryableAnthropicError } from './anthropic-chat-llm.js';

const retryManager: IRetryManager = { retry: (fn) => fn() };

const request = {
  model: 'claude-haiku-5-5',
  messages: [
    { role: 'system' as const, content: 'system rule' },
    { role: 'user' as const, content: 'user prompt' },
  ],
  temperature: 0,
  maxOutputTokens: 400,
  json: true,
};
const reply = (overrides: Record<string, unknown> = {}) => ({
  content: [{ type: 'text', text: '{"verdict":"pending"}' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 120, output_tokens: 30 },
  ...overrides,
});

function clientWith(create: ReturnType<typeof vi.fn>): Anthropic {
  return { messages: { create } } as unknown as Anthropic;
}

describe('AnthropicChatLlm (#1840)', () => {
  it('보내는 요청: system 분리, temperature 없음, thinking adaptive, effort medium, schema 가 있을 때만 format', async () => {
    const create = vi.fn().mockResolvedValue(reply());
    const llm = new AnthropicChatLlm(clientWith(create), retryManager);
    const schema = { type: 'object', properties: {}, required: [], additionalProperties: false };

    await llm.complete({ ...request, jsonSchema: schema });
    await llm.complete(request);

    const [withSchema, withoutSchema] = create.mock.calls.map((call) => call[0]);
    expect(withSchema).toEqual({
      model: 'claude-haiku-5-5',
      max_tokens: 400,
      system: 'system rule',
      messages: [{ role: 'user', content: 'user prompt' }],
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    });
    expect(withSchema).not.toHaveProperty('temperature');
    expect(withoutSchema.output_config).toEqual({ effort: 'medium' });
  });

  it('응답의 실제 토큰 수를 usage 로 돌려준다', async () => {
    const create = vi.fn().mockResolvedValue(reply());

    const result = await new AnthropicChatLlm(clientWith(create), retryManager).complete(request);

    expect(result).toEqual({
      content: '{"verdict":"pending"}',
      usage: { promptTokens: 120, completionTokens: 30 },
    });
  });

  it('timeoutMs 를 주면 요청 옵션 timeout 으로 넘긴다', async () => {
    const create = vi.fn().mockResolvedValue(reply());

    await new AnthropicChatLlm(clientWith(create), retryManager).complete({ ...request, timeoutMs: 10_000 });

    expect(create.mock.calls[0]![1]).toEqual({ timeout: 10_000 });
  });

  it('출력 상한에서 잘리면 상한을 말하는 오류로 throw 한다', async () => {
    const truncated = new AnthropicChatLlm(
      clientWith(vi.fn().mockResolvedValue(reply({ stop_reason: 'max_tokens', content: [] }))),
      retryManager,
    );

    await expect(truncated.complete(request)).rejects.toThrow('max_tokens');
  });

  it('재시도: 연결 오류와 5xx(529 포함)만, 429 와 4xx 는 다시 보내지 않는다', () => {
    const apiError = (status: number) => Object.assign(Object.create(Anthropic.APIError.prototype), { status, message: 'x' });
    const connection = Object.assign(Object.create(Anthropic.APIConnectionError.prototype), { message: 'Connection error.' });

    expect([500, 529, 503].map((s) => isRetryableAnthropicError(apiError(s)))).toEqual([true, true, true]);
    expect([429, 400, 401].map((s) => isRetryableAnthropicError(apiError(s)))).toEqual([false, false, false]);
    expect(isRetryableAnthropicError(connection)).toBe(true);
    expect(isRetryableAnthropicError(new Error('429 rate limit'))).toBe(false);
  });

  it('거절과 빈 응답은 throw 한다', async () => {
    const refusal = new AnthropicChatLlm(clientWith(vi.fn().mockResolvedValue(reply({ stop_reason: 'refusal' }))), retryManager);
    const empty = new AnthropicChatLlm(clientWith(vi.fn().mockResolvedValue(reply({ content: [] }))), retryManager);

    await expect(refusal.complete(request)).rejects.toThrow('refusal');
    await expect(empty.complete(request)).rejects.toThrow('비었습니다');
  });
});
