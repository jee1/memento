import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { MEMORY_TYPE_RELATION_MAP } from '../packages/memento-core/src/shared/types/relation.js';
import { runEvaluation } from './run-jev-relation-evaluation.mjs';

const bytes = readFileSync(new URL('../tests/fixtures/jev-relation-quality/review-draft-2026-10-31.json', import.meta.url));
const draft = JSON.parse(bytes.toString());

describe('#1470 pending review draft', () => {
  it('keeps all six kinds, direction, negative controls and ambiguity explicit', () => {
    expect(draft.review).toMatchObject({ status: 'pending', human_reviewed: false });
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

  it('refuses to score pending labels before any model call', async () => {
    const judgePair = vi.fn();
    await expect(runEvaluation(bytes, {
      judgePair, revision: 'test-only', code_sha256: 'test-only',
      model: 'mock', created_at: '2026-10-31T00:00:00Z',
    })).rejects.toThrow('Invalid Jev evaluation input');
    expect(judgePair).not.toHaveBeenCalled();
  });
});
