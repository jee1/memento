import { describe, expect, it } from 'vitest';
import {
  assertZeroSafetyViolations,
  computeAggregateMetrics,
  countSafetyViolations,
  findRegressionQueryIds,
  queryHitsAtK,
  selectWithinTokenBudget,
  type MemorySafetyMeta,
  type PerQueryEvalOutcome,
  type RankedBenchmarkResult,
} from './relation-bfs-eval-metrics.js';

describe('relation-bfs-eval-metrics', () => {
  it('selectWithinTokenBudget respects budget', () => {
    const ranked: RankedBenchmarkResult[] = [
      { benchmarkId: 'a', score: 1, tokenEstimate: 100 },
      { benchmarkId: 'b', score: 0.9, tokenEstimate: 100 },
      { benchmarkId: 'c', score: 0.8, tokenEstimate: 100 },
    ];
    expect(selectWithinTokenBudget(ranked, 150).map((r) => r.benchmarkId)).toEqual(['a']);
    expect(selectWithinTokenBudget(ranked, 250).map((r) => r.benchmarkId)).toEqual(['a', 'b']);
  });

  it('computeAggregateMetrics averages recall and nDCG', () => {
    const groundTruths = new Map([
      ['q1', { queryId: 'q1', relevantIds: ['good'] }],
      ['q2', { queryId: 'q2', relevantIds: ['x'] }],
    ]);
    const outcomes: PerQueryEvalOutcome[] = [
      {
        queryId: 'q1',
        category: 'single_fact',
        ranked: [{ benchmarkId: 'good', score: 1, tokenEstimate: 10 }],
        latencyMs: 10,
        returnedTokens: 10,
        safetyViolations: { forbiddenInResults: 0, foreignOwnerInResults: 0, deletedOrSupersededInResults: 0, total: 0 },
      },
      {
        queryId: 'q2',
        category: 'multi_hop',
        ranked: [{ benchmarkId: 'miss', score: 0.5, tokenEstimate: 10 }],
        latencyMs: 20,
        returnedTokens: 10,
        safetyViolations: { forbiddenInResults: 0, foreignOwnerInResults: 0, deletedOrSupersededInResults: 0, total: 0 },
      },
    ];
    const m = computeAggregateMetrics(outcomes, groundTruths);
    expect(m.queryCount).toBe(2);
    expect(m.recallAt10).toBe(0.5);
    expect(m.ndcgAt10).toBeGreaterThan(0);
    expect(m.latencyP50Ms).toBe(10);
  });

  it('findRegressionQueryIds lists A-hit B-miss queries', () => {
    const gt = new Map([['q1', { queryId: 'q1', relevantIds: ['r1'] }], ['q2', { queryId: 'q2', relevantIds: ['r2'] }]]);
    const base = (queryId: string, benchmarkId: string): PerQueryEvalOutcome => ({
      queryId,
      category: 'single_fact',
      ranked: [{ benchmarkId, score: 1, tokenEstimate: 1 }],
      latencyMs: 1,
      returnedTokens: 1,
      safetyViolations: { forbiddenInResults: 0, foreignOwnerInResults: 0, deletedOrSupersededInResults: 0, total: 0 },
    });
    const hybridOnly = [base('q1', 'r1'), base('q2', 'r2')];
    const hybridBfs = [base('q1', 'r1'), base('q2', 'noise')];
    expect(findRegressionQueryIds(hybridOnly, hybridBfs, gt, 10)).toEqual(['q2']);
    expect(findRegressionQueryIds(hybridBfs, hybridOnly, gt, 10)).toEqual([]);
    expect(queryHitsAtK(base('q2', 'r2').ranked, ['r2'], 10)).toBe(true);
  });

  it('countSafetyViolations detects forbidden, foreign owner, deleted', () => {
    const meta = new Map<string, MemorySafetyMeta>([
      ['ok', { benchmarkId: 'ok', ownerId: 'owner_a', isDeleted: false, supersededBy: null }],
      ['foreign', { benchmarkId: 'foreign', ownerId: 'owner_b', isDeleted: false, supersededBy: null }],
      ['deleted', { benchmarkId: 'deleted', ownerId: 'owner_a', isDeleted: true, supersededBy: null }],
      ['old', { benchmarkId: 'old', ownerId: 'owner_a', isDeleted: false, supersededBy: 'ok' }],
      ['trap', { benchmarkId: 'trap', ownerId: 'owner_a', isDeleted: false, supersededBy: null }],
    ]);
    const counts = countSafetyViolations(
      ['ok', 'foreign', 'deleted', 'old', 'trap'],
      meta,
      'owner_a',
      ['trap'],
    );
    expect(counts).toEqual({
      forbiddenInResults: 1,
      foreignOwnerInResults: 1,
      deletedOrSupersededInResults: 2,
      total: 4,
    });
    expect(() => assertZeroSafetyViolations(counts, 'arm-b')).toThrow(/arm-b/);
    assertZeroSafetyViolations(
      { forbiddenInResults: 0, foreignOwnerInResults: 0, deletedOrSupersededInResults: 0, total: 0 },
      'clean',
    );
  });
});
