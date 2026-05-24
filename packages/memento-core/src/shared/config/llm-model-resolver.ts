/**
 * LLM chat/generateContent용 모델 이름 해석.
 * 임베딩 모델(GEMINI_MODEL, OPENAI_MODEL)과 분리한다.
 */

import { mementoConfig } from './index.js';
import type { MementoConfig } from '../types/index.js';

export type LlmUseCase =
  | 'triple_extraction'
  | 'relation_extraction'
  | 'procedural'
  | 'consolidation';

export type LlmModelProvider = 'openai' | 'gemini' | 'ollama';

const PROVIDER_CODE_DEFAULTS: Record<LlmModelProvider, string> = {
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
  ollama: 'llama3',
};

export type LlmModelConfigSlice = Pick<
  MementoConfig,
  'openaiLlmModel' | 'geminiLlmModel' | 'ollamaModel' | 'llmModelOverrides'
>;

function resolveProviderDefaultModel(
  provider: LlmModelProvider,
  config: LlmModelConfigSlice
): string {
  switch (provider) {
    case 'openai':
      return config.openaiLlmModel || PROVIDER_CODE_DEFAULTS.openai;
    case 'gemini':
      return config.geminiLlmModel || PROVIDER_CODE_DEFAULTS.gemini;
    case 'ollama':
      return config.ollamaModel || PROVIDER_CODE_DEFAULTS.ollama;
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

/**
 * @param provider - 활성 LLM provider
 * @param useCase - triple/relation/procedural/consolidation (선택)
 * @param config - 테스트 주입용; 기본 mementoConfig
 */
export function resolveLlmModel(
  provider: LlmModelProvider,
  useCase?: LlmUseCase,
  config: LlmModelConfigSlice = mementoConfig
): string {
  if (useCase) {
    const override = config.llmModelOverrides[useCase]?.trim();
    if (override) {
      return override;
    }
  }
  return resolveProviderDefaultModel(provider, config);
}
