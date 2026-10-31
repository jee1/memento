import { resolveLlmModel } from '../../../shared/config/llm-model-resolver.js';
import { mementoConfig } from '../../../shared/config/index.js';
import { getRetryOptions } from '../../../shared/config/retry-options-loader.js';
import type { ChatLlmPort } from '../../../shared/services/chat-llm/chat-llm-port.js';
import { GeminiChatLlm } from '../../../shared/services/chat-llm/gemini-chat-llm.js';
import { OpenAiChatLlm } from '../../../shared/services/chat-llm/openai-chat-llm.js';
import { LLMClientInitializer } from '../../../shared/services/llm-client-initializer.js';
import { getSelectedProvider } from '../../../shared/services/llm-client-initializer/shared-helpers.js';
import { logger } from '../../../shared/utils/logger.js';
import { RetryManager } from '../../../shared/utils/retry-manager.js';

/**
 * 설정된 provider 하나의 클라이언트만 쓴다. 그 provider 가 없으면 다른 provider 로 넘어가지 않고 null 이다.
 * 'auto' 일 때만 초기화기가 고른 preferredProvider 를 따른다. ollama 는 판정 품질을 재지 않아 쓰지 않는다.
 */
export async function resolveSupersedeLlm(): Promise<{ port: ChatLlmPort; model: string } | null> {
  if (mementoConfig.offlineStrict) {
    return null;
  }
  try {
    const clients = await new LLMClientInitializer().initialize();
    const requested = getSelectedProvider();
    const provider = requested === 'auto' ? clients.preferredProvider : requested;
    const retryOptions = getRetryOptions();
    const retryManager = new RetryManager({
      ...retryOptions.external_api,
      maxErrorCount: retryOptions.default.maxErrorCount,
    });
    if (provider === 'gemini' && clients.geminiClient) {
      return { port: new GeminiChatLlm(clients.geminiClient, retryManager), model: resolveLlmModel('gemini') };
    }
    if (provider === 'openai' && clients.openaiClient) {
      return { port: new OpenAiChatLlm(clients.openaiClient, retryManager), model: resolveLlmModel('openai') };
    }
    return null;
  } catch (error) {
    logger.warn('supersede LLM 초기화 실패', { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}
