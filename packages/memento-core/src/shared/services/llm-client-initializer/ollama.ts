import { mementoConfig } from '../../config/index.js';
import { getRetryOptions } from '../../config/retry-options-loader.js';
import { logger } from '../../utils/logger.js';
import type { RetryManager } from '../../../infrastructure/scheduler/retry-manager.js';
import type { LLMProvider } from '../../types/index.js';
import type { LLMClientInitializationResult } from './types.js';
import { addWarning, getErrorMessage } from './shared-helpers.js';

/**
 * Ollama 응답 처리
 */
async function handleOllamaResponse(
  response: Response,
  result: LLMClientInitializationResult,
  selectedProvider: LLMProvider,
  baseUrl: string
): Promise<void> {
  if (response.ok) {
    // JSON 파싱 시도
    try {
      await response.json();
      result.initializedProviders.push('ollama');
    } catch (jsonError) {
      const errorMessage = getErrorMessage(jsonError);
      const warningMessage = `Ollama 응답 JSON 파싱 실패: ${errorMessage}`;
      addWarning(
        result,
        warningMessage,
        'Ollama 응답 JSON 파싱 중 오류가 발생했습니다.',
        {
          requestedProvider: selectedProvider,
          baseUrl,
          reason: errorMessage
        }
      );
    }
  } else {
    // HTTP 비-200 응답 (4xx 에러는 재시도하지 않음)
    const warningMessage = `Ollama 서버 연결 실패: HTTP ${response.status} ${response.statusText}`;
    addWarning(
      result,
      warningMessage,
      'Ollama 서버 연결 실패',
      {
        requestedProvider: selectedProvider,
        baseUrl,
        status: response.status,
        statusText: response.statusText
      }
    );
  }
}

/**
 * Ollama 연결 재시도 여부 결정
 */
function shouldRetryOllamaConnection(error: Error): boolean {
  const errorMessage = error.message.toLowerCase();
  // 네트워크 에러 재시도
  const isNetworkError = errorMessage.includes('fetch failed') ||
                       errorMessage.includes('econnrefused') ||
                       errorMessage.includes('enotfound');
  // 타임아웃 에러 재시도
  const isTimeout = errorMessage.includes('aborted') ||
                   errorMessage.includes('timeout');
  // HTTP 5xx 에러 재시도
  const isServerError = errorMessage.includes('http 5') ||
                      errorMessage.includes('server error');

  return isNetworkError || isTimeout || isServerError;
}

/**
 * Ollama 에러 메시지 생성
 */
function getOllamaErrorMessage(errorMessage: string): string {
  const isTimeout = errorMessage.includes('aborted') || errorMessage.includes('timeout');
  const isNetworkError = errorMessage.includes('fetch failed') ||
                         errorMessage.includes('ECONNREFUSED') ||
                         errorMessage.includes('ENOTFOUND');

  if (isTimeout) {
    return 'Ollama 연결 타임아웃 (5초)';
  } else if (isNetworkError) {
    return `Ollama 네트워크 에러: ${errorMessage}`;
  } else {
    return `Ollama 연결 테스트 실패: ${errorMessage}`;
  }
}

/**
 * Ollama 연결 테스트
 */
export async function testOllamaConnection(
  result: LLMClientInitializationResult,
  selectedProvider: LLMProvider,
  retryManager: RetryManager
): Promise<void> {
  const baseUrl = mementoConfig.ollamaBaseUrl || 'http://localhost:11434';
  const retryOptions = getRetryOptions();

  try {
    const response = await retryManager.retry(
      async () => {
        const fetchResponse = await fetch(`${baseUrl}/api/tags`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000) // 5초 타임아웃
        });

        // HTTP 5xx 에러는 재시도, 4xx 에러는 재시도하지 않음
        if (!fetchResponse.ok && fetchResponse.status >= 500) {
          const errorText = await fetchResponse.text().catch(() => '');
          throw new Error(`Ollama 서버 에러: HTTP ${fetchResponse.status} ${fetchResponse.statusText}${errorText ? ` - ${errorText}` : ''}`);
        }

        return fetchResponse;
      },
      {
        maxAttempts: retryOptions.external_api.maxAttempts,
        baseDelay: retryOptions.external_api.baseDelay,
        shouldRetry: (error: Error) => shouldRetryOllamaConnection(error),
        onRetry: (error: Error, attempt: number, delay: number) => {
          logger.warn('LLMClientInitializer: Ollama 연결 테스트 재시도', {
            attempt,
            delay,
            error: error.message,
            baseUrl,
            requestedProvider: selectedProvider
          });
        }
      }
    );

    await handleOllamaResponse(response, result, selectedProvider, baseUrl);
  } catch (error) {
    // 타임아웃 또는 네트워크 에러 (재시도 실패)
    const errorMessage = getErrorMessage(error);
    const warningMessage = getOllamaErrorMessage(errorMessage);

    addWarning(
      result,
      warningMessage,
      'Ollama 연결 테스트 중 오류가 발생했습니다.',
      {
        requestedProvider: selectedProvider,
        baseUrl,
        reason: errorMessage
      }
    );
  }
}
