import OpenAI from 'openai';
import type { ILLMPort, LLMCompletionResult, LLMMessage } from '../ports/llm-port.js';
import { PersonalAgentLlmError } from '../errors/personal-agent-llm-error.js';

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
      throw new PersonalAgentLlmError({
        code: 'provider_runtime_failed',
        message: 'OpenAI chat completion failed',
        cause,
      });
    }
  }
}
