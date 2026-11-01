import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import type { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runRankingPreviewChild } from './ranking-preview-runner.js';

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn((signal: string) => {
    queueMicrotask(() => this.emit('close', null, signal));
    return true;
  });
}

function fakeSpawn(child: FakeChild) {
  const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];
  const fn = ((_cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv }) => {
    calls.push({ args, env: opts.env });
    return child;
  }) as unknown as typeof spawn;
  return { fn, calls };
}

const run = (spawnFn: typeof spawn, timeoutMs = 5000) =>
  runRankingPreviewChild(
    { changes: { 'relevance_signal.scale': 2.2 }, profilePath: '/x/ranking-weights.toml' },
    { projectRoot: '/repo', timeoutMs, maxOldSpaceMb: 777, spawnFn },
  );

describe('runRankingPreviewChild', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('힙 상한 인자를 넘기고 자식의 임시 디렉터리를 실행마다 따로 만든다', async () => {
    const child = new FakeChild();
    const { fn, calls } = fakeSpawn(child);
    const pending = run(fn);
    child.stdout.emit('data', Buffer.from('log\n{"ok":1}\n'));
    child.emit('close', 0);
    await expect(pending).resolves.toEqual({ status: 'ok', result: { ok: 1 } });
    expect(calls[0]!.args[0]).toBe('--max-old-space-size=777');
    const workDir = calls[0]!.env.TMPDIR!;
    expect(workDir).toMatch(/memento-ranking-preview-/);
    expect(existsSync(workDir)).toBe(false);
  });

  it('시간 상한을 넘으면 SIGKILL 로 끝내고 임시 디렉터리를 지운다', async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const { fn, calls } = fakeSpawn(child);
    const pending = run(fn, 10);
    const workDir = calls[0]!.env.TMPDIR!;
    expect(existsSync(workDir)).toBe(true);
    await vi.advanceTimersByTimeAsync(1010);
    await expect(pending).resolves.toEqual({ status: 'timeout' });
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(existsSync(workDir)).toBe(false);
  });

  it('stdout 은 1MB 까지만 모은다', async () => {
    const child = new FakeChild();
    const { fn } = fakeSpawn(child);
    const pending = run(fn);
    child.stdout.emit('data', Buffer.from(`${'x'.repeat(1_000_000)}\n`));
    child.stdout.emit('data', Buffer.from('{"ok":1}\n'));
    child.emit('close', 0);
    await expect(pending).resolves.toEqual({ status: 'failed', message: 'preview output is not JSON' });
  });
});
