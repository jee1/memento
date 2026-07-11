import { logger } from '../../utils/logger.js';
import type { LLMProvider } from '../../types/index.js';
import type { LLMClientInitializationResult } from './types.js';

/**
 * preferredProvider 결정
 */
export function determinePreferredProvider(
  result: LLMClientInitializationResult,
  selectedProvider: LLMProvider
): 'openai' | 'gemini' | 'ollama' | null {
  if (selectedProvider === 'openai') {
    return determineProviderForOpenAI(result, selectedProvider);
  } else if (selectedProvider === 'gemini') {
    return determineProviderForGemini(result, selectedProvider);
  } else if (selectedProvider === 'ollama') {
    return determineProviderForOllama(result, selectedProvider);
  } else {
    // 'auto' 모드: OpenAI -> Gemini -> Ollama 순서로 사용 가능한 첫 번째 provider 선택
    return determineProviderForAuto(result);
  }
}

/**
 * OpenAI provider에 대한 preferredProvider 결정
 */
function determineProviderForOpenAI(
  result: LLMClientInitializationResult,
  selectedProvider: LLMProvider
): 'openai' | 'gemini' | null {
  if (result.openaiClient !== null) {
    return 'openai';
  } else if (result.geminiClient !== null) {
    logger.warn('OpenAI를 사용할 수 없어 Gemini로 fallback합니다.', {
      requestedProvider: selectedProvider,
      fallbackProvider: 'gemini'
    });
    return 'gemini';
  } else {
    logger.error('LLM_PROVIDER="openai"로 설정되었지만 OpenAI와 Gemini 모두 사용할 수 없습니다.', {
      requestedProvider: selectedProvider,
      initializedProviders: result.initializedProviders,
      warnings: result.warnings
    });
    return null;
  }
}

/**
 * Gemini provider에 대한 preferredProvider 결정
 */
function determineProviderForGemini(
  result: LLMClientInitializationResult,
  selectedProvider: LLMProvider
): 'openai' | 'gemini' | null {
  if (result.geminiClient !== null) {
    return 'gemini';
  } else if (result.openaiClient !== null) {
    logger.warn('Gemini를 사용할 수 없어 OpenAI로 fallback합니다.', {
      requestedProvider: selectedProvider,
      fallbackProvider: 'openai'
    });
    return 'openai';
  } else {
    logger.error('LLM_PROVIDER="gemini"로 설정되었지만 Gemini와 OpenAI 모두 사용할 수 없습니다.', {
      requestedProvider: selectedProvider,
      initializedProviders: result.initializedProviders,
      warnings: result.warnings
    });
    return null;
  }
}

/**
 * Ollama provider에 대한 preferredProvider 결정
 */
function determineProviderForOllama(
  result: LLMClientInitializationResult,
  selectedProvider: LLMProvider
): 'openai' | 'gemini' | 'ollama' | null {
  if (result.initializedProviders.includes('ollama')) {
    return 'ollama';
  } else if (result.openaiClient !== null) {
    logger.warn('Ollama를 사용할 수 없어 OpenAI로 fallback합니다.', {
      requestedProvider: selectedProvider,
      fallbackProvider: 'openai'
    });
    return 'openai';
  } else if (result.geminiClient !== null) {
    logger.warn('Ollama와 OpenAI를 사용할 수 없어 Gemini로 fallback합니다.', {
      requestedProvider: selectedProvider,
      fallbackProvider: 'gemini'
    });
    return 'gemini';
  } else {
    logger.error('LLM_PROVIDER="ollama"로 설정되었지만 Ollama, OpenAI, Gemini 모두 사용할 수 없습니다.', {
      requestedProvider: selectedProvider,
      initializedProviders: result.initializedProviders,
      warnings: result.warnings
    });
    return null;
  }
}

/**
 * Auto 모드에 대한 preferredProvider 결정
 */
function determineProviderForAuto(
  result: LLMClientInitializationResult
): 'openai' | 'gemini' | 'ollama' | null {
  if (result.openaiClient !== null) {
    return 'openai';
  } else if (result.geminiClient !== null) {
    return 'gemini';
  } else if (result.initializedProviders.includes('ollama')) {
    return 'ollama';
  } else {
    return null;
  }
}
