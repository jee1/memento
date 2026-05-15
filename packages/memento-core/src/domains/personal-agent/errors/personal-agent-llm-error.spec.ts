import { describe, expect, it } from 'vitest';
import {
  PersonalAgentLlmError,
  isPersonalAgentLlmError,
} from './personal-agent-llm-error.js';

describe('PersonalAgentLlmError', () => {
  it('exposes provider_misconfigured code', () => {
    const err = new PersonalAgentLlmError({
      code: 'provider_misconfigured',
      message: 'OPENAI_API_KEY is missing',
    });
    expect(err.code).toBe('provider_misconfigured');
    expect(isPersonalAgentLlmError(err)).toBe(true);
  });

  it('narrows unknown', () => {
    expect(isPersonalAgentLlmError(new Error('x'))).toBe(false);
  });
});
