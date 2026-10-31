import type OpenAI from 'openai';
import type { IRetryManager } from '../../interfaces/retry-manager.interface.js';
import type { ChatLlmMessage, ChatLlmPort, ChatLlmRequest, ChatLlmResult } from './chat-llm-port.js';
import { coerceUsageField } from '../llm-usage/llm-usage-classify.js';
import { recordLlmUsageAttempt } from '../llm-usage/llm-usage-recorder.js';
import { retryChatLlmCall } from './chat-llm-retry.js';

type OpenAiMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function toOpenAiMessage(message: ChatLlmMessage): OpenAiMessage {
  if (message.role === 'system') {
    return { role: 'system', content: message.content };
  }
  if (message.role === 'assistant') {
    return { role: 'assistant', content: message.content };
  }
  return { role: 'user', content: message.content };
}

export class OpenAiChatLlm implements ChatLlmPort {
  readonly provider = 'openai' as const;

  constructor(
    private readonly client: OpenAI,
    private readonly retryManager: IRetryManager,
  ) {}

  async complete(request: ChatLlmRequest): Promise<ChatLlmResult> {
    const response = await retryChatLlmCall(
      this.retryManager,
      { provider: this.provider, model: request.model, transient: 'cloud', attemptCoverage: 'partial' },
      () =>
        this.client.chat.completions.create({
          model: request.model,
          messages: request.messages.map(toOpenAiMessage),
          temperature: request.temperature,
          // gpt-5.x 는 `max_tokens` 를 400 `Use 'max_completion_tokens'` 로 거절한다.
          // `max_completion_tokens` 는 그 세대와 이전 세대가 모두 받는다.
          max_completion_tokens: request.maxOutputTokens,
          ...(request.json ? { response_format: { type: 'json_object' as const } } : {}),
        }),
    );

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI 응답이 비어있습니다.');
    }

    const providerReported = response.usage != null;
    const promptTokens = coerceUsageField(response.usage?.prompt_tokens, providerReported);
    const completionTokens = coerceUsageField(response.usage?.completion_tokens, providerReported);
    recordLlmUsageAttempt({
      provider: this.provider,
      model: request.model,
      outcome: 'success',
      attemptCoverage: 'partial',
      inputTokens: promptTokens,
      outputTokens: completionTokens,
    });

    return {
      content,
      usage: {
        promptTokens: promptTokens === 'unknown' ? 0 : promptTokens,
        completionTokens: completionTokens === 'unknown' ? 0 : completionTokens,
      },
    };
  }
}
