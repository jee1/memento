import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { MemoryItem } from '../../../../shared/types/memory.types.js';
import type { SystemOneClient } from '../../../../shared/services/typesafe/system-one-client.js';
import type { UnifiedEmbeddingService } from '../../../embedding/services/unified-embedding-service.js';
import { JevRelationJudge } from '../jev-relation-judge.js';
import { RELATION_TEXT_CHARS } from '../relation-candidate-pool.js';

const draft = JSON.parse(readFileSync(new URL(
  '../../../../../../../tests/fixtures/jev-relation-quality/review-draft-2026-10-31.json', import.meta.url,
), 'utf8'));

function pair(id: string): { source: MemoryItem; target: MemoryItem } {
  const item = draft.cases.find(item => item.id === id);
  if (!item) throw new Error('Missing synthetic pair');
  const memory = (side: 'source' | 'target'): MemoryItem => ({
    ...item[side], id: `${id}_${side}`, importance: 0.5, privacy_scope: 'private',
    created_at: new Date('2026-01-01T00:00:00Z'), pinned: false,
  });
  return { source: memory('source'), target: memory('target') };
}

const embedding = {
  generateEmbedding: () => { throw new Error('Single-pair reproduction must not embed'); },
  searchSimilar: () => { throw new Error('Single-pair reproduction must not search'); },
} as unknown as UnifiedEmbeddingService;

function scored(entries: Array<[string, number]>) {
  return { ok: true, noulById: new Map(entries), wafRetried: false };
}

// Injected scores isolate propagation in the shared path; they are not recorded model outputs.
describe('#1470 context failure versus type-selection failure', () => {
  it('propagates a false context pass into a time-only FOLLOWS edge', async () => {
    const { source, target } = pair('unrel01');
    const ask = vi.fn()
      .mockResolvedValueOnce(scored([['r0', 0.9]]))
      .mockResolvedValueOnce(scored([['y0_FOLLOWS', 0.9]]));
    const result = await new JevRelationJudge({ ask } as unknown as SystemOneClient, embedding)
      .judge(source, [target]);
    expect(result).toMatchObject({ ok: true, candidates: [{ relation_type: 'FOLLOWS' }] });
    expect(ask.mock.calls[0]?.[0]).toEqual({ s: source.content, t0: target.content });
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it.each(['dup01', 'follow01', 'amb01'])('propagates wrong CONTRASTS_WITH scores after a context pass: %s', async id => {
    const { source, target } = pair(id);
    const ask = vi.fn()
      .mockResolvedValueOnce(scored([['r0', 0.9]]))
      .mockResolvedValueOnce(scored([
        ['y0_CONTRASTS_WITH', 0.9], ['y0_REFERENCES', 0.8], ['y0_FOLLOWS', 0.7],
      ]));
    const result = await new JevRelationJudge({ ask } as unknown as SystemOneClient, embedding)
      .judge(source, [target]);
    expect(result).toMatchObject({ ok: true, candidates: [{ relation_type: 'CONTRASTS_WITH', confidence: 0.9 }] });
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('stops a context rejection before type selection', async () => {
    const { source, target } = pair('unrel01');
    const ask = vi.fn().mockResolvedValueOnce(scored([['r0', 0.49]]));
    await expect(new JevRelationJudge({ ask } as unknown as SystemOneClient, embedding)
      .judge(source, [target])).resolves.toEqual({ ok: true, candidates: [] });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['follow01', 'FOLLOWS'], ['dup01', 'REFERENCES'],
  ])('preserves a true relation when the mock scores support it: %s', async (id, type) => {
    const { source, target } = pair(id);
    const ask = vi.fn()
      .mockResolvedValueOnce(scored([['r0', 0.9]]))
      .mockResolvedValueOnce(scored([[`y0_${type}`, 0.9]]));
    await expect(new JevRelationJudge({ ask } as unknown as SystemOneClient, embedding)
      .judge(source, [target])).resolves.toMatchObject({ ok: true, candidates: [{ relation_type: type }] });
  });

  it.each([
    ['context', 'follow01', 'unrel01'],
    ['type', 'contrast01', 'dup01'],
  ])('loses distinguishing %s evidence beyond the current text boundary', async (_kind, first, second) => {
    const ask = vi.fn().mockResolvedValue(scored([['r0', 0.1]]));
    const judge = new JevRelationJudge({ ask } as unknown as SystemOneClient, embedding);
    const prefix = '공'.repeat(RELATION_TEXT_CHARS);
    for (const id of [first, second]) {
      const { source, target } = pair(id);
      await judge.judge({ ...source, content: prefix + source.content }, [
        { ...target, content: prefix + target.content },
      ]);
    }
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask.mock.calls[0]).toEqual(ask.mock.calls[1]);
    expect(ask.mock.calls[0]?.[0]).toEqual({ s: `${prefix}...`, t0: `${prefix}...` });
  });
});
