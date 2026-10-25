import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseDirectiveConfig } from './config.js';
import { runDirectives } from './engine.js';
import { DIRECTIVE_POLICY } from './select.js';
import type { DirectiveConfig, DirectiveDeps, DirectiveRunInput, InjectionLine, RecallPort } from './types.js';

const NOW = new Date(2026, 9, 25, 12, 0, 0).getTime();

const prompt = (text = 'how do I fix flaky tests', session = 's1'): DirectiveRunInput => ({
  eventType: 'USER_PROMPT',
  sessionId: session,
  cwd: '/work',
  prompt: text,
});

const recallOf = (...cases: Array<[string, string]>): RecallPort =>
  vi.fn().mockResolvedValue({
    items: cases.map(([memory_id, content]) => ({ memory_id, content })),
  });

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'directive-engine-'));
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

const depsOf = (
  recall: RecallPort | null,
  mode: 'live' | 'shadow' = 'live',
  pinnedFile: string | null = null,
): DirectiveDeps => ({
  config: { enabled: true, mode, pinnedFile, logDir: dir },
  recall,
  now: () => NOW,
});

async function logLines(): Promise<InjectionLine[]> {
  const files = await readdir(dir).catch(() => []);
  const out: InjectionLine[] = [];
  for (const f of files.filter((name) => name.endsWith('.jsonl'))) {
    const raw = await readFile(join(dir, f), 'utf8');
    for (const l of raw.split('\n').filter(Boolean)) out.push(JSON.parse(l) as InjectionLine);
  }
  return out;
}

const contextOf = (stdout: string): string =>
  (JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } })
    .hookSpecificOutput.additionalContext;

