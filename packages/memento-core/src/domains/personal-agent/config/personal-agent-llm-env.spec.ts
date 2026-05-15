import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parsePersonalAgentLlmEnv } from './personal-agent-llm-env.js';
import { PersonalAgentLlmError } from '../errors/personal-agent-llm-error.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('parsePersonalAgentLlmEnv', () => {
  it('defaults to mock when provider unset', () => {
    delete process.env.MEMENTO_PERSONAL_AGENT_LLM_PROVIDER;
    expect(parsePersonalAgentLlmEnv(process.env)).toEqual({ provider: 'mock' });
  });

  it('defaults to mock when provider is empty string', () => {
    process.env.MEMENTO_PERSONAL_AGENT_LLM_PROVIDER = '   ';
    expect(parsePersonalAgentLlmEnv(process.env)).toEqual({ provider: 'mock' });
  });

  it('throws when openai is selected without api key', () => {
    process.env.MEMENTO_PERSONAL_AGENT_LLM_PROVIDER = 'openai';
    expect(() => parsePersonalAgentLlmEnv(process.env, {})).toThrow(PersonalAgentLlmError);
    try {
      parsePersonalAgentLlmEnv(process.env, {});
    } catch (e) {
      expect(e).toBeInstanceOf(PersonalAgentLlmError);
      expect((e as PersonalAgentLlmError).code).toBe('provider_misconfigured');
    }
  });

  it('returns openai when key is injected', () => {
    process.env.MEMENTO_PERSONAL_AGENT_LLM_PROVIDER = 'openai';
    const result = parsePersonalAgentLlmEnv(process.env, {
      openaiApiKey: 'sk-test',
    });
    expect(result).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
  });

  it('throws when gemini is selected without api key', () => {
    process.env.MEMENTO_PERSONAL_AGENT_LLM_PROVIDER = 'gemini';
    expect(() => parsePersonalAgentLlmEnv(process.env, {})).toThrow(PersonalAgentLlmError);
  });

  it('returns gemini when key is injected', () => {
    process.env.MEMENTO_PERSONAL_AGENT_LLM_PROVIDER = 'gemini';
    const result = parsePersonalAgentLlmEnv(process.env, {
      geminiApiKey: 'AIza-test',
    });
    expect(result).toEqual({ provider: 'gemini', model: 'gemini-2.0-flash' });
  });

  it('throws when ollama is selected without model', () => {
    process.env.MEMENTO_PERSONAL_AGENT_LLM_PROVIDER = 'ollama';
    delete process.env.MEMENTO_PERSONAL_AGENT_OLLAMA_MODEL;
    expect(() =>
      parsePersonalAgentLlmEnv(process.env, {
        openaiApiKey: 'x',
      }),
    ).toThrow(PersonalAgentLlmError);
  });

  it('returns ollama when model is set', () => {
    process.env.MEMENTO_PERSONAL_AGENT_LLM_PROVIDER = 'ollama';
    process.env.MEMENTO_PERSONAL_AGENT_OLLAMA_MODEL = 'llama3.2';
    const result = parsePersonalAgentLlmEnv(process.env);
    expect(result).toEqual({
      provider: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'llama3.2',
    });
  });

  it('throws on invalid provider token', () => {
    process.env.MEMENTO_PERSONAL_AGENT_LLM_PROVIDER = 'azure';
    expect(() => parsePersonalAgentLlmEnv(process.env)).toThrow(PersonalAgentLlmError);
  });
});
