import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { MEMORY_TYPE_RELATION_MAP } from '../packages/memento-core/src/shared/types/relation.js';
import { runEvaluation } from './run-jev-relation-evaluation.mjs';

const bytes = readFileSync(new URL('../tests/fixtures/jev-relation-quality/review-draft-2026-10-31.json', import.meta.url));
const draft = JSON.parse(bytes.toString());

describe('#1470 reviewed evaluation pairs', () => {
  it('keeps all six kinds, direction, negative controls and ambiguity explicit', () => {
    expect(draft.review).toMatchObject({
      status: 'reviewed', human_reviewed: true,
      reviewer: 'jee1lee', reviewed_at: '2026-10-31T09:12:00+09:00',
      approved_draft_sha256: 'cdfeac5a75d49170ad3c43dc3542f3c4404463e5bd48a5f28867a7b924be9545',
    });
    expect(createHash('sha256').update(JSON.stringify(draft.cases)).digest('hex'))
      .toBe('bce49f69c6316c7bc2cb138d9d9e441e0517679fb51add45bcd9a3ba3fe81384');
    expect(draft.cases).toHaveLength(48);
    expect(new Set(draft.cases.map(item => item.id)).size).toBe(draft.cases.length);
    const counts = new Map<string, number>();
    for (const item of draft.cases) {
      expect(item.expected.reason.trim().length).toBeGreaterThan(0);
      expect(item.source.content.trim().length).toBeGreaterThan(0);
      expect(item.target.content.trim().length).toBeGreaterThan(0);
      if (item.expected.relevance === 'related') {
        expect(item.expected.types).toHaveLength(1);
        const type = item.expected.types[0];
        expect(MEMORY_TYPE_RELATION_MAP[item.source.type]).toContain(type);
        expect(item.expected.direction).toBe(type === 'CONTRASTS_WITH' ? 'symmetric' : 'source_to_target');
        counts.set(type, (counts.get(type) ?? 0) + 1);
      } else {
        expect(['unrelated', 'ambiguous']).toContain(item.expected.relevance);
        expect(item.expected.types).toEqual([]);
        expect(item.expected.direction).toBe('none');
        counts.set(item.expected.relevance, (counts.get(item.expected.relevance) ?? 0) + 1);
      }
    }
    expect(Object.fromEntries(counts)).toEqual({
      CAUSES: 4, DEPENDS_ON: 4, FOLLOWS: 8, CONTRASTS_WITH: 8,
      REFERENCES: 6, BELONGS_TO: 4, unrelated: 8, ambiguous: 6,
    });
    for (const group of ['duplicate-not-contrast', 'peer-not-contrast', 'time-adjacent-only']) {
      expect(draft.cases.filter(item => item.group === group).length).toBeGreaterThanOrEqual(2);
    }
    for (const item of draft.cases.filter(item => item.group === 'peer-not-contrast')) {
      expect(item.expected.relevance).toBe('ambiguous');
      expect(item.expected.forbidden_types).toEqual(['CONTRASTS_WITH', 'BELONGS_TO']);
    }
  });

  it('admits all approved pairs to the existing runner as human-reviewed', async () => {
    const judgePair = vi.fn(async () => ({ outcome: { ok: true, candidates: [] }, rounds: [] }));
    const snapshot = await runEvaluation(bytes, {
      judgePair, revision: 'test-only', code_sha256: 'test-only',
      model: 'mock', created_at: '2026-10-31T00:00:00Z',
    });
    expect(judgePair).toHaveBeenCalledTimes(48);
    expect(snapshot).toMatchObject({ input_review_status: 'reviewed', human_reviewed: true });
    expect(snapshot.results.map(item => item.id)).toEqual(draft.cases.map(item => item.id));
  });

  it('refuses to score pending labels before any model call', async () => {
    const judgePair = vi.fn();
    const pending = { ...draft, review: { status: 'pending', human_reviewed: false } };
    await expect(runEvaluation(Buffer.from(JSON.stringify(pending)), {
      judgePair, revision: 'test-only', code_sha256: 'test-only',
      model: 'mock', created_at: '2026-10-31T00:00:00Z',
    })).rejects.toThrow('Invalid Jev evaluation input');
    expect(judgePair).not.toHaveBeenCalled();
  });
});
