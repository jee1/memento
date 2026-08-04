import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deterministicProjection,
  evaluateGraphAdoptionGate,
  evaluateProductionVsFtsGate,
  evaluateRankedResults,
  reciprocalRankFusion,
  runProductionAgentMemoryBenchmark,
  runAgentMemoryBenchmark,
  tokenize,
} from './agent-memory-benchmark.js';

const FIXTURE_DIR = join(process.cwd(), 'tests/fixtures/agent-memory-benchmark');

describe('agent memory benchmark metrics', () => {
  it('uses a deterministic Unicode-aware tokenizer', () => {
    expect(tokenize('RetryManager 재시도, RETRY manager!')).toEqual([
      'retrymanager',
      '재시도',
      'retry',
      'manager',
    ]);
  });

  it('fuses ranked streams with deterministic RRF ties', () => {
    expect(reciprocalRankFusion([
      ['memory-b', 'memory-a'],
      ['memory-a', 'memory-c'],
    ], 60)).toEqual(['memory-a', 'memory-b', 'memory-c']);
  });

  it('calculates recall, reciprocal rank, ndcg, duplicate, and session bias', () => {
    const metrics = evaluateRankedResults(
      [{
        queryId: 'q1',
        relevantIds: ['memory-a', 'memory-c'],
        ranked: [
          { id: 'memory-a', sessionId: 'session-1', content: 'same content', tokenEstimate: 3 },
          { id: 'memory-b', sessionId: 'session-1', content: 'same content', tokenEstimate: 3 },
          { id: 'memory-c', sessionId: 'session-2', content: 'other', tokenEstimate: 2 },
        ],
        latencyMs: 4,
      }],
      10,
      7,
    );

    expect(metrics.query_count).toBe(1);
    expect(metrics.top_k).toBe(10);
    expect(metrics.recall_at_5).toBe(1);
    expect(metrics.recall_at_10).toBe(1);
    expect(metrics.mrr).toBe(1);
    expect(metrics.ndcg_at_10).toBeCloseTo(0.9197, 4);
    expect(metrics.injected_tokens.total).toBe(6);
    expect(metrics.duplicate_rate).toBeCloseTo(1 / 2);
    expect(metrics.max_session_concentration).toBe(1);
  });

  it('requires every graph adoption gate to pass', () => {
    const baseline = {
      query_count: 4,
      top_k: 10,
      recall_at_5: 0.5,
      recall_at_10: 0.7,
      mrr: 0.6,
      ndcg_at_10: 0.65,
      latency_ms: { p50: 5, p95: 10 },
      injected_tokens: { total: 100, mean: 10 },
      duplicate_rate: 0,
      max_session_concentration: 0.5,
    };
    const graph = {
      ...baseline,
      recall_at_10: 0.8,
      mrr: 0.61,
      ndcg_at_10: 0.66,
      latency_ms: { p50: 6, p95: 15 },
    };
    const thresholds = {
      min_recall_at_10_delta: 0.05,
      max_quality_regression: 0,
      max_p95_latency_ms: 100,
      max_p95_latency_ratio: 2,
      max_duplicate_rate: 0.1,
      max_session_concentration: 0.8,
    };

    expect(evaluateGraphAdoptionGate(baseline, graph, thresholds).adoption_candidate).toBe(true);
    expect(evaluateGraphAdoptionGate(baseline, {
      ...graph,
      ndcg_at_10: 0.64,
    }, thresholds).adoption_candidate).toBe(false);
  });

  it('rejects production quality regressions against fts_only', () => {
    const ftsOnly = {
      query_count: 4,
      top_k: 10,
      recall_at_5: 0.5,
      recall_at_10: 0.7,
      mrr: 0.6,
      ndcg_at_10: 0.65,
      latency_ms: { p50: 5, p95: 10 },
      injected_tokens: { total: 100, mean: 10 },
      duplicate_rate: 0,
      max_session_concentration: 0.5,
    };
    const production = {
      ...ftsOnly,
      recall_at_10: 0.69,
    };

    expect(evaluateProductionVsFtsGate(ftsOnly, production, {
      min_recall_at_10_delta: 0.05,
      max_quality_regression: 0,
      max_p95_latency_ms: 100,
      max_p95_latency_ratio: 2,
      max_duplicate_rate: 0.1,
      max_session_concentration: 0.8,
    }).adoption_candidate).toBe(false);
  });
});

describe('agent memory benchmark runner', () => {
  it('keeps retrieval and E2E reports separate and graph flag explicit', () => {
    const withoutGraph = runAgentMemoryBenchmark({
      fixtureDir: FIXTURE_DIR,
      graphRrf: false,
    });
    const withGraph = runAgentMemoryBenchmark({
      fixtureDir: FIXTURE_DIR,
      graphRrf: true,
    });

    expect(Object.keys(withoutGraph.retrieval)).toEqual([
      'grep',
      'fts_only',
      'vector',
      'rrf_sim',
    ]);
    expect(withoutGraph.retrieval.memento).toBeUndefined();
    expect(withoutGraph.end_to_end.rrf_sim).toEqual(expect.objectContaining({
      case_count: expect.any(Number),
      completion_rate: expect.any(Number),
      evidence_coverage: expect.any(Number),
    }));
    expect(withoutGraph.gates.graph_rrf.enabled).toBe(false);
    expect(withGraph.retrieval.graph_rrf).toBeDefined();
    expect(withGraph.gates.graph_rrf.enabled).toBe(true);
  });

  it('repeats deterministic quality, ranking, token, and gate output for the same seed', () => {
    const first = runAgentMemoryBenchmark({
      fixtureDir: FIXTURE_DIR,
      graphRrf: true,
      seed: 455,
    });
    const second = runAgentMemoryBenchmark({
      fixtureDir: FIXTURE_DIR,
      graphRrf: true,
      seed: 455,
    });

    expect(deterministicProjection(first)).toEqual(deterministicProjection(second));
    expect(first.reproduction.fixture_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.reproduction.git_sha).toMatch(/^[a-f0-9]{7,40}$|^unknown$/);
  });

  it('preserves the benchmark-v3 fixture contract by using a separate fixture root', () => {
    const report = runAgentMemoryBenchmark({
      fixtureDir: FIXTURE_DIR,
      graphRrf: true,
    });

    expect(report.reproduction.fixture_dir).toContain('agent-memory-benchmark');
    expect(report.reproduction.fixture_dir).not.toContain('benchmark-v3');
  });

  it('records a production scorecard and separate production baseline', async () => {
    const report = await runProductionAgentMemoryBenchmark({
      fixtureDir: FIXTURE_DIR,
    });

    expect(report.retrieval.memento_prod).toEqual(expect.objectContaining({
      recall_at_10: expect.any(Number),
      mrr: expect.any(Number),
      ndcg_at_10: expect.any(Number),
      latency_ms: expect.objectContaining({ p95: expect.any(Number) }),
    }));
    expect(report.end_to_end.memento_prod).toBeDefined();
    expect(report.scorecard).toEqual(expect.objectContaining({
      dataset_revision: expect.any(String),
      dataset_sha256: report.reproduction.fixture_sha256,
      ranking_profile: expect.any(String),
      embedding_provider: 'tfidf',
      failed_queries: expect.any(Array),
      p95_budget_ms: expect.any(Number),
    }));
    expect(report.gates.production_vs_fts.enabled).toBe(true);
  });
});