describe('runDirectives', () => {
  it('live mode returns hook JSON and logs the same context first', async () => {
    const stdout = await runDirectives(prompt(), depsOf(recallOf(['c1', 'Run tests in isolation'])));

    const context = contextOf(stdout);
    expect(context).toMatch(/^\[inj:s1-\d+-[0-9a-f]{6}\]\n- Run tests in isolation\n\[cases-in-context: c1\]$/);
    const lines = await logLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      fallback: false,
      mode: 'live',
      cwd: '/work',
      skipped: [],
      context_text: context,
      cases: [{ id: 'c1', text: 'Run tests in isolation' }],
    });
    expect(lines[0]!.ts).toBe(new Date(NOW).toISOString());
    expect(lines[0]!.prompt_sha1).toMatch(/^[0-9a-f]{40}$/);
    expect(lines[0]!.cases[0]!.sha1).toMatch(/^[0-9a-f]{40}$/);
    expect(lines[0]!.inj_id).toMatch(/^s1-\d+-[0-9a-f]{6}$/);
  });

  it('logs over-length case ids as skipped and leaves them out of the context', async () => {
    const long = 'x'.repeat(DIRECTIVE_POLICY.caseMaxChars + 1);
    const stdout = await runDirectives(prompt(), depsOf(recallOf(['big', long], ['ok', 'fine'])));

    expect(contextOf(stdout)).not.toContain('xxx');
    expect(await logLines()).toMatchObject([{ skipped: ['big'], cases: [{ id: 'ok' }] }]);
  });

  it('queries the case tag with the clipped prompt', async () => {
    const recall = recallOf();
    await runDirectives(prompt('😀'.repeat(DIRECTIVE_POLICY.queryMaxChars + 50)), depsOf(recall));

    const [request] = vi.mocked(recall).mock.calls[0]!;
    expect(request.tags).toEqual(['case']);
    expect(request.limit).toBe(DIRECTIVE_POLICY.recallLimit);
    expect(Array.from(request.query)).toHaveLength(DIRECTIVE_POLICY.queryMaxChars);
  });

  it('does not repeat a case within the same session', async () => {
    const deps = depsOf(recallOf(['c1', 'first'], ['c2', 'second']));
    await runDirectives(prompt(), deps);
    const second = contextOf(await runDirectives(prompt('another prompt'), deps));

    expect(second).not.toContain('- first');
    expect(second).toContain('[cases-in-context: c1, c2]');
  });

  it('shadow mode logs the injection but returns nothing', async () => {
    const stdout = await runDirectives(prompt(), depsOf(recallOf(['c1', 'x']), 'shadow'));

    expect(stdout).toBe('');
    expect(await logLines()).toMatchObject([{ fallback: false, mode: 'shadow', cases: [{ id: 'c1' }] }]);
  });

  it('a failing recall returns nothing and logs one fallback line', async () => {
    const recall: RecallPort = vi.fn().mockRejectedValue(new Error('boom'));
    const stdout = await runDirectives(prompt(), depsOf(recall));

    expect(stdout).toBe('');
    expect(await logLines()).toMatchObject([{ fallback: true, cases: [] }]);
  });

  it('a malformed recall result is a fallback, not a crash', async () => {
    const stdout = await runDirectives(prompt(), depsOf(vi.fn().mockResolvedValue({ nope: 1 })));

    expect(stdout).toBe('');
    expect(await logLines()).toMatchObject([{ fallback: true }]);
  });

  it('no server (null recall) logs a fallback line', async () => {
    expect(await runDirectives(prompt(), depsOf(null))).toBe('');
    expect(await logLines()).toMatchObject([{ fallback: true }]);
  });

  it('an empty prompt skips recall and still injects the marker', async () => {
    const recall = recallOf(['c1', 'x']);
    const stdout = await runDirectives(prompt('   '), depsOf(recall));

    expect(recall).not.toHaveBeenCalled();
    expect(contextOf(stdout)).toMatch(/^\[inj:s1-\d+-[0-9a-f]{6}\]\n\[cases-in-context: \]$/);
  });

  it('a recall that outlives the deadline returns nothing and writes exactly one fallback line', async () => {
    vi.useFakeTimers();
    let release: (value: unknown) => void = () => undefined;
    const slow: RecallPort = () => new Promise((resolve) => { release = resolve; });
    const pending = runDirectives(prompt(), depsOf(slow));

    await vi.advanceTimersByTimeAsync(DIRECTIVE_POLICY.deadlineMs);
    expect(await pending).toBe('');
    release({ items: [{ memory_id: 'late', content: 'too late' }] });
    await vi.advanceTimersByTimeAsync(50);
    vi.useRealTimers();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await logLines()).toMatchObject([{ fallback: true, cases: [] }]);
  });

  it('returns nothing when the log cannot be written', async () => {
    const blocker = join(dir, 'file');
    await writeFile(blocker, 'x');
    const deps: DirectiveDeps = {
      config: { enabled: true, mode: 'live', pinnedFile: null, logDir: join(blocker, 'sub') },
      recall: recallOf(['c1', 'x']),
      now: () => NOW,
    };

    expect(await runDirectives(prompt(), deps)).toBe('');
  });

  it('PreCompact writes a reset so the next prompt injects again', async () => {
    const deps = depsOf(recallOf(['c1', 'first']));
    await runDirectives(prompt(), deps);
    expect(await runDirectives({ ...prompt(), eventType: 'PRE_COMPACT', prompt: '' }, deps)).toBe('');
    const again = contextOf(await runDirectives(prompt(), deps));

    expect(again).toContain('- first');
    const lines = await logLines() as unknown as Array<Record<string, unknown>>;
    expect(lines.map((l) => ('reset' in l ? 'reset' : 'inj_id' in l ? 'injection' : '?'))).toEqual(['injection', 'reset', 'injection']);
    expect(lines[1]).toEqual({ session_id: 's1', reset: true, ts: new Date(NOW).toISOString() });
  });

  it('ignores other events', async () => {
    const recall = recallOf();
    expect(await runDirectives({ ...prompt(), eventType: 'STOP' }, depsOf(recall))).toBe('');
    expect(recall).not.toHaveBeenCalled();
    expect(await logLines()).toEqual([]);
  });

  it('disabled config does nothing and creates no files', async () => {
    const recall = recallOf();
    const config: DirectiveConfig = { enabled: false };

    expect(await runDirectives(prompt(), { config, recall, now: () => NOW })).toBe('');
    expect(recall).not.toHaveBeenCalled();
    expect(await readdir(dir)).toEqual([]);
  });

  describe('pinned file', () => {
    it('is included in the context', async () => {
      const pinned = join(dir, 'pinned.md');
      await writeFile(pinned, 'Always answer in Korean.\n');
      const stdout = await runDirectives(prompt(), depsOf(recallOf(), 'live', pinned));

      expect(contextOf(stdout)).toContain('\nAlways answer in Korean.\n');
    });

    it('over 1 KB is left out and the log says so', async () => {
      const pinned = join(dir, 'pinned.md');
      await writeFile(pinned, 'x'.repeat(DIRECTIVE_POLICY.pinnedMaxBytes + 1));
      const stdout = await runDirectives(prompt(), depsOf(recallOf(), 'live', pinned));

      expect(contextOf(stdout)).not.toContain('xxx');
      expect((await logLines())[0]).toMatchObject({ pinned_skipped: true });
    });

    it('missing file is left out and the log says so', async () => {
      await runDirectives(prompt(), depsOf(recallOf(), 'live', join(dir, 'nope.md')));
      expect((await logLines())[0]).toMatchObject({ pinned_skipped: true });
    });
  });
});

describe('parseDirectiveConfig', () => {
  const home = '/home/u';

  it('is disabled unless MEMENTO_DIRECTIVES is 1 or true', () => {
    expect(parseDirectiveConfig({}, home)).toEqual({ enabled: false });
    expect(parseDirectiveConfig({ MEMENTO_DIRECTIVES: '0' }, home)).toEqual({ enabled: false });
  });

  it('defaults to shadow mode and the home log dir', () => {
    expect(parseDirectiveConfig({ MEMENTO_DIRECTIVES: 'true' }, home)).toEqual({
      enabled: true,
      mode: 'shadow',
      pinnedFile: null,
      logDir: '/home/u/.claude/state/directive-log',
    });
  });

  it('reads live mode, expands ~ and falls back to shadow for unknown modes', () => {
    const env = {
      MEMENTO_DIRECTIVES: '1',
      MEMENTO_DIRECTIVES_MODE: 'live',
      MEMENTO_DIRECTIVES_PINNED_FILE: '~/pin.md',
      MEMENTO_DIRECTIVES_LOG_DIR: '/var/log/d',
    };
    expect(parseDirectiveConfig(env, home)).toEqual({
      enabled: true, mode: 'live', pinnedFile: '/home/u/pin.md', logDir: '/var/log/d',
    });
    expect(parseDirectiveConfig({ ...env, MEMENTO_DIRECTIVES_MODE: 'weird' }, home))
      .toMatchObject({ mode: 'shadow' });
  });
});
