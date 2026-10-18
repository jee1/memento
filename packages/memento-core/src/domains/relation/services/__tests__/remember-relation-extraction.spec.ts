import { afterEach, describe, expect, it, vi } from 'vitest';
import { LLMClientInitializer } from '../../../../shared/services/llm-client-initializer.js';
import type { MemoryItem } from '../../../../shared/types/memory.types.js';
import { LLMBasedRelationExtractor } from '../llm-based-relation-extractor.js';
import { RelationExtractor } from '../relation-extractor.js';
import { extractForRemember } from '../remember-relation-extraction.js';

const originalFetch = globalThis.fetch;

function memory(id: string, content: string): MemoryItem {
  return {
    id,
    type: 'episodic',
    content,
    importance: 0.5,
    privacy_scope: 'private',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    pinned: false,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('extractForRemember', () => {
  it('extracts with jev when chat clients are unavailable', async () => {
    const chatInit = vi.spyOn(LLMClientInitializer.prototype, 'initialize');
    const chatReady = vi.spyOn(LLMBasedRelationExtractor.prototype, 'isAvailableAsync').mockResolvedValue(false);
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { answers: { r0: { noul: 0.9 } } }))
      .mockResolvedValueOnce(jsonResponse(200, { answers: { y0_CAUSES: { noul: 0.8 } } }));

    const outcome = await extractForRemember(
      memory('new', '원인'),
      [memory('old', '결과')],
      {
        llmProvider: 'openai',
        relationExtractionOverride: { kind: 'jev' },
        typesafeApiKey: 'typesafe-key',
        typesafeModel: 'jev-latest',
      },
    );

    expect(outcome.status).toBe('extracted');
    if (outcome.status === 'extracted') {
      expect(outcome.candidates).toEqual([expect.objectContaining({
        source_id: 'new',
        target_id: 'old',
        relation_type: 'CAUSES',
        confidence: 0.8,
        method: 'jev',
      })]);
    }
    expect(chatReady).not.toHaveBeenCalled();
    expect(chatInit).not.toHaveBeenCalled();
  });

  it('is unavailable without a typesafe key and does not call Jev', async () => {
    globalThis.fetch = vi.fn();

    await expect(extractForRemember(
      memory('new', '원인'),
      [memory('old', '결과')],
      {
        llmProvider: 'openai',
        relationExtractionOverride: { kind: 'jev' },
        typesafeApiKey: '  ',
        typesafeModel: 'jev-latest',
      },
    )).resolves.toEqual({ status: 'unavailable' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('soft-fails a Jev timeout and does not throw', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));

    await expect(extractForRemember(
      memory('new', '원인'),
      [memory('old', '결과')],
      {
        llmProvider: 'auto',
        relationExtractionOverride: { kind: 'jev' },
        typesafeApiKey: 'typesafe-key',
        typesafeModel: 'jev-latest',
      },
    )).resolves.toEqual({ status: 'failed', reason: 'timeout' });
  });

  it('maps a thrown chat extraction to chat_failed', async () => {
    vi.spyOn(LLMBasedRelationExtractor.prototype, 'isAvailableAsync').mockResolvedValue(true);
    vi.spyOn(RelationExtractor.prototype, 'extractRelations').mockRejectedValue(new Error('429'));

    await expect(extractForRemember(
      memory('new', '원인'),
      [memory('old', '결과')],
      {
        llmProvider: 'gemini',
        relationExtractionOverride: { kind: 'unset' },
        typesafeApiKey: undefined,
        typesafeModel: 'jev-latest',
      },
    )).resolves.toEqual({ status: 'failed', reason: 'chat_failed' });
  });
});
