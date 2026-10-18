import { describe, expect, it, vi } from 'vitest';
import {
  parseRelationExtractionOverride,
  resolveRelationExtractionSeat,
  warnInvalidRelationExtractionOverride,
} from '../relation-extraction-seat.js';

describe('parseRelationExtractionOverride', () => {
  it('treats missing and blank as unset', () => {
    expect(parseRelationExtractionOverride(undefined)).toEqual({ kind: 'unset' });
    expect(parseRelationExtractionOverride('')).toEqual({ kind: 'unset' });
    expect(parseRelationExtractionOverride('  ')).toEqual({ kind: 'unset' });
  });

  it('accepts jev and chat tokens', () => {
    expect(parseRelationExtractionOverride(' JEV ')).toEqual({ kind: 'jev' });
    expect(parseRelationExtractionOverride(' OpenAI ')).toEqual({ kind: 'chat', provider: 'openai' });
    expect(parseRelationExtractionOverride('auto')).toEqual({ kind: 'chat', provider: 'auto' });
  });

  it('keeps the trimmed original on an invalid token', () => {
    expect(parseRelationExtractionOverride(' Anthropic ')).toEqual({
      kind: 'invalid',
      raw: 'Anthropic',
    });
  });
});

describe('resolveRelationExtractionSeat', () => {
  it('does not read the global provider when the override is jev', () => {
    expect(resolveRelationExtractionSeat({
      llmProvider: 'openai',
      relationExtractionOverride: { kind: 'jev' },
    })).toEqual({ kind: 'jev' });
  });

  it('uses the chat override and otherwise the global provider', () => {
    expect(resolveRelationExtractionSeat({
      llmProvider: 'gemini',
      relationExtractionOverride: { kind: 'chat', provider: 'ollama' },
    })).toEqual({ kind: 'chat', provider: 'ollama' });
    expect(resolveRelationExtractionSeat({
      llmProvider: 'gemini',
      relationExtractionOverride: { kind: 'unset' },
    })).toEqual({ kind: 'chat', provider: 'gemini' });
    expect(resolveRelationExtractionSeat({
      llmProvider: 'gemini',
      relationExtractionOverride: { kind: 'invalid', raw: 'nope' },
    })).toEqual({ kind: 'chat', provider: 'gemini' });
  });
});

describe('warnInvalidRelationExtractionOverride', () => {
  it('warns once for an invalid token and stays quiet for jev', () => {
    const warnedKeys = new Set<string>();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const invalid = parseRelationExtractionOverride('anthropic');

    warnInvalidRelationExtractionOverride(invalid, warnedKeys);
    warnInvalidRelationExtractionOverride(invalid, warnedKeys);
    warnInvalidRelationExtractionOverride({ kind: 'jev' }, warnedKeys);

    expect(stderr).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls[0]?.[0])).toContain('[CONFIG WARN]');
    expect(String(stderr.mock.calls[0]?.[0])).toContain('LLM_PROVIDER_RELATION_EXTRACTION');
    expect(String(stderr.mock.calls[0]?.[0])).toContain('anthropic');
    stderr.mockRestore();
  });
});
