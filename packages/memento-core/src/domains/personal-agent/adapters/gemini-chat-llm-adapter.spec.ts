import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
}));

import { GoogleGenAI } from '@google/genai';
import { GeminiChatLlmAdapter } from './gemini-chat-llm-adapter.js';
import { PersonalAgentLlmError } from '../errors/personal-agent-llm-error.js';

describe('GeminiChatLlmAdapter', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
    vi.mocked(GoogleGenAI).mockClear();
  });

  it('calls generateContent with merged prompt and returns gemini metadata', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'hello gemini',
    });
    const adapter = new GeminiChatLlmAdapter({
      apiKey: 'AIza-test',
      model: 'gemini-2.0-flash',
    });
    const result = await adapter.complete([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hi' },
    ]);
    expect(GoogleGenAI).toHaveBeenCalledWith({ apiKey: 'AIza-test' });
    expect(mockGenerateContent).toHaveBeenCalledWith({
      model: 'gemini-2.0-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: 'You are helpful.\n\nuser: Hi',
            },
          ],
        },
      ],
    });
    expect(result.content).toBe('hello gemini');
    expect(result.metadata.provider).toBe('gemini');
    expect(result.metadata.model).toBe('gemini-2.0-flash');
  });

  it('omits empty system block', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'ok',
    });
    const adapter = new GeminiChatLlmAdapter({
      apiKey: 'k',
      model: 'gemini-2.0-flash',
    });
    await adapter.complete([{ role: 'user', content: 'only user' }]);
    expect(mockGenerateContent).toHaveBeenCalledWith({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: 'user: only user' }] }],
    });
  });

  it('throws PersonalAgentLlmError on generateContent failure', async () => {
    mockGenerateContent.mockRejectedValue(new Error('quota'));
    const adapter = new GeminiChatLlmAdapter({
      apiKey: 'k',
      model: 'gemini-2.0-flash',
    });
    await expect(adapter.complete([{ role: 'user', content: 'x' }])).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof PersonalAgentLlmError && e.code === 'provider_runtime_failed',
    );
  });
});
