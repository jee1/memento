import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deterministicProjection,
  evaluateGraphAdoptionGate,
  evaluateProductionVsFtsGate,
  evaluateProposedQualityGate,
  evaluateRankedResults,
  loadDataset,
  parseArgs,
  reciprocalRankFusion,
  runProductionAgentMemoryBenchmark,
  runAgentMemoryBenchmark,
  summarizeInjectionTokenSplit,
  tokenize,
} from './agent-memory-benchmark.js';

const FIXTURE_DIR = join(process.cwd(), 'tests/fixtures/agent-memory-benchmark');
const KO_FIXTURE_DIR = join(process.cwd(), 'tests/fixtures/agent-memory-benchmark-ko');

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

  it('pairs per-category retrieval quality with the per-query token cost', () => {
    const report = runAgentMemoryBenchmark({
      loCoMoPath: join(FIXTURE_DIR, 'locomo-shape-sample.json'),
    });

    expect(report.reproduction.fixture_dir).toBe('locomo-shape-sample.json');
    const categories = report.by_category?.fts_only;
    // open_domain_knowledge is absent: the fixture's only such question has no
    // resolvable evidence, so it is skipped rather than scored against nothing.
    expect(Object.keys(categories ?? {})).toEqual([
      'multi_hop',
      'single_hop',
      'temporal_reasoning',
    ]);
    // Accuracy on its own is misleading — every category row carries its cost.
    for (const metrics of Object.values(categories ?? {})) {
      expect(metrics.injected_tokens.mean).toBeGreaterThan(0);
      expect(metrics.recall_at_10).toBeGreaterThanOrEqual(0);
      expect(metrics).not.toHaveProperty('latency_ms');
    }
    // Adversarial questions never enter retrieval scoring.
    expect(categories).not.toHaveProperty('adversarial');
    // Category query counts add up to the scored query set.
    const scored = Object.values(categories ?? {})
      .reduce((sum, metrics) => sum + metrics.query_count, 0);
    expect(scored).toBe(report.retrieval.fts_only?.query_count);
  });

  it('omits the category breakdown when a dataset carries no task cases', () => {
    const report = runAgentMemoryBenchmark({ fixtureDir: FIXTURE_DIR });

    expect(report.by_category).toBeUndefined();
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
      ranking_version: expect.stringMatching(/^ranking-sha256:[a-f0-9]{12}$/),
      embedding_provider: 'tfidf',
      failed_queries: expect.any(Array),
      p95_budget_ms: expect.any(Number),
      recall_at_5: expect.any(Number),
      recall_at_10: expect.any(Number),
      sql_candidate_recall: expect.any(Number),
      engine_topn_recall: expect.any(Number),
      mrr: expect.any(Number),
      ndcg_at_10: expect.any(Number),
    }));
    expect(report.scorecard?.sql_candidate_recall).toBeGreaterThanOrEqual(report.scorecard?.engine_topn_recall ?? 0);
    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    }).trim();
    expect(report.reproduction.git_sha).toBe(headSha);
    expect(report.reproduction.ranking_version).toMatch(/^ranking-sha256:[a-f0-9]{12}$/);
    expect(report.reproduction.ranking_weights_path_override).toBe(Boolean(process.env.MEMENTO_RANKING_WEIGHTS_PATH));
    expect(report.reproduction.eligible_query_ids_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.reproduction.excluded_query_ids_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.gates.production_vs_fts.enabled).toBe(true);
    expect(report.scorecard?.production_path).toBe('hybridSearchEngine.search');
  });
});

