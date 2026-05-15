import type { ILLMPort, LLMCompletionResult, LLMMessage } from '../ports/llm-port.js';
import { PersonalAgentLlmError } from '../errors/personal-agent-llm-error.js';

export type OllamaChatLlmAdapterOptions = {
  baseUrl: string;
  model: string;
  /** 기본 120초 */
  timeoutMs?: number;
};

type OllamaChatResponseJson = {
  message?: { role?: string; content?: string };
};

export class OllamaChatLlmAdapter implements ILLMPort {
  private readonly chatUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: OllamaChatLlmAdapterOptions) {
    const base = options.baseUrl.trim().replace(/\/+$/, '');
    this.chatUrl = new URL('/api/chat', `${base}/`).toString();
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async complete(messages: LLMMessage[]): Promise<LLMCompletionResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.chatUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new PersonalAgentLlmError({
          code: 'provider_runtime_failed',
          message: `Ollama HTTP ${res.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`,
        });
      }

      let body: OllamaChatResponseJson;
      try {
        body = (await res.json()) as OllamaChatResponseJson;
      } catch (cause) {
        throw new PersonalAgentLlmError({
          code: 'provider_runtime_failed',
          message: 'Ollama response JSON parse failed',
          cause,
        });
      }

      const text = body.message?.content ?? '';
      return {
        content: text,
        metadata: {
          provider: 'ollama',
          model: this.model,
          finishReason: undefined,
        },
      };
    } catch (cause) {
      if (cause instanceof PersonalAgentLlmError) {
        throw cause;
      }
      throw new PersonalAgentLlmError({
        code: 'provider_runtime_failed',
        message: 'Ollama chat request failed',
        cause,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
