import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  aggregateJudgeResults,
  runLongMemEvalValidation,
} from './longmemeval-validation.js';

const FIXTURE_DIR = join(process.cwd(), 'tests/fixtures/agent-memory-benchmark');

describe('LongMemEval validation artifacts', () => {
  it('writes explicit skip evidence when the external dataset is absent', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'longmemeval-validation-'));

    const result = runLongMemEvalValidation({
      datasetPath: join(outputDir, 'missing.json'),
      outputDir,
      seed: 483,
    });

    expect(result.status).toBe('skipped');
    expect(result.reason_codes).toContain('dataset_missing');
    expect(JSON.parse(readFileSync(join(outputDir, 'manifest.json'), 'utf8'))).toEqual(
      expect.objectContaining({
        status: 'skipped',
        dataset: expect.objectContaining({
          vendored: false,
          path_present: false,
        }),
      }),
    );
    expect(JSON.parse(readFileSync(join(outputDir, 'results.json'), 'utf8'))).toEqual(
      expect.objectContaining({
        retrieval: { status: 'not_run', reason: 'dataset_missing' },
        task_completion: { status: 'not_run', reason: 'dataset_missing' },
      }),
    );
    expect(readFileSync(join(outputDir, 'limitations.md'), 'utf8')).toContain(
      'dataset_missing',
    );
  });

  it('runs all retrieval baselines and records a missing judge as a separate skip', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'longmemeval-validation-'));
    const datasetPath = join(FIXTURE_DIR, 'longmemeval-s-official-shape.json');

    const result = runLongMemEvalValidation({
      datasetPath,
      outputDir,
      datasetRevision: 'fixture-revision',
      seed: 483,
    });
    const results = JSON.parse(readFileSync(join(outputDir, 'results.json'), 'utf8')) as {
      retrieval: { status: string; baselines: Record<string, unknown> };
      task_completion: { status: string; reason: string };
      graph_rrf: { default_enabled: boolean };
    };

    expect(result.status).toBe('partial');
    expect(Object.keys(results.retrieval.baselines)).toEqual([
      'grep',
      'fts_only',
      'vector',
      'memento',
    ]);
    expect(results.task_completion).toEqual(expect.objectContaining({
      status: 'not_run',
      reason: 'judge_results_missing',
    }));
    expect(results.graph_rrf.default_enabled).toBe(false);
  });

  it('aggregates correctness and cited evidence coverage from the judge protocol', () => {
    const aggregate = aggregateJudgeResults([
      {
        question_id: 'q1',
        hypothesis: 'Friday',
        correct: true,
        cited_evidence_session_ids: ['s1', 's2'],
        required_evidence_session_ids: ['s2'],
        judge: {
          provider: 'openai-compatible',
          model: 'judge-model',
          prompt_version: 'longmemeval-v1',
        },
      },
      {
        question_id: 'q2',
        hypothesis: 'Unknown',
        correct: false,
        cited_evidence_session_ids: [],
        required_evidence_session_ids: ['s3'],
        judge: {
          provider: 'human',
          model: 'reviewer',
          prompt_version: 'longmemeval-v1',
        },
      },
    ]);

    expect(aggregate).toEqual({
      status: 'completed',
      case_count: 2,
      accuracy: 0.5,
      evidence_coverage: 0.5,
      judges: ['human/reviewer', 'openai-compatible/judge-model'],
      prompt_versions: ['longmemeval-v1'],
    });
  });
});
