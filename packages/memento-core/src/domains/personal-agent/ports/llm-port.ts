export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ILLMPort {
  complete(messages: LLMMessage[]): Promise<string>;
}
