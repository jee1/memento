import { describe, expect, it } from 'vitest';
import {
  decideConclusion,
  EVAL_CONSTANTS,
  formatMetricsTable,
} from './evaluate-relation-bfs.js';
import type { AggregateMetrics, CategorySliceMetrics } from './lib/relation-bfs-eval-metrics.js';

function metrics(partial: Partial<AggregateMetrics>): AggregateMetrics {
  return {
    recallAt5: 0,
    recallAt10: 0,
    ndcgAt5: 0,
    ndcgAt10: 0,
    latencyP50Ms: 0,
    latencyP95Ms: 0,
    meanReturnedTokens: 0,
    queryCount: 25,
    ...partial,
  };
}

describe('evaluate-relation-bfs', () => {
  it('decideConclusion returns do_not_expand when held-out gain is non-positive', () => {
    const a = metrics({ recallAt10: 0.8 });
    const b = metrics({ recallAt10: 0.78 });
    expect(decideConclusion(a, b, a, b, 0)).toBe('do_not_expand');
  });

  it('decideConclusion rejects expansion when regressions dominate small gain', () => {
    const a = metrics({ recallAt10: 0.5, queryCount: 50 });
    const b = metrics({ recallAt10: 0.52, queryCount: 50 });
    expect(decideConclusion(a, b, a, b, 5)).toBe('do_not_expand');
  });

  it('formatMetricsTable renders category rows', () => {
    const rows: CategorySliceMetrics[] = [
      {
        category: 'single_fact',
        metrics: metrics({ recallAt10: 0.5, ndcgAt10: 0.4 }),
      },
    ];
    const table = formatMetricsTable(rows);
    expect(table).toContain('single_fact');
    expect(table).toContain('0.500');
  });

  it('exports fixed eval constants for pool and token budget', () => {
    expect(EVAL_CONSTANTS.candidatePoolLimit).toBe(30);
    expect(EVAL_CONSTANTS.tokenBudget).toBe(4096);
  });
});
