import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMOptions } from './llm-provider.js';
import type { Message } from '../../core/types.js';

export class ClaudeProvider implements LLMProvider {
  private client: Anthropic;

  constructor(apiKey: string, private model = 'claude-sonnet-4-6') {
    this.client = new Anthropic({ apiKey });
  }

  async complete(messages: Message[], options?: LLMOptions): Promise<string> {
    const systemMsg = messages.find((m) => m.role === 'system');
    const userMessages = messages.filter((m) => m.role !== 'system');

    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: 1024,
        system: systemMsg?.content,
        messages: userMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      },
      { timeout: options?.timeoutMs ?? 30000 }
    );

    const block = response.content.find((c) => c.type === 'text');
    return block?.type === 'text' ? block.text : '';
  }
}
