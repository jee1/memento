import { describe, expect, it, vi } from 'vitest';
import {
  loadLlmProviderOverrideFromEnv,
  parseLlmProviderOverride,
} from '../llm-provider-override.js';

describe('parseLlmProviderOverride', () => {
  it('treats empty and whitespace as unset', () => {
    expect(parseLlmProviderOverride(undefined).value).toBeUndefined();
    expect(parseLlmProviderOverride('').value).toBeUndefined();
    expect(parseLlmProviderOverride('  ').value).toBeUndefined();
  });

  it('normalizes trim+lowercase', () => {
    expect(parseLlmProviderOverride('  OpenAI ').value).toBe('openai');
    expect(parseLlmProviderOverride('GEMINI').value).toBe('gemini');
  });

  it('marks unknown tokens invalid without value', () => {
    const r = parseLlmProviderOverride('anthropic');
    expect(r.value).toBeUndefined();
    expect(r.invalidRaw).toBeTruthy();
  });

  it('accepts auto and equals-global-compatible tokens', () => {
    expect(parseLlmProviderOverride('auto').value).toBe('auto');
    expect(parseLlmProviderOverride('ollama').value).toBe('ollama');
  });
});

describe('loadLlmProviderOverrideFromEnv', () => {
  it('emits CONFIG WARN once per env key for invalid values', () => {
    const warnedKeys = new Set<string>();
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    expect(
      loadLlmProviderOverrideFromEnv('LLM_PROVIDER_TRIPLE_EXTRACTION', 'anthropic', warnedKeys)
    ).toBeUndefined();
    expect(
      loadLlmProviderOverrideFromEnv('LLM_PROVIDER_TRIPLE_EXTRACTION', 'anthropic', warnedKeys)
    ).toBeUndefined();

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(String(stderrSpy.mock.calls[0]?.[0])).toContain('[CONFIG WARN]');
    expect(String(stderrSpy.mock.calls[0]?.[0])).toContain('LLM_PROVIDER_TRIPLE_EXTRACTION');

    stderrSpy.mockRestore();
  });
});
