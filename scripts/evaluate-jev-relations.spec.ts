import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateComparison } from './evaluate-jev-relations.mjs';
import { MEMORY_TYPE_RELATION_MAP } from '../packages/memento-core/src/shared/types/relation.js';
import { RELATION_TEXT_CHARS } from '../packages/memento-core/src/domains/relation/services/relation-candidate-pool.js';

function fixture() {
  return {
    version: 1,
    review: { status: 'reviewed', reviewer: 'test-fixture', reviewed_at: '2026-10-24T00:00:00.000Z' },
    cases: ([
      ['follow', 'related', ['FOLLOWS']],
      ['contrast', 'related', ['CONTRASTS_WITH']],
      ['reference', 'related', ['REFERENCES']],
      ['unrelated', 'unrelated', []],
      ['ambiguous', 'ambiguous', []],
      ['no-supported-type', 'related', []],
    ] satisfies Array<[string, string, string[]]>).map(([id, relevance, types]) => ({
      id, source: { type: 'episodic', content: 'PRIVATE_SOURCE_DO_NOT_PRINT' },
      target: { type: 'episodic', content: 'PRIVATE_TARGET_DO_NOT_PRINT' },
      expected: { relevance, types, reason: 'Synthetic test labels, not human-reviewed gold.' },
    })),
  };
}

function setup() {
  const data = fixture();
  const bytes = Buffer.from(JSON.stringify(data));
  const snapshot = {
    fixture_sha256: createHash('sha256').update(bytes).digest('hex'),
    revision: 'test-revision',
    results: data.cases.map(item => ({ id: item.id, status: 'ok', relation_type: null as string | null })),
  };
  return { data, bytes, snapshot };
}

