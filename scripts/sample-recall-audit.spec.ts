import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const seed = 'ab'.repeat(32);
const row = (request_id: string, privacy_scope = 'private', occurred_at = '2026-10-25T12:00:00.000Z') => ({
  request_id, privacy_scope, occurred_at,
});
const frame = (requests = Array.from({ length: 12 }, (_, i) => row(`synthetic-${i}`))) => ({
  period_start: '2026-10-24T00:00:00.000Z',
  period_end: '2026-10-31T00:00:00.000Z',
  frame_complete: true,
  requests,
});

describe('weekly recall audit CLI', () => {
  let dir: string;
  let input: string;
  const cli = resolve('scripts/sample-recall-audit.mjs');
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, '--input', input, ...args], {
    encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' },
  });
  const save = (value: unknown) => writeFileSync(input, JSON.stringify(value));
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'recall-audit-'));
    input = join(dir, 'frame.json');
    save(frame());
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('samples five unique requests reproducibly without leaking references or modifying input', () => {
    const before = readFileSync(input);
    const first = run('--seed', seed);
    expect(first.status, first.stderr).toBe(0);
    const audit = JSON.parse(first.stdout);
    expect(audit).toMatchObject({
      label_source: 'agent_panel', panel_status: 'pending', sample_origin: 'weekly_random',
      eligible_count: 12, sample_count: 5, shortfall: 0, seed, frame_sha256: hash(before.toString()),
      runner_sha256: hash(readFileSync(cli, 'utf8')),
    });
    expect(new Set(audit.samples.map((s: { request_sha256: string }) => s.request_sha256)).size).toBe(5);
    expect(run('--seed', seed).stdout).toBe(first.stdout);
    expect(first.stdout).not.toContain('synthetic-');
    expect(readFileSync(input)).toEqual(before);
    save(frame(frame().requests.reverse()));
    expect(JSON.parse(run('--seed', seed).stdout).samples).toEqual(audit.samples);
    expect(JSON.parse(run('--seed', 'cd'.repeat(32)).stdout).samples).not.toEqual(audit.samples);
    const random = JSON.parse(run().stdout);
    expect(random.seed).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(run('--seed', random.seed).stdout)).toEqual(random);
  });

  it('uses private requests in [start,end), retaining naturally sampled empty/failure cases', () => {
    save(frame([
      row('empty', 'private', '2026-10-24T00:00:00.000Z'),
      row('failed'), row('fallback'), row('team', 'team'), row('public', 'public'),
      row('before', 'private', '2026-10-23T23:59:59.999Z'),
      row('end', 'private', '2026-10-31T00:00:00.000Z'),
    ]));
    const audit = JSON.parse(run('--seed', seed).stdout);
    expect(audit).toMatchObject({ eligible_count: 3, sample_count: 3, shortfall: 2 });
    expect(audit.samples.map((s: { request_sha256: string }) => s.request_sha256).sort())
      .toEqual(['empty', 'failed', 'fallback'].map(hash).sort());
    save(frame([]));
    expect(JSON.parse(run().stdout)).toMatchObject({ eligible_count: 0, sample_count: 0, shortfall: 5, samples: [] });
  });

  it('rejects incomplete frames, duplicate requests, malformed metadata and private text without echoing input', () => {
    const invalid = [
      { ...frame(), frame_complete: false },
      { ...frame(), period_end: '2026-11-01T00:00:00.000Z' },
      { ...frame(), query: 'PRIVATE_SENTINEL' },
      frame([row('duplicate'), row('duplicate')]),
      frame([row('PRIVATE_SENTINEL', 'unknown')]),
      frame([row('PRIVATE_SENTINEL', 'private', '2026-02-30T00:00:00.000Z')]),
      frame([row('PRIVATE_SENTINEL', 'private', '2026-10-25')]),
      frame([row(' ')]),
      { ...frame(), requests: [{ ...row('r'), content: 'PRIVATE_SENTINEL' }] },
      { ...frame(), requests: [{ request_id: 'r', occurred_at: '2026-10-25T12:00:00.000Z' }] },
      { ...frame(), requests: null },
      null,
    ];
    for (const value of invalid) {
      save(value);
      const result = run();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).not.toContain('PRIVATE_SENTINEL');
      expect(result.stderr).not.toContain(input);
    }
    save(frame());
    expect(run('--seed', 'bad').status).toBe(1);
    expect(run('--db', '/never-open-a-db').status).toBe(1);
    writeFileSync(input, '{PRIVATE_SENTINEL');
    expect(run().stderr).not.toContain('PRIVATE_SENTINEL');
  });
});
