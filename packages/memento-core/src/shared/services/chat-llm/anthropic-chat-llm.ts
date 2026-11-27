import Anthropic from '@anthropic-ai/sdk';
import { mementoConfig } from '../../config/index.js';
import { getRetryOptions } from '../../config/retry-options-loader.js';
import type { IRetryManager } from '../../interfaces/retry-manager.interface.js';
import { RetryManager } from '../../utils/retry-manager.js';
import { recordLlmUsageAttempt } from '../llm-usage/llm-usage-recorder.js';
import type { ChatLlmPort, ChatLlmRequest, ChatLlmResult } from './chat-llm-port.js';
import { retryChatLlmCall } from './chat-llm-retry.js';

/** #1840: 판정과 추출은 짧은 배치 호출이다. SDK 기본 10분 대신 짧게 끊는다. */
const ANTHROPIC_TIMEOUT_MS = 30_000;

/**
 * Claude 채팅 어댑터 (#1840).
 * temperature 는 보내지 않는다. Haiku 5.5 이후 모델은 기본값이 아닌 sampling 값을 400 으로 거절한다.
 * thinking 은 끈다(Haiku 5.5 는 effort high 이하에서만 disabled 를 받는다). 그래서 ANTHROPIC_LLM_MODEL 은
 * thinking 을 끌 수 있는 모델이어야 한다.
 */
export class AnthropicChatLlm implements ChatLlmPort {
  readonly provider = 'anthropic' as const;

  constructor(
    private readonly client: Anthropic,
    private readonly retryManager: IRetryManager,
  ) {}

  async complete(request: ChatLlmRequest): Promise<ChatLlmResult> {
    const system = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');
    const messages = request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content }));

    const { value: response, latencyMs } = await retryChatLlmCall(
      this.retryManager,
      { provider: this.provider, model: request.model, transient: 'cloud' },
      () =>
        this.client.messages.create({
          model: request.model,
          max_tokens: request.maxOutputTokens,
          messages,
          ...(system.length > 0 ? { system } : {}),
          thinking: { type: 'disabled' },
          output_config: {
            effort: 'low',
            ...(request.jsonSchema ? { format: { type: 'json_schema' as const, schema: request.jsonSchema } } : {}),
          },
        }),
    );

    recordLlmUsageAttempt({
      provider: this.provider,
      model: request.model,
      outcome: 'success',
      attemptCoverage: 'full',
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs,
    });

    if (response.stop_reason === 'refusal') {
      throw new Error('Anthropic 응답이 거절(refusal)로 끝났습니다.');
    }
    const content = response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
    if (!content) {
      throw new Error('Anthropic 응답이 비어있습니다.');
    }
    return {
      content,
      usage: { promptTokens: response.usage.input_tokens, completionTokens: response.usage.output_tokens },
    };
  }
}

/** 키가 없거나 오프라인 엄격 모드면 null. 다른 제공자 클라이언트는 만들지 않는다. */
export function createAnthropicChatLlm(): AnthropicChatLlm | null {
  const apiKey = mementoConfig.anthropicApiKey?.trim();
  if (mementoConfig.offlineStrict || !apiKey) {
    return null;
  }
  const retryOptions = getRetryOptions();
  return new AnthropicChatLlm(
    // 429 를 SDK 가 몰래 다시 보내지 않게 한다. 재시도는 retryChatLlmCall 이 정하고 429 는 하지 않는다.
    new Anthropic({ apiKey, maxRetries: 0, timeout: ANTHROPIC_TIMEOUT_MS }),
    new RetryManager({ ...retryOptions.external_api, maxErrorCount: retryOptions.default.maxErrorCount }),
  );
}
