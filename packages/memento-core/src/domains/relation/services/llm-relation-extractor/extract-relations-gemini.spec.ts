import { describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import { extractRelationsWithGemini, type GeminiRelationExtractDeps } from './extract-relations-gemini.js';

describe('extractRelationsWithGemini', () => {
  it('disables thinking so thinking tokens cannot truncate the JSON reply', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: '{"relations":[]}' });
    const client = { models: { generateContent } } as unknown as GoogleGenAI;
    const deps: GeminiRelationExtractDeps = {
      rateLimiter: { consume: vi.fn().mockResolvedValue(undefined) } as unknown as GeminiRelationExtractDeps['rateLimiter'],
      retryManager: { retry: (fn: () => Promise<unknown>) => fn() } as unknown as GeminiRelationExtractDeps['retryManager'],
      calculateAndLogCost: vi.fn().mockReturnValue(0),
      parseLlmRelationsResponse: () => ({ success: true, relations: [] }) as never,
    };

    await extractRelationsWithGemini(client, 'prompt', deps);

    expect(generateContent.mock.calls[0]![0].config.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });
});
