import type { LLMProvider } from './llm-provider.js';
import { ClaudeProvider } from './claude-provider.js';

export function createLLMProvider(): LLMProvider {
  const name = process.env.MEMENTO_AGENT_LLM ?? 'claude';
  switch (name) {
    case 'claude':
      return new ClaudeProvider(process.env.ANTHROPIC_API_KEY ?? '');
    case 'openai':
      throw new Error('OpenAI provider not yet implemented (Phase 4)');
    case 'ollama':
      throw new Error('Ollama provider not yet implemented (Phase 4)');
    default:
      throw new Error(`Unknown LLM provider: ${name}`);
  }
}
