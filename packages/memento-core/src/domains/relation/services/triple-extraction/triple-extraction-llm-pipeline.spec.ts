import { describe, it, expect, vi, beforeEach } from 'vitest';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import {
  buildTripleLlmProviderAttemptOrder,
  invokeTripleProviderWithFallback,
} from './triple-extraction-llm-pipeline.js';
import * as providers from './triple-extraction-llm-providers.js';
import type { TripleLlmCallDeps } from './triple-extraction-llm-providers.js';

describe('triple-extraction-llm-pipeline', () => {
  const deps = {
    retryManager: { retry: vi.fn(async (fn: () => Promise<unknown>) => fn()) },
    shouldRetry: () => true,
    onTokenUsage: vi.fn(),
    defaultTemperature: 0.3,
    defaultMaxTokens: 2000,
  } satisfies TripleLlmCallDeps;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('buildTripleLlmProviderAttemptOrder', () => {
    it('primary 이후 사용 가능한 provider를 순서대로 나열한다', () => {
      const order = buildTripleLlmProviderAttemptOrder('gemini', (provider) =>
        provider === 'gemini' || provider === 'openai'
      );
      expect(order).toEqual(['gemini', 'openai']);
    });
  });

  describe('invokeTripleProviderWithFallback', () => {
    it('primary Gemini 실패 시 OpenAI로 폴백한다', async () => {
      vi.spyOn(providers, 'extractRawWithGemini').mockRejectedValue(
        new Error('503 Service Unavailable high demand')
      );
      vi.spyOn(providers, 'extractRawWithOpenAI').mockResolvedValue(
        JSON.stringify({ triples: [{ subject: 'A', predicate: 'likes', object: 'B' }] })
      );

      const openaiClient = new OpenAI({ apiKey: 'test' });
      const geminiClient = new GoogleGenAI({ apiKey: 'test' });

      const result = await invokeTripleProviderWithFallback({
        primaryProvider: 'gemini',
        openaiClient,
        geminiClient,
        isProviderReady: (provider) => provider === 'gemini' || provider === 'openai',
        deps,
        prompt: 'test prompt',
        options: {},
      });

      expect(result.provider).toBe('openai');
      expect(providers.extractRawWithGemini).toHaveBeenCalledOnce();
      expect(providers.extractRawWithOpenAI).toHaveBeenCalledOnce();
    });
  });
});
