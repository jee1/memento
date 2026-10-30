import { describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import type { IRetryManager } from '../../interfaces/retry-manager.interface.js';
import { GeminiChatLlm } from './gemini-chat-llm.js';

const retryManager: IRetryManager = { retry: (fn) => fn() };

const request = {
  model: 'gemini-flash-latest',
  messages: [
    { role: 'system' as const, content: 'system rule' },
    { role: 'user' as const, content: 'user prompt' },
  ],
  temperature: 0.3,
  maxOutputTokens: 4096,
  json: true,
};

function clientWith(generateContent: ReturnType<typeof vi.fn>): GoogleGenAI {
  return { models: { generateContent } } as unknown as GoogleGenAI;
}

describe('GeminiChatLlm', () => {
  it('disables thinking so thinking tokens cannot truncate the reply', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: '{"relations":[]}' });

    await new GeminiChatLlm(clientWith(generateContent), retryManager).complete(request);

    expect(generateContent.mock.calls[0]![0].config).toMatchObject({
      temperature: 0.3,
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: 'application/json',
      systemInstruction: 'system rule',
    });
  });

  it('sends non-system messages as contents', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: '{"relations":[]}' });

    await new GeminiChatLlm(clientWith(generateContent), retryManager).complete({
      ...request,
      messages: [...request.messages, { role: 'assistant', content: 'earlier reply' }],
    });

    expect(generateContent.mock.calls[0]![0].contents).toEqual([
      { role: 'user', parts: [{ text: 'user prompt' }] },
      { role: 'model', parts: [{ text: 'earlier reply' }] },
    ]);
  });

  it('estimates usage from text length because Gemini returns no token counts', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: '12345678' });

    const result = await new GeminiChatLlm(clientWith(generateContent), retryManager).complete(request);

    expect(result.usage).toEqual({ promptTokens: 6, completionTokens: 2 });
  });

  it('throws when the reply has no text', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: '' });

    await expect(
      new GeminiChatLlm(clientWith(generateContent), retryManager).complete(request),
    ).rejects.toThrow('Gemini 응답이 비어있습니다.');
  });
});
