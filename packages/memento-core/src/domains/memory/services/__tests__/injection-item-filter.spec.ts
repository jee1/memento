import { describe, expect, it } from 'vitest';
import {
  buildItemFilterMeta,
  filterByGateItemScores,
  shouldApplyItemFilter,
} from '../injection-item-filter.js';

describe('injection-item-filter (#1682)', () => {
  it('점수 경계: 0.5 는 남고 0.4999 는 빠진다', () => {
    const out = filterByGateItemScores(
      [{ id: 'keep' }, { id: 'drop' }],
      [
        { id: 'keep', score: 0.5 },
        { id: 'drop', score: 0.4999 },
      ],
      0.5,
    );
    expect(out.memories.map((m) => m.id)).toEqual(['keep']);
    expect(out.scored).toBe(2);
    expect(out.kept).toBe(1);
    expect(out.dropped).toBe(1);
  });

  it('점수 없음: null 과 top-10 밖 항목은 빠진다', () => {
    const out = filterByGateItemScores(
      [{ id: 'scored' }, { id: 'nan' }, { id: 'outside' }],
      [
        { id: 'scored', score: 0.8 },
        { id: 'nan', score: null },
      ],
      0.5,
    );
    expect(out.memories.map((m) => m.id)).toEqual(['scored']);
    expect(out.scored).toBe(1);
    expect(out.dropped).toBe(2);
  });

  it('게이트 off / fail_open / rejected / rejection_gate 없음: applied false', () => {
    const memories = [{ id: 'a' }, { id: 'b' }];
    const scores = [
      { id: 'a', score: 0.9 },
      { id: 'b', score: 0.1 },
    ];

    for (const rejectionGate of [
      undefined,
      { verdict: 'off' as const, top_score: null, unscored: 0 },
      { verdict: 'fail_open' as const, top_score: null, unscored: 2 },
      { verdict: 'rejected' as const, top_score: 0.2, unscored: 0 },
    ]) {
      expect(shouldApplyItemFilter(0.5, rejectionGate)).toBe(false);
      const meta = buildItemFilterMeta({
        itemScoreMin: 0.5,
        rejectionGate,
        memoriesBefore: memories,
        gateItemScores: scores,
      });
      expect(meta.itemFilter.applied).toBe(false);
      expect(meta.memories).toEqual(memories);
    }
  });

  it('설정 0: 필터를 끈다', () => {
    expect(shouldApplyItemFilter(0, { verdict: 'passed', top_score: 0.9, unscored: 0 })).toBe(false);
    const meta = buildItemFilterMeta({
      itemScoreMin: 0,
      rejectionGate: { verdict: 'passed', top_score: 0.9, unscored: 0 },
      memoriesBefore: [{ id: 'a' }],
      gateItemScores: [{ id: 'a', score: 0.1 }],
    });
    expect(meta.itemFilter.applied).toBe(false);
    expect(meta.memories).toEqual([{ id: 'a' }]);
  });

  it('빈 결과: 모두 탈락하면 kept 0', () => {
    const meta = buildItemFilterMeta({
      itemScoreMin: 0.5,
      rejectionGate: { verdict: 'passed', top_score: 0.45, unscored: 0 },
      memoriesBefore: [{ id: 'a' }, { id: 'b' }],
      gateItemScores: [
        { id: 'a', score: 0.45 },
        { id: 'b', score: 0.4 },
      ],
    });
    expect(meta.itemFilter).toEqual({
      applied: true,
      threshold: 0.5,
      scored: 2,
      kept: 0,
      dropped: 2,
    });
    expect(meta.memories).toEqual([]);
  });
});
