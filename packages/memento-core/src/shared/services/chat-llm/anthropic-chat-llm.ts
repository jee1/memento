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

/** 연결 오류, 시간 초과, 5xx(529 overloaded 포함)만 다시 보낸다. 429 는 다시 보내지 않아 스캔이 첫 429 에서 멈춘다. */
export function isRetryableAnthropicError(error: Error): boolean {
  if (error instanceof Anthropic.APIConnectionError) {
    return true;
  }
  return error instanceof Anthropic.APIError && typeof error.status === 'number' && error.status >= 500;
}

/**
 * Claude 채팅 어댑터 (#1840).
 * temperature 는 보내지 않는다. Haiku 5.5 이후 모델은 기본값이 아닌 sampling 값을 400 으로 거절한다.
 * thinking 은 adaptive, effort medium. 운영 213쌍에서 thinking 끔보다 판정이 나았다(판정자 일치 15쌍 중 12 대 8).
 * thinking 토큰도 maxOutputTokens 에 들어가므로 호출부는 상한을 넉넉히 준다.
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
      { provider: this.provider, model: request.model, transient: 'cloud', shouldRetry: isRetryableAnthropicError },
      () =>
        this.client.messages.create(
          {
          model: request.model,
          max_tokens: request.maxOutputTokens,
          messages,
          ...(system.length > 0 ? { system } : {}),
          thinking: { type: 'adaptive' },
          output_config: {
            effort: 'medium',
            ...(request.jsonSchema ? { format: { type: 'json_schema' as const, schema: request.jsonSchema } } : {}),
          },
          },
          request.timeoutMs !== undefined ? { timeout: request.timeoutMs } : undefined,
        ),
    );

    // 거절과 상한 도달은 토큰이 청구되지만 쓸 답이 없다. 실패로 세고 까닭을 남긴다.
    const unusable =
      response.stop_reason === 'refusal' ? 'refusal' : response.stop_reason === 'max_tokens' ? 'max_tokens' : null;
    recordLlmUsageAttempt({
      provider: this.provider,
      model: request.model,
      outcome: unusable ? 'failure' : 'success',
      ...(unusable ? { failureReason: unusable } : {}),
      attemptCoverage: 'full',
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs,
    });
    if (unusable === 'refusal') {
      throw new Error('Anthropic 응답이 거절(refusal)로 끝났습니다.');
    }
    if (unusable === 'max_tokens') {
      throw new Error(`Anthropic 응답이 출력 상한(${request.maxOutputTokens})에서 잘렸습니다(max_tokens).`);
    }
    const content = response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
    if (!content) {
      throw new Error('Anthropic 응답이 비었습니다.');
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
    // 429 를 SDK 가 몰래 다시 보내지 않게 한다. 재시도는 isRetryableAnthropicError 가 정한다.
    new Anthropic({ apiKey, maxRetries: 0, timeout: ANTHROPIC_TIMEOUT_MS }),
    new RetryManager({ ...retryOptions.external_api, maxErrorCount: retryOptions.default.maxErrorCount }),
  );
}
