import { GoogleGenAI } from '@google/genai';
import { mementoConfig } from '../../config/index.js';
import type { LLMProvider } from '../../types/memory.types.js';
import type { LLMClientInitializationResult } from './types.js';
import {
  addWarning,
  getErrorMessage,
  shouldWarnMissingGeminiKey,
} from './shared-helpers.js';

/**
 * Gemini 클라이언트 초기화
 *
 * @note
 * - `@google/genai` 라이브러리를 사용합니다.
 * - 생성자에 API 키 객체를 전달합니다: `new GoogleGenAI({ apiKey })`
 */
export function initializeGemini(
  result: LLMClientInitializationResult,
  selectedProvider: LLMProvider
): GoogleGenAI | null {
  if (!mementoConfig.geminiApiKey) {
    if (shouldWarnMissingGeminiKey(selectedProvider)) {
      const warningMessage = 'GEMINI_API_KEY가 없습니다.';
      addWarning(
        result,
        warningMessage,
        'Gemini API 키가 없어 초기화를 건너뜁니다.',
        {
          requestedProvider: selectedProvider,
          reason: warningMessage
        }
      );
    }
    return null;
  }

  // 이 시점에서 geminiApiKey는 string 타입이 보장됨
  const apiKey: string = mementoConfig.geminiApiKey;

  try {
    const client = new GoogleGenAI({ apiKey });
    result.initializedProviders.push('gemini');
    return client;
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    const warningMessage = `Gemini 클라이언트 초기화 실패: ${errorMessage}`;
    addWarning(
      result,
      warningMessage,
      'Gemini 클라이언트 초기화 중 오류가 발생했습니다.',
      {
        requestedProvider: selectedProvider,
        reason: errorMessage
      }
    );
    return null;
  }
}
