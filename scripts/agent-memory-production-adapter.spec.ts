import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { HybridSearchEngine } from '@memento/core';
import { adaptLoCoMo, loadAgentMemoryFixture } from './agent-memory-benchmark-adapter.js';
import {
  FUNNEL_STAGE_ORDER,
  buildFunnelStages,
  goldHitStats,
  meanFunnelGoldFraction,
  runProductionInjectionBenchmark,
  runProductionRecallBenchmark,
  selectedIdsFromInjectionPrompt,
  ENABLE_READER_ARMS,
} from './agent-memory-production-adapter.js';

const FIXTURE_DIR = join(process.cwd(), 'tests/fixtures/agent-memory-benchmark');

describe('production recall funnel helpers', () => {
  it('fixes stage order and gold any/all/fraction', () => {
    expect(FUNNEL_STAGE_ORDER).toEqual([
      'raw_text',
      'text_topN',
      'raw_vector',
      'thresholded_vector',
      'union',
      'final_top10',
    ]);

    expect(goldHitStats(['a', 'b'], ['a', 'c'])).toEqual({
      gold_any: true,
      gold_all: false,
      gold_fraction: 0.5,
    });
    expect(goldHitStats(['a'], ['x'])).toEqual({
      gold_any: false,
      gold_all: false,
      gold_fraction: 0,
    });

    const stages = buildFunnelStages({
      raw_text: ['a', 'b'],
      text_topN: ['a'],
      raw_vector: ['c', 'a'],
      thresholded_vector: ['a'],
      union: ['a', 'b', 'c'],
      final_top10: ['a'],
    }, ['a', 'c']);

    expect(stages.map((stage) => stage.name)).toEqual([...FUNNEL_STAGE_ORDER]);
    expect(stages[0]).toMatchObject({ name: 'raw_text', candidate_count: 2, gold_any: true, gold_all: false });
    expect(stages[5]).toMatchObject({ name: 'final_top10', candidate_count: 1, gold_fraction: 0.5 });

    expect(meanFunnelGoldFraction([{ funnel: stages }], 'raw_text')).toBe(0.5);
    expect(meanFunnelGoldFraction([{ funnel: stages }], 'text_topN')).toBe(0.5);
    expect(meanFunnelGoldFraction([], 'raw_text')).toBe(0);
  });
});

describe('agent memory production adapter', () => {
  it('preserves fixture IDs and invokes HybridSearchEngine.search (production path)', async () => {
    const dataset = loadAgentMemoryFixture(FIXTURE_DIR);
    const searchSpy = vi.spyOn(HybridSearchEngine.prototype, 'search');

    const result = await runProductionRecallBenchmark(dataset, dataset.manifest.top_k);

    expect(searchSpy).toHaveBeenCalledTimes(dataset.queries.length);
    expect(result.production_path).toBe('hybridSearchEngine.search');
    expect(result.embedding_provider).toBe('tfidf');
    expect(result.imported_ids).toEqual(dataset.documents.map((document) => document.id));
    expect(result.evaluations).toHaveLength(dataset.queries.length);
    expect(result.evaluations.some((evaluation) => evaluation.ranked.length > 0)).toBe(true);
  }, 120_000);

  it('records per-query funnel stages, gold hits, and ranking provenance', async () => {
    const dataset = loadAgentMemoryFixture(FIXTURE_DIR);
    const result = await runProductionRecallBenchmark(dataset, dataset.manifest.top_k);

    expect(result.ranking_version).toMatch(/^ranking-sha256:[a-f0-9]{12}$/);
    expect(typeof result.ranking_weights_path_override).toBe('boolean');
    expect(result.vector_threshold).toBeGreaterThanOrEqual(0);
    expect(result.vector_prefetch).toBeGreaterThan(0);
    expect(result.text_weight).toBeGreaterThan(0);
    expect(result.vector_weight).toBeGreaterThan(0);

    for (const evaluation of result.evaluations) {
      expect(evaluation.funnel.map((stage) => stage.name)).toEqual([...FUNNEL_STAGE_ORDER]);
      for (const stage of evaluation.funnel) {
        expect(stage.candidate_count).toBeGreaterThanOrEqual(0);
        expect(typeof stage.gold_any).toBe('boolean');
        expect(typeof stage.gold_all).toBe('boolean');
        expect(stage.gold_fraction).toBeGreaterThanOrEqual(0);
        expect(stage.gold_fraction).toBeLessThanOrEqual(1);
      }
      const byName = Object.fromEntries(evaluation.funnel.map((stage) => [stage.name, stage]));
      expect(byName.raw_vector.candidate_count).toBeGreaterThanOrEqual(byName.thresholded_vector.candidate_count);
      expect(byName.raw_text.candidate_count).toBeGreaterThanOrEqual(byName.text_topN.candidate_count);
    }
  }, 120_000);

  it('keeps engine production_path and runs a separate injection bundle strategy (#790)', async () => {
    const dataset = loadAgentMemoryFixture(FIXTURE_DIR);
    const engine = await runProductionRecallBenchmark(dataset, dataset.manifest.top_k);
    const injection = await runProductionInjectionBenchmark(dataset, {
      topK: dataset.manifest.top_k,
      tokenBudget: dataset.manifest.token_budget,
    });

    expect(engine.production_path).toBe('hybridSearchEngine.search');
    expect(injection.production_path).toBe('buildKnowledgeContextBundle');
    expect(injection.evaluations).toHaveLength(dataset.queries.length);
    expect(injection.requested_token_budget).toBe(dataset.manifest.token_budget);
    expect(injection.reader_arms).toBeUndefined();
    expect(ENABLE_READER_ARMS).toBe(false);
  }, 120_000);

  it('connects engine IDs to injection selected content on the synthetic LoCoMo-shape fixture (#790)', async () => {
    const dataset = adaptLoCoMo(join(FIXTURE_DIR, 'locomo-shape-sample.json'));
    const injection = await runProductionInjectionBenchmark(dataset, {
      topK: dataset.manifest.top_k,
      tokenBudget: dataset.manifest.token_budget,
    });
    const documents = new Map(dataset.documents.map((document) => [document.id, document]));

    expect(injection.evaluations.some((evaluation) => evaluation.selected_ids.length > 0)).toBe(true);
    for (const evaluation of injection.evaluations) {
      expect(evaluation.engine_ids.length).toBeGreaterThan(0);
      expect(evaluation.serialized_token_estimate).toBeGreaterThanOrEqual(0);
      expect(evaluation.fixed_item_gold_fraction).toBeGreaterThanOrEqual(0);
      expect(evaluation.fixed_token_gold_fraction).toBeGreaterThanOrEqual(0);
      const reconstructed = selectedIdsFromInjectionPrompt(evaluation.prompt_text, dataset.documents);
      expect(reconstructed).toEqual(evaluation.selected_ids);
      for (const id of evaluation.selected_ids) {
        const document = documents.get(id);
        expect(document).toBeDefined();
        expect(evaluation.prompt_text).toContain(document!.content.slice(0, 24));
        expect(evaluation.engine_ids).toContain(id);
      }
    }
  }, 120_000);
});
