import { DeterministicMockLlmAdapter } from '../adapters/deterministic-mock-llm-adapter.js';
import type { ParsedPersonalAgentLlmEnv } from '../config/personal-agent-llm-env.js';
import { PersonalAgentLlmError } from '../errors/personal-agent-llm-error.js';
import type { ILLMPort } from '../ports/llm-port.js';

export type CreatePersonalAgentLlmPortDeps = {
  createOpenAi?: (cfg: Extract<ParsedPersonalAgentLlmEnv, { provider: 'openai' }>) => ILLMPort;
  createGemini?: (cfg: Extract<ParsedPersonalAgentLlmEnv, { provider: 'gemini' }>) => ILLMPort;
  createOllama?: (cfg: Extract<ParsedPersonalAgentLlmEnv, { provider: 'ollama' }>) => ILLMPort;
};

export function createPersonalAgentLlmPort(
  parsed: ParsedPersonalAgentLlmEnv,
  deps: CreatePersonalAgentLlmPortDeps = {},
): ILLMPort {
  if (parsed.provider === 'mock') {
    return new DeterministicMockLlmAdapter();
  }

  if (parsed.provider === 'openai') {
    if (!deps.createOpenAi) {
      throw new PersonalAgentLlmError({
        code: 'provider_misconfigured',
        message: 'OpenAI adapter is not registered in this build path',
      });
    }
    return deps.createOpenAi(parsed);
  }

  if (parsed.provider === 'gemini') {
    if (!deps.createGemini) {
      throw new PersonalAgentLlmError({
        code: 'provider_misconfigured',
        message: 'Gemini adapter is not registered in this build path',
      });
    }
    return deps.createGemini(parsed);
  }

  if (!deps.createOllama) {
    throw new PersonalAgentLlmError({
      code: 'provider_misconfigured',
      message: 'Ollama adapter is not registered in this build path',
    });
  }
  return deps.createOllama(parsed);
}
