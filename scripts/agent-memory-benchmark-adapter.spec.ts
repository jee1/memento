import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  adaptLongMemEvalS,
  assertDatasetSafe,
  loadAgentMemoryFixture,
  type AgentMemoryBenchmarkDataset,
} from './agent-memory-benchmark-adapter.js';

const FIXTURE_DIR = join(process.cwd(), 'tests/fixtures/agent-memory-benchmark');

describe('agent memory benchmark adapter', () => {
  it('loads the reviewed native coding-agent fixture', () => {
    const dataset = loadAgentMemoryFixture(FIXTURE_DIR);

    expect(dataset.manifest.license_reviewed).toBe(true);
    expect(dataset.manifest.secret_reviewed).toBe(true);
    expect(dataset.documents.length).toBeGreaterThanOrEqual(10);
    expect(dataset.queries.length).toBeGreaterThanOrEqual(4);
    expect(() => assertDatasetSafe(dataset)).not.toThrow();
  });

  it('normalizes the LongMemEval-S retrieval fixture', () => {
    const dataset = adaptLongMemEvalS(join(FIXTURE_DIR, 'longmemeval-s-sample.jsonl'));

    expect(dataset.documents.map((document) => document.id)).toEqual([
      'lme-memory-1',
      'lme-memory-2',
      'lme-memory-3',
    ]);
    expect(dataset.queries).toEqual([
      expect.objectContaining({
        id: 'lme-question-1',
        relevantIds: ['lme-memory-2'],
        targetSessionIds: ['lme-session-2'],
      }),
    ]);
  });

  it('fails closed when a corpus contains a credential marker', () => {
    const unsafe: AgentMemoryBenchmarkDataset = {
      manifest: {
        benchmark_version: 'test',
        name: 'unsafe',
        license: 'MIT',
        redistribution: 'allowed',
        license_reviewed: true,
        secret_reviewed: true,
        synthetic: true,
        source_revision: 'test',
        seed: 1,
        top_k: 10,
        token_budget: 100,
        gates: {
          min_recall_at_10_delta: 0,
          max_quality_regression: 0,
          max_p95_latency_ms: 1000,
          max_p95_latency_ratio: 2,
          max_duplicate_rate: 0.1,
          max_session_concentration: 0.8,
        },
      },
      documents: [{
        id: 'unsafe-memory',
        sessionId: 'session-1',
        content: 'Authorization: Bearer ghp_123456789012345678901234567890123456',
        type: 'episodic',
        createdAt: '2026-01-01T00:00:00.000Z',
        provenanceObservationIds: [],
      }],
      queries: [{
        id: 'query-1',
        query: 'credential',
        relevantIds: ['unsafe-memory'],
        targetSessionIds: ['session-1'],
      }],
      graphEdges: [],
      e2eCases: [],
    };

    expect(() => assertDatasetSafe(unsafe)).toThrow(/secret marker/i);
  });

  it('rejects unreviewed or non-redistributable manifests', () => {
    const dataset = loadAgentMemoryFixture(FIXTURE_DIR);
    const unreviewed: AgentMemoryBenchmarkDataset = {
      ...dataset,
      manifest: {
        ...dataset.manifest,
        license_reviewed: false,
        redistribution: 'restricted',
      },
    };

    expect(() => assertDatasetSafe(unreviewed)).toThrow(/license review/i);
  });
});
