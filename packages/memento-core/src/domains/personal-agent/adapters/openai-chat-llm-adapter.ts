import OpenAI from 'openai';
import type { ILLMPort, LLMCompletionResult, LLMMessage } from '../ports/llm-port.js';
import { PersonalAgentLlmError } from '../errors/personal-agent-llm-error.js';
import { classifyLlmAttemptOutcome } from '../../../shared/services/llm-usage/llm-usage-classify.js';
import { recordLlmUsageAttempt } from '../../../shared/services/llm-usage/llm-usage-recorder.js';

export type OpenAiChatLlmAdapterOptions = {
  apiKey: string;
  model: string;
  timeoutMs?: number;
};

export class OpenAiChatLlmAdapter implements ILLMPort {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAiChatLlmAdapterOptions) {
    this.client = new OpenAI({ apiKey: options.apiKey, timeout: options.timeoutMs ?? 60_000 });
    this.model = options.model;
  }

  async complete(messages: LLMMessage[]): Promise<LLMCompletionResult> {
    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages,
      });
      const raw = completion.choices[0]?.message?.content;
      const text = raw === null || raw === undefined ? '' : raw;
      recordLlmUsageAttempt({
        provider: 'openai',
        model: this.model,
        outcome: 'success',
        attemptCoverage: 'full',
        inputTokens: 'unknown',
        outputTokens: 'unknown',
      });
      return {
        content: text,
        metadata: {
          provider: 'openai',
          model: this.model,
          requestId: completion.id,
          finishReason: completion.choices[0]?.finish_reason ?? undefined,
        },
      };
    } catch (cause) {
      recordLlmUsageAttempt({
        provider: 'openai',
        model: this.model,
        outcome: classifyLlmAttemptOutcome(cause),
        failureReason: cause instanceof Error ? cause.message.slice(0, 120) : String(cause).slice(0, 120),
        attemptCoverage: 'full',
        inputTokens: 'unknown',
        outputTokens: 'unknown',
      });
      throw new PersonalAgentLlmError({
        code: 'provider_runtime_failed',
        message: 'OpenAI chat completion failed',
        cause,
      });
    }
  }
}