describe('Korean arm / measure-only (#808 T007)', () => {
  it('accepts --arm korean with --fixture path to ko fixture', () => {
    expect(parseArgs([
      '--fixture', KO_FIXTURE_DIR,
      '--arm', 'korean',
    ])).toEqual(expect.objectContaining({
      fixtureDir: KO_FIXTURE_DIR,
      arm: 'korean',
    }));
  });

  it('rejects --arm without a value', () => {
    expect(() => parseArgs(['--arm'])).toThrow(/--arm requires a value/i);
    expect(() => parseArgs(['--arm', '--production'])).toThrow(/--arm requires a value/i);
  });

  it('requires --arm korean when fixture is agent-memory-benchmark-ko (FR-019)', () => {
    expect(() => parseArgs(['--fixture', KO_FIXTURE_DIR])).toThrow(/--arm korean/i);
    expect(() => parseArgs([
      '--fixture', 'tests/fixtures/agent-memory-benchmark-ko',
    ])).toThrow(/--arm korean/i);
  });

  it('keeps default English fixture path working without --arm (FR-011)', () => {
    expect(parseArgs([])).toEqual({});
    expect(parseArgs(['--fixture', FIXTURE_DIR])).toEqual({
      fixtureDir: FIXTURE_DIR,
    });
    const report = runAgentMemoryBenchmark({ fixtureDir: FIXTURE_DIR });
    expect(report.arm).toBeUndefined();
    expect(report.measure_only).toBeUndefined();
    expect(report.scorecard).toBeUndefined();
  });

  it('labels report metadata measure_only and arm=korean for the Korean arm', () => {
    const report = runAgentMemoryBenchmark({
      fixtureDir: KO_FIXTURE_DIR,
      arm: 'korean',
    });

    expect(report.arm).toBe('korean');
    expect(report.measure_only).toBe(true);
    expect(report.by_category?.fts_only).toEqual(expect.objectContaining({
      particle_agglutination: expect.objectContaining({
        recall_at_10: expect.any(Number),
        mrr: expect.any(Number),
      }),
      short_multi_concept: expect.objectContaining({
        recall_at_10: expect.any(Number),
      }),
    }));
  });

  it('labels production scorecard measure_only and arm=korean', async () => {
    const report = await runProductionAgentMemoryBenchmark({
      fixtureDir: KO_FIXTURE_DIR,
      arm: 'korean',
    });

    expect(report.arm).toBe('korean');
    expect(report.measure_only).toBe(true);
    expect(report.scorecard).toEqual(expect.objectContaining({
      arm: 'korean',
      measure_only: true,
      recall_at_10: expect.any(Number),
      mrr: expect.any(Number),
    }));
    expect(report.by_category?.memento_prod).toEqual(expect.objectContaining({
      particle_agglutination: expect.any(Object),
      short_multi_concept: expect.any(Object),
    }));
  });

  it('fail-closes programmatic Korean fixture runs without arm', () => {
    expect(() => runAgentMemoryBenchmark({ fixtureDir: KO_FIXTURE_DIR }))
      .toThrow(/--arm korean/i);
  });

  it('runs korean-gold-validate before scoring Korean fixture (FR-013)', () => {
    expect(() => loadDataset({ fixtureDir: KO_FIXTURE_DIR, arm: 'korean' }))
      .not.toThrow();
  });
});

describe('proposed quality gate (#790)', () => {
  const passing = {
    recall_at_10: 0.80,
    zero_hit_rate: 0.19,
    p95_ms: 999,
    category_regression: false,
  };

  it('passes Recall@10 ≥ 0.80, zero-hit < 20%, p95 < 1s, no category regression', () => {
    const report = evaluateProposedQualityGate(passing);
    expect(report.passed).toBe(true);
    expect(report.checks.every((check) => check.passed)).toBe(true);
  });

  it('fails when Recall@10 is below 0.80', () => {
    expect(evaluateProposedQualityGate({ ...passing, recall_at_10: 0.799 }).passed).toBe(false);
  });

  it('fails when zero-hit rate is 20% or higher', () => {
    expect(evaluateProposedQualityGate({ ...passing, zero_hit_rate: 0.20 }).passed).toBe(false);
  });

  it('fails when p95 is 1000ms or higher', () => {
    expect(evaluateProposedQualityGate({ ...passing, p95_ms: 1000 }).passed).toBe(false);
  });

  it('fails when a category regresses', () => {
    expect(evaluateProposedQualityGate({ ...passing, category_regression: true }).passed).toBe(false);
  });

  it('splits requested vs serialized tokens and fixed-item vs fixed-token coverage', () => {
    expect(summarizeInjectionTokenSplit(240, [
      { serialized_token_estimate: 100, fixed_item_gold_fraction: 1, fixed_token_gold_fraction: 0.5 },
      { serialized_token_estimate: 200, fixed_item_gold_fraction: 0, fixed_token_gold_fraction: 0.5 },
    ])).toEqual({
      requested_token_budget: 240,
      serialized_token_mean: 150,
      fixed_item_gold_fraction_mean: 0.5,
      fixed_token_gold_fraction_mean: 0.5,
    });
  });
});
