export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMProviderMetadata {
  provider: 'mock' | 'openai' | 'gemini' | 'ollama';
  model?: string;
  requestId?: string;
  finishReason?: string;
}

export interface LLMCompletionResult {
  content: string;
  metadata: LLMProviderMetadata;
}

export interface ILLMPort {
  complete(messages: LLMMessage[]): Promise<LLMCompletionResult>;
}
