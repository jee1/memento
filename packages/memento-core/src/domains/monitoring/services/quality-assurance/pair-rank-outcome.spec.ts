import { describe, expect, it } from 'vitest';
import {
  PAIR_RANK_WINDOW,
  classifyPairRankOutcome,
  summarizePairRankOutcomes,
  type PairRankOutcome,
} from './pair-rank-outcome.js';

const FRESH = 'fresh';
const STALE = 'stale';

function ids(...names: string[]): string[] {
  return names;
}

describe('classifyPairRankOutcome', () => {
  it('classifies the six window placements by first index', () => {
    const cases: Array<{ ids: readonly string[]; window?: number; kind: PairRankOutcome['kind'] }> = [
      { ids: ids(FRESH, STALE), kind: 'fresh_strictly_above' },
      { ids: ids(STALE, 'other', FRESH), kind: 'stale_strictly_above' },
      { ids: ids(FRESH), kind: 'tied' },
      { ids: ids(FRESH, 'other'), kind: 'fresh_only_in_window' },
      { ids: ids('other', STALE), kind: 'stale_only_in_window' },
      { ids: ids('other'), kind: 'neither_in_window' },
    ];
    const freshId = (kind: PairRankOutcome['kind']): string => (kind === 'tied' ? FRESH : FRESH);
    const staleId = (kind: PairRankOutcome['kind']): string => (kind === 'tied' ? FRESH : STALE);

    expect(cases.map((row) => classifyPairRankOutcome(row.ids, freshId(row.kind), staleId(row.kind)).kind)).toEqual(
      cases.map((row) => row.kind),
    );
  });

  it('keeps the smaller index as the higher rank and ignores ids past the window', () => {
    const ordered = [STALE, 'mid', FRESH, ...Array.from({ length: 18 }, (_, index) => `pad-${index}`), FRESH];
    const above = classifyPairRankOutcome(ordered, FRESH, STALE);
    expect(above).toEqual({ kind: 'stale_strictly_above', freshIndex: 2, staleIndex: 0 });

    const pastWindow = [...Array.from({ length: PAIR_RANK_WINDOW }, () => 'pad'), FRESH, STALE];
    expect(classifyPairRankOutcome(pastWindow, FRESH, STALE)).toEqual({ kind: 'neither_in_window' });

    const freshInside = [...Array.from({ length: PAIR_RANK_WINDOW - 1 }, () => 'pad'), FRESH, STALE];
    expect(classifyPairRankOutcome(freshInside, FRESH, STALE)).toEqual({
      kind: 'fresh_only_in_window',
      freshIndex: PAIR_RANK_WINDOW - 1,
    });
  });

  it('uses the first occurrence when an id repeats', () => {
    expect(classifyPairRankOutcome([FRESH, STALE, FRESH], FRESH, STALE)).toEqual({
      kind: 'fresh_strictly_above',
      freshIndex: 0,
      staleIndex: 1,
    });
  });
});

describe('summarizePairRankOutcomes', () => {
  it('counts fresh_only in the numerator and neither only in the denominator', () => {
    const outcomes: PairRankOutcome[] = [
      { kind: 'fresh_strictly_above', freshIndex: 0, staleIndex: 1 },
      { kind: 'fresh_only_in_window', freshIndex: 0 },
      { kind: 'neither_in_window' },
    ];
    const summary = summarizePairRankOutcomes(outcomes);
    expect(summary.judged).toBe(3);
    expect(summary.numerator).toBe(2);
    expect(summary.fresh_strictly_above_rate).toBe(2 / 3);
    expect(summary.outcome_histogram).toEqual({
      fresh_strictly_above: 1,
      stale_strictly_above: 0,
      tied: 0,
      fresh_only_in_window: 1,
      stale_only_in_window: 0,
      neither_in_window: 1,
    });
  });

  it('returns rate 0 when nothing was judged', () => {
    const summary = summarizePairRankOutcomes([]);
    expect(summary.judged).toBe(0);
    expect(summary.numerator).toBe(0);
    expect(summary.fresh_strictly_above_rate).toBe(0);
    expect(Object.values(summary.outcome_histogram).every((count) => count === 0)).toBe(true);
    expect(Object.keys(summary.outcome_histogram)).toHaveLength(6);
  });
});