describe('Jev fixed-pair evaluation', () => {
  it('keeps checked-in accepted labels compatible with the actual judge input', () => {
    const bytes = readFileSync(new URL('../tests/fixtures/jev-relation-quality/pairs.json', import.meta.url));
    const data = JSON.parse(bytes.toString()) as ReturnType<typeof fixture>;
    expect(data.review.status).toBe('accepted');
    const snapshot = {
      fixture_sha256: createHash('sha256').update(bytes).digest('hex'),
      revision: 'test-fixture',
      results: data.cases.map(item => ({ id: item.id, status: 'ok', relation_type: null })),
    };
    expect(evaluateComparison(bytes, snapshot, snapshot)).toMatchObject({
      input_review_status: 'accepted', human_reviewed: false,
      candidate: { evaluable_count: 24 },
    });
    for (const item of data.cases) {
      const allowed = MEMORY_TYPE_RELATION_MAP[item.source.type as keyof typeof MEMORY_TYPE_RELATION_MAP];
      expect(allowed, String(item.id)).toEqual(expect.arrayContaining(item.expected.types));
      expect(item.source.content.length).toBeLessThanOrEqual(RELATION_TEXT_CHARS);
      expect(item.target.content.length).toBeLessThanOrEqual(RELATION_TEXT_CHARS);
    }
  });

  it('labels accepted inputs exploratory and preserves snapshot execution provenance', () => {
    const { data, snapshot } = setup();
    const accepted = { ...data, review: { status: 'accepted', accepted_by: 'test-operator', accepted_at: '2026-10-24T00:00:00Z' } };
    const bytes = Buffer.from(JSON.stringify(accepted));
    const run = {
      ...snapshot, fixture_sha256: createHash('sha256').update(bytes).digest('hex'),
      code_sha256: 'test-code-hash', model: 'test-model', created_at: '2026-10-24T00:00:00Z',
    };
    expect(evaluateComparison(bytes, run, run)).toMatchObject({
      input_review_status: 'accepted', human_reviewed: false,
      baseline: { code_sha256: run.code_sha256, model: run.model, created_at: run.created_at },
      candidate: { code_sha256: run.code_sha256, model: run.model, created_at: run.created_at },
    });
    const reviewed = setup();
    expect(evaluateComparison(reviewed.bytes, reviewed.snapshot, reviewed.snapshot)).toMatchObject({
      input_review_status: 'reviewed', human_reviewed: true,
    });
  });

  it.each(['missing-actor', 'missing-time', 'invalid-time'])('rejects incomplete accepted provenance: %s', kind => {
    const { data, snapshot } = setup();
    const accepted = {
      ...data,
      review: {
        status: 'accepted', accepted_by: kind === 'missing-actor' ? '' : 'test-operator',
        accepted_at: kind === 'missing-time' ? '' : kind === 'invalid-time' ? 'not-a-date' : '2026-10-24T00:00:00Z',
      },
    };
    const bytes = Buffer.from(JSON.stringify(accepted));
    snapshot.fixture_sha256 = createHash('sha256').update(bytes).digest('hex');
    expect(() => evaluateComparison(bytes, snapshot, snapshot)).toThrow();
  });

  it('does not reward rejecting every pair and excludes ambiguous cases', () => {
    const { bytes, snapshot } = setup();
    const report = evaluateComparison(bytes, snapshot, snapshot).candidate;
    expect(report).toMatchObject({
      evaluable_count: 5, ambiguous_count: 1, accepted_count: 0,
      type_precision: null, unrelated_connection_rate: null,
      unrelated_false_positive_rate: 0, false_negative_rate: 1,
      rejection_rate: 1, error_rate: 0,
    });
    expect(report.by_type.FOLLOWS).toEqual({ expected: 1, predicted: 0, correct: 0, precision: null, missed_rate: 1 });
  });

  it('counts wrong kinds as false positives and missed positives while separating errors', () => {
    const { bytes, snapshot } = setup();
    snapshot.results[0]!.relation_type = 'CONTRASTS_WITH';
    snapshot.results[1]!.relation_type = 'CONTRASTS_WITH';
    snapshot.results[2]!.status = 'error';
    snapshot.results[3]!.relation_type = 'FOLLOWS';
    snapshot.results[4]!.relation_type = 'REFERENCES';
    const report = evaluateComparison(bytes, snapshot, snapshot).candidate;
    expect(report).toMatchObject({
      accepted_count: 3, type_precision: 1 / 3, false_negative_rate: 2 / 3,
      unrelated_connection_rate: 1 / 3, unrelated_false_positive_rate: 1,
      rejection_rate: 1 / 5, error_rate: 1 / 5, wrong_type_count: 1,
    });
    expect(report.by_type.CONTRASTS_WITH).toEqual({ expected: 1, predicted: 2, correct: 1, precision: 0.5, missed_rate: 0 });
    expect(report.by_type.FOLLOWS).toEqual({ expected: 1, predicted: 1, correct: 0, precision: 0, missed_rate: 1 });
    expect(report.by_type.REFERENCES.predicted).toBe(0);
  });

  it('accepts any explicitly allowed type without counting an alternative as missed', () => {
    const { data, snapshot } = setup();
    data.cases[0]!.expected.types = ['FOLLOWS', 'REFERENCES'];
    const bytes = Buffer.from(JSON.stringify(data));
    snapshot.fixture_sha256 = createHash('sha256').update(bytes).digest('hex');
    snapshot.results[0]!.relation_type = 'REFERENCES';
    const report = evaluateComparison(bytes, snapshot, snapshot).candidate;
    expect(report.by_type.FOLLOWS.missed_rate).toBe(0);
    expect(report.false_negative_rate).toBe(2 / 3);
  });

  it('hashes exact fixture bytes and leaves empty denominators undefined', () => {
    const { data, bytes, snapshot } = setup();
    expect(() => evaluateComparison(Buffer.concat([bytes, Buffer.from('\n')]), snapshot, snapshot)).toThrow();
    for (const item of data.cases) item.expected = { relevance: 'ambiguous', types: [], reason: 'Synthetic ambiguous case.' };
    const ambiguousBytes = Buffer.from(JSON.stringify(data));
    snapshot.fixture_sha256 = createHash('sha256').update(ambiguousBytes).digest('hex');
    const report = evaluateComparison(ambiguousBytes, snapshot, snapshot).candidate;
    expect(report).toMatchObject({
      evaluable_count: 0, ambiguous_count: 6, type_precision: null,
      false_negative_rate: null, rejection_rate: null, error_rate: null,
    });
  });

  it.each(['pending', 'missing-reviewer', 'missing-date', 'invalid-memory', 'invalid-type', 'duplicate-case', 'unrelated-types', 'empty-reason'])(
    'rejects invalid fixture: %s', kind => {
      const { data, snapshot } = setup();
      if (kind === 'pending') data.review.status = 'pending';
      if (kind === 'missing-reviewer') data.review.reviewer = '';
      if (kind === 'missing-date') data.review.reviewed_at = '';
      if (kind === 'invalid-memory') data.cases[0]!.source.type = 'unknown';
      if (kind === 'invalid-type') data.cases[0]!.expected.types = ['UNKNOWN'];
      if (kind === 'duplicate-case') data.cases[1]!.id = data.cases[0]!.id;
      if (kind === 'unrelated-types') data.cases[3]!.expected.types = ['FOLLOWS'];
      if (kind === 'empty-reason') data.cases[0]!.expected.reason = ' ';
      const bytes = Buffer.from(JSON.stringify(data));
      snapshot.fixture_sha256 = createHash('sha256').update(bytes).digest('hex');
      expect(() => evaluateComparison(bytes, snapshot, snapshot)).toThrow('Invalid Jev evaluation input');
    },
  );

  it.each(['missing-result', 'duplicate-result', 'unknown-id', 'mismatched-hash', 'invalid-type', 'error-with-edge', 'invalid-status', 'empty-revision'])(
    'rejects invalid snapshot: %s', kind => {
      const { bytes, snapshot } = setup();
      const candidate = structuredClone(snapshot);
      if (kind === 'missing-result') candidate.results.pop();
      if (kind === 'duplicate-result') candidate.results[1]!.id = candidate.results[0]!.id;
      if (kind === 'unknown-id') candidate.results[0]!.id = 'unknown';
      if (kind === 'mismatched-hash') candidate.fixture_sha256 = 'bad';
      if (kind === 'invalid-type') candidate.results[0]!.relation_type = 'UNKNOWN';
      if (kind === 'error-with-edge') Object.assign(candidate.results[0]!, { status: 'error', relation_type: 'FOLLOWS' });
      if (kind === 'invalid-status') candidate.results[0]!.status = 'unknown';
      if (kind === 'empty-revision') candidate.revision = ' ';
      expect(() => evaluateComparison(bytes, snapshot, candidate)).toThrow('Invalid Jev evaluation input');
    },
  );

  it('runs the real CLI and keeps failed input, paths and memory text out of output', () => {
    const directory = mkdtempSync(join(tmpdir(), 'jev-evaluation-'));
    const script = fileURLToPath(new URL('./evaluate-jev-relations.mjs', import.meta.url));
    const { bytes, snapshot } = setup();
    const fixturePath = join(directory, 'fixture.json');
    const baselinePath = join(directory, 'baseline.json');
    const candidatePath = join(directory, 'candidate.json');
    const args = [script, '--fixture', fixturePath, '--baseline', baselinePath, '--candidate', candidatePath];
    try {
      writeFileSync(fixturePath, bytes);
      writeFileSync(baselinePath, JSON.stringify(snapshot));
      writeFileSync(candidatePath, JSON.stringify({ ...snapshot, revision: 'candidate-revision' }));
      const success = spawnSync(process.execPath, args, { encoding: 'utf8' });
      expect(success.status).toBe(0);
      expect(success.stderr).toBe('');
      expect(JSON.parse(success.stdout)).toMatchObject({
        baseline: { revision: 'test-revision' }, candidate: { revision: 'candidate-revision' },
      });
      expect(success.stdout).not.toContain('PRIVATE_');
      writeFileSync(candidatePath, 'PRIVATE_BROKEN_JSON');
      const failure = spawnSync(process.execPath, args, { encoding: 'utf8' });
      expect(failure.status).toBe(1);
      expect(failure.stdout).toBe('');
      expect(failure.stderr).toContain('Jev evaluation failed');
      expect(failure.stderr).not.toContain('PRIVATE_');
      expect(failure.stderr).not.toContain(directory);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
