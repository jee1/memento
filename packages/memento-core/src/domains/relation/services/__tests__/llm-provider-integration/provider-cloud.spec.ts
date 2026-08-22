import { getMockMementoConfig, resetLlmProviderIntegrationTestEnv } from './llm-provider-integration.test-setup.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LLMClientInitializer } from '../../../../../shared/services/llm-client-initializer.js';

const config = getMockMementoConfig();
const providers = [
  { provider: 'openai', other: 'gemini', key: 'openaiApiKey', otherKey: 'geminiApiKey', client: 'openaiClient', otherClient: 'geminiClient' },
  { provider: 'gemini', other: 'openai', key: 'geminiApiKey', otherKey: 'openaiApiKey', client: 'geminiClient', otherClient: 'openaiClient' }
] as const;
const cases = providers.flatMap(provider => [
  { ...provider, behavior: 'available' as const },
  { ...provider, behavior: 'fallback' as const }
]);

describe('LLM provider integration - cloud providers', () => {
  beforeEach(() => {
    resetLlmProviderIntegrationTestEnv();
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as typeof global.fetch;
  });

  it.each(cases)('$behavior behavior for $provider', async ({ behavior, provider, other, key, otherKey, client, otherClient }) => {
    process.env.LLM_PROVIDER = provider;
    config[key] = behavior === 'available' ? `test-${provider}-api-key` : undefined;
    config[otherKey] = behavior === 'fallback' ? `test-${other}-api-key` : undefined;
    const warning = behavior === 'fallback'
      ? vi.spyOn((await import('../../../../../shared/utils/logger.js')).logger, 'warn')
      : undefined;

    const result = await new LLMClientInitializer().initialize();

    if (behavior === 'available') {
      expect(result.preferredProvider).toBe(provider);
      expect(result[client]).not.toBeNull();
      expect(result.initializedProviders).toContain(provider);
    } else {
      expect(result.preferredProvider).toBe(other);
      expect(result[client]).toBeNull();
      expect(result[otherClient]).not.toBeNull();
      expect(warning).toHaveBeenCalled();
    }
  });
});
