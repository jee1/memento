import { createHash } from 'node:crypto';
import type {
  ILLMPort,
  LLMCompletionResult,
  LLMMessage,
} from '../ports/llm-port.js';

interface DeterministicMockLlmAdapterOptions {
  model?: string;
  fixtures?: Record<string, string>;
}

export class DeterministicMockLlmAdapter implements ILLMPort {
  private readonly model: string;
  private readonly fixtures: Record<string, string>;

  constructor(options: DeterministicMockLlmAdapterOptions = {}) {
    this.model = options.model ?? 'deterministic-mock-v1';
    this.fixtures = options.fixtures ?? {};
  }

  async complete(messages: LLMMessage[]): Promise<LLMCompletionResult> {
    const requestId = this.createRequestId(messages);
    const content = this.fixtures[requestId] ?? `Mock response: ${requestId}`;

    return {
      content,
      metadata: {
        provider: 'mock',
        model: this.model,
        requestId,
        finishReason: 'stop',
      },
    };
  }

  private createRequestId(messages: LLMMessage[]): string {
    const stablePayload = JSON.stringify(
      messages.map((message) => ({
        role: message.role,
        // 저장 자료 경계 표시는 호출마다 바뀐다. 같은 입력이 같은 requestId 를 받도록 고정값으로 바꾼다.
        content: message.content.replace(/memento-material-[0-9a-f]{16}/g, 'memento-material-0'),
      })),
    );
    const digest = createHash('sha256')
      .update(stablePayload)
      .digest('hex')
      .slice(0, 16);

    return `mock-${digest}`;
  }
}
