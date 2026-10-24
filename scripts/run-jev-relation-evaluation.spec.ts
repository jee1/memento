import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { runEvaluation } from './run-jev-relation-evaluation.mjs';

function fixture(status = 'reviewed') {
  return Buffer.from(JSON.stringify({
    version: 1,
    review: status === 'accepted'
      ? { status, accepted_by: 'test-operator', accepted_at: '2026-10-24T00:00:00Z' }
      : { status, reviewer: 'test-fixture', reviewed_at: '2026-10-24T00:00:00Z' },
    cases: ['accepted', 'rejected', 'error', 'ambiguous'].map(id => ({
      id, source: { type: 'episodic', content: 'Synthetic source.' },
      target: { type: 'semantic', content: 'Synthetic target.' },
      expected: { relevance: id === 'ambiguous' ? 'ambiguous' : 'related', types: id === 'ambiguous' ? [] : ['REFERENCES'], reason: 'Synthetic test only.' },
    })),
  }));
}

const metadata = { revision: 'test-revision', code_sha256: 'test-hash', model: 'test-model', created_at: '2026-10-24T00:00:00Z' };

describe('shared Jev judge evaluation runner', () => {
  it('preserves pair direction, rejection, errors and round evidence without emitting text', async () => {
    const rounds = [{ questions: [{ id: 'r0', instructions: 'test question' }], ok: true, scores: [['r0', 0.9]] }];
    const judgePair = vi.fn(async (source, target) => ({
      outcome: source.id === 'error_source'
        ? { ok: false, reason: 'timeout' }
        : { ok: true, candidates: source.id === 'accepted_source' ? [{
          source_id: source.id, target_id: target.id, relation_type: 'REFERENCES', confidence: 0.8,
        }] : [] },
      rounds,
    }));
    const snapshot = await runEvaluation(fixture(), { judgePair, ...metadata });
    expect(judgePair).toHaveBeenCalledTimes(4);
    expect(judgePair.mock.calls[0]?.[0]).toMatchObject({ id: 'accepted_source', type: 'episodic', content: 'Synthetic source.' });
    expect(judgePair.mock.calls[0]?.[1]).toMatchObject({ id: 'accepted_target', type: 'semantic', content: 'Synthetic target.' });
    expect(snapshot.results.map(({ id, status, relation_type }) => ({ id, status, relation_type }))).toEqual([
      { id: 'accepted', status: 'ok', relation_type: 'REFERENCES' },
      { id: 'rejected', status: 'ok', relation_type: null },
      { id: 'error', status: 'error', relation_type: null },
      { id: 'ambiguous', status: 'ok', relation_type: null },
    ]);
    expect(snapshot.results[0]).toMatchObject({ confidence: 0.8, rounds });
    expect(snapshot.results[2]).toMatchObject({ reason: 'timeout' });
    expect(JSON.stringify(snapshot)).not.toContain('Synthetic source.');
    expect(snapshot).toMatchObject(metadata);
    expect(snapshot).toMatchObject({ input_review_status: 'reviewed', human_reviewed: true });
    expect(snapshot.fixture_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('runs accepted labels while marking the snapshot as not human-reviewed', async () => {
    const judgePair = async () => ({ outcome: { ok: true, candidates: [] }, rounds: [] });
    const snapshot = await runEvaluation(fixture('accepted'), { judgePair, ...metadata });
    expect(snapshot).toMatchObject({ input_review_status: 'accepted', human_reviewed: false });
    expect(snapshot.results).toHaveLength(4);
  });

  it('rejects unreviewed input before invoking a judge', async () => {
    const judgePair = vi.fn();
    await expect(runEvaluation(fixture('pending'), { judgePair, ...metadata })).rejects.toThrow();
    expect(judgePair).not.toHaveBeenCalled();
  });

  it('refuses reversed endpoints rather than silently scoring them in the requested direction', async () => {
    const judgePair = async (source, target) => ({ outcome: { ok: true, candidates: [{
      source_id: target.id, target_id: source.id, relation_type: 'REFERENCES', confidence: 0.8,
    }] }, rounds: [] });
    await expect(runEvaluation(fixture(), { judgePair, ...metadata })).rejects.toThrow('Unexpected judge output');
  });

  it('fails the actual CLI without arguments using a sanitized error', () => {
    const script = fileURLToPath(new URL('./run-jev-relation-evaluation.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' } });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('Jev evaluation run failed: check accepted or reviewed fixture, built core and API configuration.\n');
  });
});
