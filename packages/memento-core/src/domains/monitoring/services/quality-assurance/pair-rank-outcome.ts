import type { PairRankOutcome, PairRankMacroSummary } from '../../../../shared/types/pair-rank.types.js';
export type { PairRankOutcome, PairRankMacroSummary } from '../../../../shared/types/pair-rank.types.js';

export const PAIR_RANK_WINDOW = 20;

const PAIR_RANK_OUTCOME_KINDS = [
  'fresh_strictly_above',
  'stale_strictly_above',
  'tied',
  'fresh_only_in_window',
  'stale_only_in_window',
  'neither_in_window',
] as const;

function indexWithinWindow(
  orderedBenchmarkIds: readonly string[],
  id: string,
  window: number,
): number | undefined {
  const end = Math.min(orderedBenchmarkIds.length, window);
  for (let index = 0; index < end; index++) {
    if (orderedBenchmarkIds[index] === id) {
      return index;
    }
  }
  return undefined;
}

export function classifyPairRankOutcome(
  orderedBenchmarkIds: readonly string[],
  freshId: string,
  staleId: string,
  window: number = PAIR_RANK_WINDOW,
): PairRankOutcome {
  const freshIndex = indexWithinWindow(orderedBenchmarkIds, freshId, window);
  const staleIndex = indexWithinWindow(orderedBenchmarkIds, staleId, window);
  if (freshIndex === undefined && staleIndex === undefined) {
    return { kind: 'neither_in_window' };
  }
  if (freshIndex === undefined && staleIndex !== undefined) {
    return { kind: 'stale_only_in_window', staleIndex };
  }
  if (staleIndex === undefined && freshIndex !== undefined) {
    return { kind: 'fresh_only_in_window', freshIndex };
  }
  if (freshIndex === undefined || staleIndex === undefined) {
    return { kind: 'neither_in_window' };
  }
  if (freshIndex === staleIndex) {
    return { kind: 'tied', index: freshIndex };
  }
  if (freshIndex < staleIndex) {
    return { kind: 'fresh_strictly_above', freshIndex, staleIndex };
  }
  return { kind: 'stale_strictly_above', freshIndex, staleIndex };
}

export function summarizePairRankOutcomes(outcomes: readonly PairRankOutcome[]): PairRankMacroSummary {
  const outcome_histogram = Object.fromEntries(
    PAIR_RANK_OUTCOME_KINDS.map((kind) => [kind, 0]),
  ) as Record<PairRankOutcome['kind'], number>;
  for (const outcome of outcomes) {
    outcome_histogram[outcome.kind] += 1;
  }
  const judged = outcomes.length;
  const numerator = outcome_histogram.fresh_strictly_above + outcome_histogram.fresh_only_in_window;
  return {
    judged,
    numerator,
    fresh_strictly_above_rate: judged === 0 ? 0 : numerator / judged,
    outcome_histogram,
  };
}
