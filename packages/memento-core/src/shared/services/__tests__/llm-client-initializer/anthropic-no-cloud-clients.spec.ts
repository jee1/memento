import { resetLlmClientInitializerTestEnv, getMockMementoConfig } from './llm-client-initializer.test-setup.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { LLMClientInitializer } from '../../llm-client-initializer.js';

const mockMementoConfig = getMockMementoConfig();

describe('LLMClientInitializer anthropic (#1840)', () => {
  beforeEach(() => {
    resetLlmClientInitializerTestEnv();
  });

  it('LLM_PROVIDER=anthropic 이면 OpenAI, Gemini 키가 있어도 두 클라이언트를 만들지 않는다', async () => {
    process.env.LLM_PROVIDER = 'anthropic';
    mockMementoConfig.openaiApiKey = 'sk-test-openai';
    mockMementoConfig.geminiApiKey = 'test-gemini';

    const result = await new LLMClientInitializer().initialize();

    expect(result).toMatchObject({ preferredProvider: null, openaiClient: null, geminiClient: null, initializedProviders: [] });
    expect(vi.mocked(OpenAI)).not.toHaveBeenCalled();
    expect(vi.mocked(GoogleGenAI)).not.toHaveBeenCalled();
  });

  it('대조: auto 면 같은 키로 두 클라이언트를 만든다', async () => {
    process.env.LLM_PROVIDER = 'auto';
    mockMementoConfig.openaiApiKey = 'sk-test-openai';
    mockMementoConfig.geminiApiKey = 'test-gemini';

    const result = await new LLMClientInitializer().initialize();

    expect(result.initializedProviders).toEqual(['openai', 'gemini']);
    expect(vi.mocked(OpenAI)).toHaveBeenCalledTimes(1);
  });
});
