import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OllamaChatLlmAdapter } from './ollama-chat-llm-adapter.js';
import { PersonalAgentLlmError } from '../errors/personal-agent-llm-error.js';

describe('OllamaChatLlmAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POST /api/chat and maps assistant message', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ message: { role: 'assistant', content: 'hi ollama' } }),
      text: async () => '',
    });
    const adapter = new OllamaChatLlmAdapter({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'llama3.2',
    });
    const out = await adapter.complete([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hello' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'llama3.2',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hello' },
      ],
      stream: false,
    });
    expect(out.content).toBe('hi ollama');
    expect(out.metadata.provider).toBe('ollama');
    expect(out.metadata.model).toBe('llama3.2');
  });

  it('throws on non-OK HTTP', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => 'service unavailable',
    });
    const adapter = new OllamaChatLlmAdapter({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'm',
    });
    await expect(adapter.complete([{ role: 'user', content: 'x' }])).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof PersonalAgentLlmError && e.code === 'provider_runtime_failed',
    );
  });

  it('normalizes trailing slash on base URL', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: '' } }),
      text: async () => '',
    });
    const adapter = new OllamaChatLlmAdapter({
      baseUrl: 'http://127.0.0.1:11434///',
      model: 'm',
    });
    await adapter.complete([{ role: 'user', content: 'x' }]);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
  });
});
