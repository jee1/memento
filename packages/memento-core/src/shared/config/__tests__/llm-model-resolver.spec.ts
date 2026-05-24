import { describe, expect, it } from 'vitest';
import { resolveLlmModel, type LlmModelConfigSlice } from '../llm-model-resolver.js';

const baseConfig: LlmModelConfigSlice = {
  openaiLlmModel: 'gpt-4o',
  geminiLlmModel: 'gemini-3-flash-preview',
  ollamaModel: 'qwen3:latest',
  llmModelOverrides: {},
};

describe('resolveLlmModel', () => {
  it('returns provider LLM default when no use-case override', () => {
    expect(resolveLlmModel('openai', undefined, baseConfig)).toBe('gpt-4o');
    expect(resolveLlmModel('gemini', undefined, baseConfig)).toBe('gemini-3-flash-preview');
    expect(resolveLlmModel('ollama', undefined, baseConfig)).toBe('qwen3:latest');
  });

  it('prefers use-case override over provider default', () => {
    const config: LlmModelConfigSlice = {
      ...baseConfig,
      llmModelOverrides: {
        triple_extraction: 'cheap-mini-model',
      },
    };
    expect(resolveLlmModel('gemini', 'triple_extraction', config)).toBe('cheap-mini-model');
  });

  it('does not fall back to GEMINI_MODEL embedding name for gemini LLM', () => {
    const config: LlmModelConfigSlice = {
      openaiLlmModel: 'gpt-4o-mini',
      geminiLlmModel: '',
      ollamaModel: 'llama3',
      llmModelOverrides: {},
    };
    expect(resolveLlmModel('gemini', 'triple_extraction', config)).toBe('gemini-2.0-flash');
  });

  it('uses code fallback when provider LLM env is empty', () => {
    const config: LlmModelConfigSlice = {
      openaiLlmModel: '',
      geminiLlmModel: '',
      ollamaModel: '',
      llmModelOverrides: {},
    };
    expect(resolveLlmModel('openai', 'consolidation', config)).toBe('gpt-4o-mini');
    expect(resolveLlmModel('gemini', 'consolidation', config)).toBe('gemini-2.0-flash');
    expect(resolveLlmModel('ollama', 'procedural', config)).toBe('llama3');
  });
});
