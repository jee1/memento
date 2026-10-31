import { GoogleGenAI } from '@google/genai';
import type { ILLMPort, LLMCompletionResult, LLMMessage } from '../ports/llm-port.js';
import { PersonalAgentLlmError } from '../errors/personal-agent-llm-error.js';
import { classifyLlmAttemptOutcome } from '../../../shared/services/llm-usage/llm-usage-classify.js';
import { recordLlmUsageAttempt } from '../../../shared/services/llm-usage/llm-usage-recorder.js';

export type GeminiChatLlmAdapterOptions = {
  apiKey: string;
  model: string;
};

export class GeminiChatLlmAdapter implements ILLMPort {
  private readonly genAI: GoogleGenAI;
  private readonly modelName: string;

  constructor(options: GeminiChatLlmAdapterOptions) {
    this.modelName = options.model;
    this.genAI = new GoogleGenAI({ apiKey: options.apiKey });
  }

  async complete(messages: LLMMessage[]): Promise<LLMCompletionResult> {
    try {
      const system = messages.find((m) => m.role === 'system')?.content ?? '';
      const rest = messages.filter((m) => m.role !== 'system');
      const prompt = [system, ...rest.map((m) => `${m.role}: ${m.content}`)]
        .filter((s) => s.length > 0)
        .join('\n\n');

      const result = await this.genAI.models.generateContent({
        model: this.modelName,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });
      const text = result.text;
      if (!text) {
        throw new Error('Gemini response is empty');
      }
      recordLlmUsageAttempt({
        provider: 'gemini',
        model: this.modelName,
        outcome: 'success',
        attemptCoverage: 'full',
        inputTokens: 'unknown',
        outputTokens: 'unknown',
      });
      return {
        content: text,
        metadata: {
          provider: 'gemini',
          model: this.modelName,
          finishReason: undefined,
        },
      };
    } catch (cause) {
      recordLlmUsageAttempt({
        provider: 'gemini',
        model: this.modelName,
        outcome: classifyLlmAttemptOutcome(cause),
        failureReason: cause instanceof Error ? cause.message.slice(0, 120) : String(cause).slice(0, 120),
        attemptCoverage: 'full',
        inputTokens: 'unknown',
        outputTokens: 'unknown',
      });
      throw new PersonalAgentLlmError({
        code: 'provider_runtime_failed',
        message: 'Gemini generateContent failed',
        cause,
      });
    }
  }
}
