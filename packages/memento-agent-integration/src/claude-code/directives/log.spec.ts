import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appendLine, readInContext } from './log.js';
import { caseId, injId, sessionId, type InjectionLine } from './types.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 9, 25, 12, 0, 0).getTime();

const injection = (
  session: string,
  cases: string[],
  overrides: Partial<InjectionLine> = {},
): InjectionLine => ({
  inj_id: injId('abcd1234-1-aaaaaa'),
  ts: new Date(NOW).toISOString(),
  session_id: sessionId(session),
  cwd: '/work',
  mode: 'live',
  prompt_sha1: 'p',
  cases: cases.map((id) => ({ id: caseId(id), sha1: 's', text: id, final_score: 0.8 })),
  skipped: [],
  fallback: false,
  context_text: '',
  ...overrides,
});

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'directive-log-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('directive injection log', () => {
  it('folds yesterday and today for the same session only', async () => {
    await appendLine(dir, injection('s1', ['a']), NOW - DAY);
    await appendLine(dir, injection('s1', ['b']), NOW);
    await appendLine(dir, injection('other', ['z']), NOW);

    expect([...(await readInContext(dir, 's1', 'live', NOW))].sort()).toEqual(['a', 'b']);
  });

  it('deduplicates old log entries without score fields', async () => {
    const legacy = { ...injection('s1', []), cases: [{ id: 'old', sha1: 's', text: 'old' }] };
    await writeFile(join(dir, 'injections-2026-10-25.jsonl'), `${JSON.stringify(legacy)}\n`);
    expect([...(await readInContext(dir, 's1', 'live', NOW))]).toEqual(['old']);
  });

  it('ignores files older than yesterday', async () => {
    await appendLine(dir, injection('s1', ['old']), NOW - 2 * DAY);
    expect((await readInContext(dir, 's1', 'live', NOW)).size).toBe(0);
  });

  it('clears the set on reset and keeps later injections', async () => {
    await appendLine(dir, injection('s1', ['a']), NOW);
    await appendLine(dir, { session_id: sessionId('s1'), reset: true, ts: new Date(NOW).toISOString() }, NOW);
    await appendLine(dir, injection('s1', ['b']), NOW);

    expect([...(await readInContext(dir, 's1', 'live', NOW))]).toEqual(['b']);
  });

  it('counts only lines of the same mode and skips fallback lines', async () => {
    await appendLine(dir, injection('s1', ['shadow-case'], { mode: 'shadow' }), NOW);
    await appendLine(dir, injection('s1', [], { fallback: true }), NOW);
    await appendLine(dir, injection('s1', ['live-case']), NOW);

    expect([...(await readInContext(dir, 's1', 'live', NOW))]).toEqual(['live-case']);
    expect([...(await readInContext(dir, 's1', 'shadow', NOW))]).toEqual(['shadow-case']);
  });

  it('ignores a torn or garbage line and keeps the rest', async () => {
    await appendLine(dir, injection('s1', ['a']), NOW);
    const file = (await readdir(dir))[0]!;
    await writeFile(join(dir, file), `{"inj_id":"x\nnot json\n`, { flag: 'a' });
    await appendLine(dir, injection('s1', ['b']), NOW);

    expect([...(await readInContext(dir, 's1', 'live', NOW))].sort()).toEqual(['a', 'b']);
  });

  it('returns an empty set when the directory does not exist', async () => {
    expect((await readInContext(join(dir, 'missing'), 's1', 'live', NOW)).size).toBe(0);
  });

  it('writes one json object per line with owner-only permissions', async () => {
    const logDir = join(dir, 'nested');
    await appendLine(logDir, injection('s1', ['a']), NOW);
    await appendLine(logDir, injection('s1', ['b']), NOW);

    const file = join(logDir, 'injections-2026-10-25.jsonl');
    const lines = (await readFile(file, 'utf8')).trimEnd().split('\n');
    expect(lines.map((l) => (JSON.parse(l) as InjectionLine).cases.map((c) => c.id))).toEqual([['a'], ['b']]);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(logDir)).mode & 0o777).toBe(0o700);
  });
});
