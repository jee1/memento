import type { Message } from '../../core/types.js';

export interface LLMOptions {
  timeoutMs?: number;
}

export interface LLMProvider {
  complete(messages: Message[], options?: LLMOptions): Promise<string>;
}
