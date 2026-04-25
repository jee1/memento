import type { LLMProvider, LLMOptions } from './llm-provider.js';
import type { Message } from '../../core/types.js';

export class NoopLLMProvider implements LLMProvider {
  constructor(private readonly fixedResponse = 'noop') {}

  async complete(_messages: Message[], _options?: LLMOptions): Promise<string> {
    return this.fixedResponse;
  }
}
