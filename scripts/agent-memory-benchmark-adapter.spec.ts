import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  adaptLoCoMo,
  adaptLongMemEvalS,
  assertDatasetSafe,
  loadAgentMemoryFixture,
  LOCOMO_CATEGORY_LABELS,
  type AgentMemoryBenchmarkDataset,
} from './agent-memory-benchmark-adapter.js';

const FIXTURE_DIR = join(process.cwd(), 'tests/fixtures/agent-memory-benchmark');
const KO_FIXTURE_DIR = join(process.cwd(), 'tests/fixtures/agent-memory-benchmark-ko');

describe('agent memory benchmark adapter', () => {
  it('loads the reviewed native coding-agent fixture', () => {
    const dataset = loadAgentMemoryFixture(FIXTURE_DIR);

    expect(dataset.manifest.license_reviewed).toBe(true);
    expect(dataset.manifest.secret_reviewed).toBe(true);
    expect(dataset.documents.length).toBeGreaterThanOrEqual(10);
    expect(dataset.queries.length).toBeGreaterThanOrEqual(4);
    expect(() => assertDatasetSafe(dataset)).not.toThrow();
  });

  it('loads the synthetic Korean recall gold fixture (#808)', () => {
    const dataset = loadAgentMemoryFixture(KO_FIXTURE_DIR);

    expect(dataset.manifest.synthetic).toBe(true);
    expect(dataset.manifest.license_reviewed).toBe(true);
    expect(dataset.manifest.secret_reviewed).toBe(true);
    expect(dataset.manifest.redistribution).toBe('allowed');
    expect(dataset.documents.length).toBeGreaterThanOrEqual(15);
    expect(dataset.queries.length).toBeGreaterThanOrEqual(15);
    expect(dataset.documents.every((doc) => doc.id.startsWith('ko_mem_'))).toBe(true);
    expect(dataset.queries.some((query) => query.tags?.includes('particle_agglutination'))).toBe(true);
    expect(dataset.queries.some((query) => query.tags?.includes('short_multi_concept'))).toBe(true);
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

  it('normalizes the official LongMemEval-S JSON array at session granularity', () => {
    const dataset = adaptLongMemEvalS(
      join(FIXTURE_DIR, 'longmemeval-s-official-shape.json'),
      { sourceRevision: 'fixture-revision' },
    );

    expect(dataset.manifest.synthetic).toBe(false);
    expect(dataset.manifest.source_revision).toBe('fixture-revision');
    expect(dataset.manifest.redaction_count).toBe(1);
    expect(dataset.documents).toEqual([
      expect.objectContaining({
        id: 'question-1:000:session-1',
        sessionId: 'session-1',
        scopeId: 'question-1',
        content: expect.stringContaining('[user] I prefer window seats.'),
      }),
      expect.objectContaining({
        id: 'question-1:001:session-2',
        sessionId: 'session-2',
        content: expect.stringContaining('[assistant] Your flight is on Friday.'),
      }),
      expect.objectContaining({
        id: 'question-2:000:session-3',
        sessionId: 'session-3',
        content: expect.stringContaining('[REDACTED:API_key]'),
      }),
    ]);
    expect(dataset.queries).toEqual([
      {
        id: 'question-1',
        scopeId: 'question-1',
        query: 'When is my flight?',
        relevantIds: ['question-1:001:session-2'],
        targetSessionIds: ['session-2'],
      },
    ]);
    expect(dataset.e2eCases).toEqual([
      {
        id: 'longmemeval-question-1',
        queryId: 'question-1',
        requiredEvidenceIds: ['question-1:001:session-2'],
        tokenBudget: 4096,
      },
    ]);
    expect(dataset.taskCases).toEqual([
      expect.objectContaining({
        id: 'question-1',
        expectedAnswer: 'Friday',
        abstention: false,
      }),
      expect.objectContaining({
        id: 'question-2_abs',
        expectedAnswer: '0',
        abstention: true,
      }),
    ]);
  });

  it('normalizes LoCoMo at session granularity and records the NonCommercial license', () => {
    const dataset = adaptLoCoMo(join(FIXTURE_DIR, 'locomo-shape-sample.json'), {
      sourceRevision: 'fixture-revision',
    });

    expect(dataset.manifest.license).toMatch(/CC BY-NC 4\.0/);
    expect(dataset.manifest.commercial_use).toBe(false);
    expect(dataset.manifest.source_revision).toBe('fixture-revision');
    expect(dataset.documents.map((document) => document.id)).toEqual([
      'synthetic-conv-1:session_1',
      'synthetic-conv-1:session_2',
      'synthetic-conv-1:session_3',
    ]);
    // Session date "1:56 pm on 8 May, 2023" is normalized to UTC.
    expect(dataset.documents[0]?.createdAt).toBe('2023-05-08T13:56:00.000Z');
    // blip_caption is kept so image-grounded turns stay retrievable.
    expect(dataset.documents[1]?.content).toContain('[image: a potted fig tree beside a window]');
    expect(() => assertDatasetSafe(dataset)).not.toThrow();
  });

  it('resolves packed LoCoMo evidence and drops references it cannot map', () => {
    const dataset = adaptLoCoMo(join(FIXTURE_DIR, 'locomo-shape-sample.json'));
    const queryById = new Map(dataset.queries.map((query) => [query.id, query]));

    // "D1:1; D2:2" packs two references into a single string.
    expect(queryById.get('synthetic-conv-1:qa-0002')?.relevantIds).toEqual([
      'synthetic-conv-1:session_1',
      'synthetic-conv-1:session_2',
    ]);
    // "D" is unparseable and "D2:99" is a dangling turn index within a real session.
    expect(queryById.get('synthetic-conv-1:qa-0005')?.relevantIds).toEqual([
      'synthetic-conv-1:session_1',
      'synthetic-conv-1:session_2',
    ]);
    // The empty-evidence question is skipped as a retrieval query but stays auditable.
    expect(queryById.has('synthetic-conv-1:qa-0003')).toBe(false);
    expect(dataset.manifest.skipped_query_count).toBe(1);
  });

  it('keeps LoCoMo adversarial questions out of retrieval scoring', () => {
    const dataset = adaptLoCoMo(join(FIXTURE_DIR, 'locomo-shape-sample.json'));
    const adversarial = dataset.taskCases?.find((testCase) => testCase.abstention);

    expect(LOCOMO_CATEGORY_LABELS[5]).toBe('adversarial');
    expect(adversarial?.id).toBe('synthetic-conv-1:qa-0004');
    expect(adversarial?.questionType).toBe('adversarial');
    expect(adversarial?.expectedAnswer).toBe('the studio downtown');
    expect(dataset.queries.some((query) => query.id === adversarial?.id)).toBe(false);
    expect(dataset.e2eCases.some((testCase) => testCase.queryId === adversarial?.id)).toBe(false);
    // Every non-adversarial category label matches the upstream scorer's grouping.
    expect(dataset.taskCases?.map((testCase) => testCase.questionType)).toEqual([
      'single_hop',
      'temporal_reasoning',
      'multi_hop',
      'open_domain_knowledge',
      'adversarial',
      'multi_hop',
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
