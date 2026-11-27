import { describe, expect, it } from 'vitest';
import { extractJsonObjectFromLlmText } from './llm-json.js';
import { determineLlmProvider } from './llm-provider-selection.js';

describe('relation LLM common primitives', () => {
  it('extracts the first balanced JSON object through fences, prose, and string braces', () => {
    expect(
      extractJsonObjectFromLlmText('```json\n{"value":"{escaped \\"}\\"}"}\n``` trailing'),
    ).toBe('{"value":"{escaped \\"}\\"}"}');
    expect(extractJsonObjectFromLlmText('before {"ok":true} after {"ignored":true}')).toBe(
      '{"ok":true}',
    );
  });

  it('returns the remaining object text for legacy malformed-response diagnostics', () => {
    expect(extractJsonObjectFromLlmText('prefix {"open": true')).toBe('{"open": true');
    expect(extractJsonObjectFromLlmText('no object')).toBeNull();
  });

  it('preserves relation and triple auto/fallback provider policies', () => {
    const availability = { openai: false, gemini: false, ollama: true };
    expect(determineLlmProvider('auto', availability)).toBe('ollama');
    expect(determineLlmProvider('auto', availability, { includeOllamaInAuto: false })).toBeNull();
    expect(
      determineLlmProvider('openai', { openai: false, gemini: true, ollama: true }),
    ).toBe('gemini');
    expect(
      determineLlmProvider('ollama', { openai: true, gemini: true, ollama: false }),
    ).toBe('openai');
    expect(
      determineLlmProvider('openai', availability, { includeOllamaInFallback: false }),
    ).toBeNull();
  });

  it('관계 추출 채팅 갈래는 anthropic 을 다른 제공자로 넘기지 않고 없음으로 본다 (#1840)', () => {
    const everything = { openai: true, gemini: true, ollama: true };
    expect(determineLlmProvider('anthropic' as 'openai', everything)).toBeNull();
  });
});
