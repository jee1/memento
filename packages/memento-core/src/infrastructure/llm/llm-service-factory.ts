/**
 * LLM Service Factory / Offline boundary check (#1094)
 */

import { mementoConfig } from '../../shared/config/index.js';
import { LLMClientInitializer } from '../../shared/services/llm-client-initializer.js';

export { LLMClientInitializer };

export function assertOfflineLlmSafety(provider: string): void {
  if (mementoConfig.offlineStrict && (provider === 'openai' || provider === 'gemini' || provider === 'anthropic')) {
    throw new Error(`remote provider ${provider} is forbidden in offline strict mode`);
  }
}
