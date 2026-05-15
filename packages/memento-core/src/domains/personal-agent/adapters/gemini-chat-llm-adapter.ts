import { GoogleGenerativeAI } from '@google/generative-ai';
import type { GenerativeModel } from '@google/generative-ai';
import type { ILLMPort, LLMCompletionResult, LLMMessage } from '../ports/llm-port.js';
import { PersonalAgentLlmError } from '../errors/personal-agent-llm-error.js';

export type GeminiChatLlmAdapterOptions = {
  apiKey: string;
  model: string;
};

export class GeminiChatLlmAdapter implements ILLMPort {
  private readonly generativeModel: GenerativeModel;
  private readonly modelName: string;

  constructor(options: GeminiChatLlmAdapterOptions) {
    this.modelName = options.model;
    const genAI = new GoogleGenerativeAI(options.apiKey);
    this.generativeModel = genAI.getGenerativeModel({ model: options.model });
  }

  async complete(messages: LLMMessage[]): Promise<LLMCompletionResult> {
    try {
      const system = messages.find((m) => m.role === 'system')?.content ?? '';
      const rest = messages.filter((m) => m.role !== 'system');
      const prompt = [system, ...rest.map((m) => `${m.role}: ${m.content}`)]
        .filter((s) => s.length > 0)
        .join('\n\n');

      const result = await this.generativeModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });
      const text = result.response.text();
      return {
        content: text,
        metadata: {
          provider: 'gemini',
          model: this.modelName,
          finishReason: undefined,
        },
      };
    } catch (cause) {
      throw new PersonalAgentLlmError({
        code: 'provider_runtime_failed',
        message: 'Gemini generateContent failed',
        cause,
      });
    }
  }
}
