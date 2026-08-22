import { getMockMementoConfig, resetLlmClientInitializerTestEnv } from './llm-client-initializer.test-setup.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LLMClientInitializer } from '../../llm-client-initializer.js';

const config = getMockMementoConfig();
const providers = [
  { provider: 'openai', other: 'gemini', key: 'openaiApiKey', otherKey: 'geminiApiKey', client: 'openaiClient', otherClient: 'geminiClient' },
  { provider: 'gemini', other: 'openai', key: 'geminiApiKey', otherKey: 'openaiApiKey', client: 'geminiClient', otherClient: 'openaiClient' }
] as const;
const cases = providers.flatMap(provider => [
  { ...provider, behavior: 'available' as const },
  { ...provider, behavior: 'fallback' as const },
  { ...provider, behavior: 'unavailable' as const }
]);

describe('LLMClientInitializer cloud fallback behavior', () => {
  beforeEach(() => {
    resetLlmClientInitializerTestEnv();
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as typeof global.fetch;
  });

  it.each(cases)('$behavior behavior for $provider', async ({ behavior, provider, other, key, otherKey, client, otherClient }) => {
    process.env.LLM_PROVIDER = provider;
    config[key] = behavior === 'available' ? `test-${provider}-api-key` : undefined;
    config[otherKey] = behavior === 'fallback' ? `test-${other}-api-key` : undefined;
    const logger = (await import('../../../utils/logger.js')).logger;
    const warning = behavior === 'fallback' ? vi.spyOn(logger, 'warn') : undefined;
    const error = behavior === 'unavailable' ? vi.spyOn(logger, 'error') : undefined;

    const result = await new LLMClientInitializer().initialize();

    if (behavior === 'available') {
      expect(result.preferredProvider).toBe(provider);
      expect(result[client]).not.toBeNull();
    } else if (behavior === 'fallback') {
      expect(result.preferredProvider).toBe(other);
      expect(result[client]).toBeNull();
      expect(result[otherClient]).not.toBeNull();
      expect(warning).toHaveBeenCalled();
    } else {
      expect(result.preferredProvider).toBeNull();
      expect(result.openaiClient).toBeNull();
      expect(result.geminiClient).toBeNull();
      expect(result.initializedProviders).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(error).toHaveBeenCalled();
    }
  });
});
