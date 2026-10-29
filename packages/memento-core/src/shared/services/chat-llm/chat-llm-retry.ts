import { getRetryOptions } from '../../config/retry-options-loader.js';
import type { IRetryManager } from '../../interfaces/retry-manager.interface.js';
import { logger } from '../../utils/logger.js';
import type { ChatLlmProvider } from './chat-llm-port.js';

/** 클라우드 provider 의 일시 오류. gemini 와 openai 가 따로 두던 목록을 합쳤다. */
const CLOUD_TRANSIENT = ['network', 'timeout', 'rate limit', 'server error', '503', '502', '500'];

/**
 * 로컬 provider 는 연결 실패만 재시도한다. 요청 타임아웃을 재시도하면
 * 한 호출이 몇 분으로 늘어난다.
 */
const LOCAL_TRANSIENT = ['network', 'fetch failed'];

export interface ChatLlmRetryContext {
  provider: ChatLlmProvider;
  model: string;
  transient: 'cloud' | 'local';
}

export async function retryChatLlmCall<T>(
  retryManager: IRetryManager,
  context: ChatLlmRetryContext,
  call: () => Promise<T>,
): Promise<T> {
  const patterns = context.transient === 'cloud' ? CLOUD_TRANSIENT : LOCAL_TRANSIENT;
  const retryOptions = getRetryOptions();

  return retryManager.retry(call, {
    maxAttempts: retryOptions.external_api.maxAttempts,
    baseDelay: retryOptions.external_api.baseDelay,
    shouldRetry: (error: Error) => {
      const message = error.message.toLowerCase();
      return patterns.some((pattern) => message.includes(pattern));
    },
    onRetry: (error: Error, attempt: number, delay: number) => {
      logger.warn('LLM 호출 재시도', {
        provider: context.provider,
        model: context.model,
        attempt,
        delay,
        error: error.message,
      });
    },
  });
}
