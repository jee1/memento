import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { HybridSearchEngine } from '@memento/core';
import { loadAgentMemoryFixture } from './agent-memory-benchmark-adapter.js';
import { runProductionRecallBenchmark } from './agent-memory-production-adapter.js';

const FIXTURE_DIR = join(process.cwd(), 'tests/fixtures/agent-memory-benchmark');

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
});
