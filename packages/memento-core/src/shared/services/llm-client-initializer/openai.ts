import OpenAI from 'openai';
import { mementoConfig } from '../../config/index.js';
import type { LLMProvider } from '../../types/index.js';
import type { LLMClientInitializationResult } from './types.js';
import {
  addWarning,
  getErrorMessage,
  shouldWarnMissingOpenaiKey,
} from './shared-helpers.js';

/**
 * OpenAI 클라이언트 초기화
 */
export function initializeOpenAI(
  result: LLMClientInitializationResult,
  selectedProvider: LLMProvider
): OpenAI | null {
  if (!mementoConfig.openaiApiKey) {
    if (shouldWarnMissingOpenaiKey(selectedProvider)) {
      const warningMessage = 'OPENAI_API_KEY가 없습니다.';
      addWarning(
        result,
        warningMessage,
        'OpenAI API 키가 없어 초기화를 건너뜁니다.',
        {
          requestedProvider: selectedProvider,
          reason: warningMessage
        }
      );
    }
    return null;
  }

  try {
    const client = new OpenAI({ apiKey: mementoConfig.openaiApiKey });
    result.initializedProviders.push('openai');
    return client;
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    const warningMessage = `OpenAI 클라이언트 초기화 실패: ${errorMessage}`;
    addWarning(
      result,
      warningMessage,
      'OpenAI 클라이언트 초기화 중 오류가 발생했습니다.',
      {
        requestedProvider: selectedProvider,
        reason: errorMessage
      }
    );
    return null;
  }
}
