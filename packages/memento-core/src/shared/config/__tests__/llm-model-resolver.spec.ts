import { describe, expect, it } from 'vitest';
import {
  resolveBoundLlmProvider,
  resolveLlmModel,
  resolveLlmProvider,
  type LlmModelConfigSlice,
} from '../llm-model-resolver.js';

const baseConfig: LlmModelConfigSlice = {
  openaiLlmModel: 'gpt-4o',
  geminiLlmModel: 'gemini-3-flash-preview',
  ollamaModel: 'qwen3:latest',
  llmModelOverrides: {},
};

describe('resolveLlmProvider', () => {
  it('returns override when set', () => {
    const config = {
      llmProvider: 'openai' as const,
      llmProviderOverrides: { triple_extraction: 'ollama' as const },
    };
    expect(resolveLlmProvider('triple_extraction', config)).toBe('ollama');
  });

  it('falls back to global when override unset', () => {
    const config = { llmProvider: 'gemini' as const, llmProviderOverrides: {} };
    expect(resolveLlmProvider('relation_extraction', config)).toBe('gemini');
  });

  it('falls back to global when llmProviderOverrides is undefined', () => {
    const config = { llmProvider: 'gemini' as const };
    expect(resolveLlmProvider('relation_extraction', config)).toBe('gemini');
  });

  it('override equal to global is valid no-op', () => {
    const config = {
      llmProvider: 'openai' as const,
      llmProviderOverrides: { procedural: 'openai' as const },
    };
    expect(resolveLlmProvider('procedural', config)).toBe('openai');
  });
});

describe('resolveBoundLlmProvider', () => {
  it('returns concrete requested provider', () => {
    const config = {
      llmProvider: 'openai' as const,
      llmProviderOverrides: { triple_extraction: 'gemini' as const },
    };
    expect(resolveBoundLlmProvider('triple_extraction', 'openai', config)).toBe('gemini');
  });

  it('returns initPreferred when requested is auto', () => {
    const config = {
      llmProvider: 'auto' as const,
      llmProviderOverrides: {},
    };
    expect(resolveBoundLlmProvider('triple_extraction', 'openai', config)).toBe('openai');
    expect(resolveBoundLlmProvider('triple_extraction', null, config)).toBeNull();
  });
});

describe('resolveLlmModel', () => {
  it('returns provider LLM default when no use-case override', () => {
    expect(resolveLlmModel('openai', undefined, baseConfig)).toBe('gpt-4o');
    expect(resolveLlmModel('gemini', undefined, baseConfig)).toBe('gemini-3-flash-preview');
    expect(resolveLlmModel('ollama', undefined, baseConfig)).toBe('qwen3:latest');
  });

  it('applies use-case override only when runtime equals bound', () => {
    const config: LlmModelConfigSlice = {
      ...baseConfig,
      llmModelOverrides: {
        triple_extraction: 'cheap-mini-model',
      },
    };
    expect(
      resolveLlmModel('gemini', 'triple_extraction', config, { boundProvider: 'gemini' })
    ).toBe('cheap-mini-model');
  });

  it('discards override when runtime differs from bound and logs once', () => {
    const discarded: unknown[] = [];
    const config: LlmModelConfigSlice = {
      ...baseConfig,
      llmModelOverrides: { triple_extraction: 'gpt-cloud-only' },
    };
    expect(
      resolveLlmModel('ollama', 'triple_extraction', config, {
        boundProvider: 'openai',
        onModelOverrideDiscarded: (i) => discarded.push(i),
      })
    ).toBe(baseConfig.ollamaModel || 'llama3');
    expect(discarded).toHaveLength(1);
  });

  it('treats whitespace model override as unset', () => {
    const config: LlmModelConfigSlice = {
      ...baseConfig,
      llmModelOverrides: { procedural: '   ' },
    };
    expect(
      resolveLlmModel('openai', 'procedural', config, { boundProvider: 'openai' })
    ).toBe(baseConfig.openaiLlmModel || 'gpt-4o-mini');
  });

  it('skips override when boundProvider is null (auto + no preferred)', () => {
    const config: LlmModelConfigSlice = {
      ...baseConfig,
      llmModelOverrides: { relation_extraction: 'should-not-leak' },
    };
    expect(
      resolveLlmModel('gemini', 'relation_extraction', config, { boundProvider: null })
    ).not.toBe('should-not-leak');
  });

  it('does not apply override when useCase set but options omitted', () => {
    const config: LlmModelConfigSlice = {
      ...baseConfig,
      llmModelOverrides: { triple_extraction: 'cheap-mini-model' },
    };
    expect(resolveLlmModel('gemini', 'triple_extraction', config)).toBe('gemini-3-flash-preview');
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
