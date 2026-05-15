import { describe, expect, it } from 'vitest';
import { createPersonalAgentLlmPort } from './create-personal-agent-llm-port.js';
import { PersonalAgentLlmError } from '../errors/personal-agent-llm-error.js';
import type { ILLMPort } from '../ports/llm-port.js';

describe('createPersonalAgentLlmPort', () => {
  it('returns DeterministicMockLlmAdapter for mock', async () => {
    const llm = createPersonalAgentLlmPort({ provider: 'mock' });
    const out = await llm.complete([{ role: 'user', content: 'hi' }]);
    expect(out.metadata.provider).toBe('mock');
    expect(out.content).toContain('Mock response:');
  });

  it('uses createOpenAi when provided', async () => {
    const stub: ILLMPort = {
      async complete() {
        return {
          content: 'from-stub',
          metadata: { provider: 'openai', model: 'stub-model' },
        };
      },
    };
    const llm = createPersonalAgentLlmPort(
      { provider: 'openai', model: 'gpt-4o-mini' },
      {
        createOpenAi: () => stub,
      },
    );
    const out = await llm.complete([]);
    expect(out.content).toBe('from-stub');
    expect(out.metadata.provider).toBe('openai');
  });

  it('throws when openai is requested without factory', () => {
    expect(() =>
      createPersonalAgentLlmPort({ provider: 'openai', model: 'gpt-4o-mini' }),
    ).toThrow(PersonalAgentLlmError);
  });

  it('throws when gemini is requested without factory', () => {
    expect(() =>
      createPersonalAgentLlmPort({ provider: 'gemini', model: 'gemini-2.0-flash' }),
    ).toThrow(PersonalAgentLlmError);
  });

  it('throws when ollama is requested without factory', () => {
    expect(() =>
      createPersonalAgentLlmPort({
        provider: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'llama3.2',
      }),
    ).toThrow(PersonalAgentLlmError);
  });
});
