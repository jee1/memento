/**
 * LLM chat/generateContent용 모델 이름 해석.
 * 임베딩 모델(GEMINI_MODEL, OPENAI_MODEL)과 분리한다.
 */

import { mementoConfig } from './index.js';
import type { LLMProvider, MementoConfig } from '../types/memory.types.js';
import { logger } from '../utils/logger.js';

export type LlmUseCase =
  | 'triple_extraction'
  | 'relation_extraction'
  | 'procedural'
  | 'consolidation';

export type InScopeLlmProviderUseCase =
  | 'triple_extraction'
  | 'relation_extraction'
  | 'procedural';

export type LlmModelProvider = 'openai' | 'gemini' | 'ollama';

const PROVIDER_CODE_DEFAULTS: Record<LlmModelProvider, string> = {
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
  ollama: 'llama3',
};

const CONCRETE_LLM_PROVIDERS = new Set<LlmModelProvider>(['openai', 'gemini', 'ollama']);

export type LlmModelConfigSlice = Pick<
  MementoConfig,
  'openaiLlmModel' | 'geminiLlmModel' | 'ollamaModel' | 'llmModelOverrides'
>;

export type LlmProviderConfigSlice = Pick<
  MementoConfig,
  'llmProvider' | 'llmProviderOverrides'
>;

export type ResolveLlmModelOptions = {
  boundProvider?: LlmModelProvider | null;
  onModelOverrideDiscarded?: (info: {
    useCase: LlmUseCase;
    boundProvider: LlmModelProvider | null | undefined;
    runtimeProvider: LlmModelProvider;
    discardedModel: string;
  }) => void;
};

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

function isConcreteLlmProvider(value: LLMProvider): value is LlmModelProvider {
  return CONCRETE_LLM_PROVIDERS.has(value as LlmModelProvider);
}

function defaultOnModelOverrideDiscarded(info: {
  useCase: LlmUseCase;
  boundProvider: LlmModelProvider | null | undefined;
  runtimeProvider: LlmModelProvider;
  discardedModel: string;
}): void {
  logger.warn('LLM model override discarded because runtime provider differs from bound provider', {
    useCase: info.useCase,
    boundProvider: info.boundProvider ?? null,
    runtimeProvider: info.runtimeProvider,
    discardedModel: info.discardedModel,
  });
}

export function resolveLlmProvider(
  useCase: InScopeLlmProviderUseCase,
  config: LlmProviderConfigSlice = mementoConfig
): LLMProvider {
  const override = config.llmProviderOverrides?.[useCase];
  if (override !== undefined) {
    return override;
  }
  return config.llmProvider;
}

export function resolveBoundLlmProvider(
  useCase: InScopeLlmProviderUseCase,
  initPreferred: LlmModelProvider | null,
  config: LlmProviderConfigSlice = mementoConfig
): LlmModelProvider | null {
  const requested = resolveLlmProvider(useCase, config);
  if (isConcreteLlmProvider(requested)) {
    return requested;
  }
  return initPreferred;
}

/**
 * @param runtimeProvider - 활성 LLM provider
 * @param useCase - triple/relation/procedural/consolidation (선택)
 * @param config - 테스트 주입용; 기본 mementoConfig
 */
export function resolveLlmModel(
  runtimeProvider: LlmModelProvider,
  useCase?: LlmUseCase,
  config: LlmModelConfigSlice = mementoConfig,
  options?: ResolveLlmModelOptions
): string {
  if (useCase) {
    const override = config.llmModelOverrides[useCase]?.trim();
    if (override) {
      const boundProvider = options?.boundProvider;
      if (boundProvider === undefined || boundProvider === null || runtimeProvider !== boundProvider) {
        const onDiscarded = options?.onModelOverrideDiscarded ?? defaultOnModelOverrideDiscarded;
        onDiscarded({
          useCase,
          boundProvider,
          runtimeProvider,
          discardedModel: override,
        });
        return resolveProviderDefaultModel(runtimeProvider, config);
      }
      return override;
    }
  }
  return resolveProviderDefaultModel(runtimeProvider, config);
}
