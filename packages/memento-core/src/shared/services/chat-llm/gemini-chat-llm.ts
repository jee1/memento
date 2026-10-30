import type { GoogleGenAI } from '@google/genai';
import type { IRetryManager } from '../../interfaces/retry-manager.interface.js';
import type { ChatLlmPort, ChatLlmRequest, ChatLlmResult } from './chat-llm-port.js';
import { retryChatLlmCall } from './chat-llm-retry.js';

/** usage 를 주지 않는 응답의 토큰 추정 비율(문자 수 기준). 비용 로깅 전용이다. */
const CHARS_PER_TOKEN = 4;

export class GeminiChatLlm implements ChatLlmPort {
  readonly provider = 'gemini' as const;

  constructor(
    private readonly client: GoogleGenAI,
    private readonly retryManager: IRetryManager,
  ) {}

  async complete(request: ChatLlmRequest): Promise<ChatLlmResult> {
    const systemInstruction = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');
    const contents = request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      }));

    const result = await retryChatLlmCall(
      this.retryManager,
      { provider: this.provider, model: request.model, transient: 'cloud' },
      () =>
        this.client.models.generateContent({
          model: request.model,
          contents,
          config: {
            temperature: request.temperature,
            maxOutputTokens: request.maxOutputTokens,
            // 사고 모델은 사고 토큰이 maxOutputTokens 를 먹어 응답이 MAX_TOKENS 로 잘린다.
            thinkingConfig: { thinkingBudget: 0 },
            ...(systemInstruction.length > 0 ? { systemInstruction } : {}),
            ...(request.json ? { responseMimeType: 'application/json' } : {}),
          },
        }),
    );

    const content = result.text;
    if (!content) {
      throw new Error('Gemini 응답이 비어있습니다.');
    }

    const promptChars = request.messages.reduce((total, message) => total + message.content.length, 0);
    return {
      content,
      usage: {
        promptTokens: Math.ceil(promptChars / CHARS_PER_TOKEN),
        completionTokens: Math.ceil(content.length / CHARS_PER_TOKEN),
      },
    };
  }
}
