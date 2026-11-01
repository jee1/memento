import { describe, expect, it } from 'vitest';
import {
  decideConclusion,
  EVAL_CONSTANTS,
  formatMetricsTable,
} from './evaluate-relation-bfs.js';
import type { AggregateMetrics, CategorySliceMetrics } from './lib/relation-bfs-eval-metrics.js';
import {
  scoreBfsCandidate,
  type DevGridRow,
} from './lib/relation-bfs-eval-runner.js';

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

function gridRow(multiHop: number): DevGridRow {
  return {
    key: 'h2-s5-l35',
    hyper: { maxHops: 2, maxSeeds: 5, bfsLimit: 35 },
    multiHopRecallAt10: multiHop,
    singleFactRecallAt10: 0.5,
    irrelevantTrapRecallAt10: 1,
    overallRecallAt10: 0.5,
  };
}

describe('evaluate-relation-bfs', () => {
  it('decideConclusion returns inconclusive when dev multi_hop stays 0', () => {
    const chosen = { maxHops: 1, maxSeeds: 3, bfsLimit: 15 };
    const devGrid = [gridRow(0)];
    const a = metrics({ recallAt10: 0.8 });
    const b = metrics({ recallAt10: 0.8 });
    expect(decideConclusion(devGrid, chosen, a, b, 0).conclusion).toBe('inconclusive_harness');
  });

  it('decideConclusion returns do_not_expand when held-out gain is non-positive', () => {
    const chosen = { maxHops: 2, maxSeeds: 5, bfsLimit: 35 };
    const devGrid = [gridRow(0.5)];
    const a = metrics({ recallAt10: 0.8 });
    const b = metrics({ recallAt10: 0.78 });
    expect(decideConclusion(devGrid, chosen, a, b, 0).conclusion).toBe('do_not_expand');
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

  it('scoreBfsCandidate multiplies seed score by path edge confidence and type boost', () => {
    const twoHop = [
      { relation_type: 'FOLLOWS' },
      { relation_type: 'FOLLOWS' },
    ] as const;
    expect(scoreBfsCandidate(0.85, twoHop)).toBeCloseTo(0.85 * 0.9 * 0.9, 5);
    expect(scoreBfsCandidate(0.85, [{ relation_type: 'FOLLOWS' }])).toBeCloseTo(0.85 * 0.9, 5);
  });

  it('exports fixed eval constants for pool and token budget', () => {
    expect(EVAL_CONSTANTS.candidatePoolLimit).toBe(30);
    expect(EVAL_CONSTANTS.tokenBudget).toBe(4096);
  });
});
