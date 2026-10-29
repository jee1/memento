import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IRetryManager } from '../../interfaces/retry-manager.interface.js';
import { OllamaChatLlm } from './ollama-chat-llm.js';

const retryManager: IRetryManager = { retry: (fn) => fn() };

const request = {
  model: 'llama3',
  messages: [
    { role: 'system' as const, content: 'system rule' },
    { role: 'user' as const, content: 'user prompt' },
  ],
  temperature: 0.3,
  maxOutputTokens: 4096,
  json: true,
};

const originalFetch = globalThis.fetch;

function chatReply(body: unknown, contentType = 'application/json'): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': contentType }),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function tagsReply(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ models: [{ name: 'llama3' }] }),
  } as unknown as Response;
}

describe('OllamaChatLlm', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('caps output with num_predict and asks for JSON', async () => {
    fetchMock
      .mockResolvedValueOnce(tagsReply())
      .mockResolvedValueOnce(chatReply({ message: { content: '{"relations":[]}' }, prompt_eval_count: 9, eval_count: 4 }));

    const result = await new OllamaChatLlm('http://localhost:11434', retryManager).complete(request);

    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:11434/api/tags');
    expect(fetchMock.mock.calls[1]![0]).toBe('http://localhost:11434/api/chat');
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({
      model: 'llama3',
      messages: [
        { role: 'system', content: 'system rule' },
        { role: 'user', content: 'user prompt' },
      ],
      options: { temperature: 0.3, num_predict: 4096 },
      format: 'json',
    });
    expect(result).toEqual({
      content: '{"relations":[]}',
      usage: { promptTokens: 9, completionTokens: 4 },
    });
  });

  it('joins NDJSON chunks into one reply', async () => {
    const ndjson = [
      JSON.stringify({ message: { content: '{"relations"' } }),
      JSON.stringify({ message: { content: ':[]}' }, done: true, prompt_eval_count: 3, eval_count: 2 }),
    ].join('\n');
    fetchMock
      .mockResolvedValueOnce(tagsReply())
      .mockResolvedValueOnce(chatReply(ndjson, 'application/x-ndjson'));

    const result = await new OllamaChatLlm('http://localhost:11434', retryManager).complete(request);

    expect(result.content).toBe('{"relations":[]}');
    expect(result.usage).toEqual({ promptTokens: 3, completionTokens: 2 });
  });

  it('tells the operator how to install a missing model', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ models: [] }) } as unknown as Response);

    await expect(
      new OllamaChatLlm('http://localhost:11434', retryManager).complete(request),
    ).rejects.toThrow("ollama pull llama3");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
