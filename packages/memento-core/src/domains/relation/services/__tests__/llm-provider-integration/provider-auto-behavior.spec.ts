import { getMockMementoConfig, resetLlmProviderIntegrationTestEnv } from './llm-provider-integration.test-setup.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LLMClientInitializer } from '../../../../../shared/services/llm-client-initializer.js';

const config = getMockMementoConfig();
const cases = [
  { contract: 'integration', openai: true, gemini: false, ollama: false, expected: 'openai', skipsProbe: true },
  { contract: 'unit fallback', openai: false, gemini: true, ollama: false, expected: 'gemini', skipsProbe: true },
  { contract: 'integration', openai: false, gemini: false, ollama: true, expected: 'ollama', skipsProbe: false },
  { contract: 'unit fallback', openai: false, gemini: false, ollama: true, expected: 'ollama', skipsProbe: false },
  { contract: 'integration', openai: false, gemini: false, ollama: false, expected: null, skipsProbe: false },
  { contract: 'unit fallback', openai: false, gemini: false, ollama: false, expected: null, skipsProbe: false }
] as const;

describe('LLM provider auto-selection behavior', () => {
  beforeEach(() => resetLlmProviderIntegrationTestEnv());

  it.each(cases)('$contract selects $expected for openai=$openai gemini=$gemini ollama=$ollama', async ({ openai, gemini, ollama, expected, skipsProbe }) => {
    process.env.LLM_PROVIDER = 'auto';
    config.openaiApiKey = openai ? 'test-openai-api-key' : undefined;
    config.geminiApiKey = gemini ? 'test-gemini-api-key' : undefined;
    const fetchMock = ollama
      ? vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ models: [] }) })
      : vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    global.fetch = fetchMock as typeof global.fetch;

    const result = await new LLMClientInitializer().initialize();

    expect(result.preferredProvider).toBe(expected);
    expect(result.openaiClient === null).toBe(!openai);
    expect(result.geminiClient === null).toBe(!gemini);
    if (expected === 'ollama') expect(result.initializedProviders).toContain('ollama');
    if (expected === null) expect(result.initializedProviders).not.toContain('ollama');
    if (skipsProbe) expect(fetchMock).not.toHaveBeenCalled();
  });
});
