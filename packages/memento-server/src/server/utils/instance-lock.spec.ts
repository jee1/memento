/* eslint-disable security/detect-non-literal-fs-filename */
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { releaseLock, tryAcquireLock, type AcquireLockResult } from './instance-lock.js';

describe('instance lock', () => {
  const directories: string[] = [];
  const children: ChildProcess[] = [];
  function databasePath(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'memento-lock-'));
    directories.push(directory);
    return path.join(directory, 'memory.db');
  }

  async function contender(dbPath: string): Promise<ChildProcess> {
    const child = fork(new URL('./instance-lock.ts', import.meta.url), [], {
      execArgv: ['--import', 'tsx', '--input-type=module', '--eval', `
        import { tryAcquireLock, releaseLock } from ${JSON.stringify(new URL('./instance-lock.ts', import.meta.url).href)};
        process.on('message', (message) => {
          if (message === 'acquire') process.send(tryAcquireLock(process.env.LOCK_TEST_DB));
          else { releaseLock(); process.exit(0); }
        });
        process.send('ready');
      `],
      env: { ...process.env, NODE_ENV: 'test', LOCK_TEST_DB: dbPath },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    children.push(child);
    await once(child, 'message');
    return child;
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    releaseLock();
    await Promise.all(children.splice(0).map(async child => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }));
    for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
  });

  it('releases ownership so the next attempt can acquire', () => {
    const dbPath = databasePath();
    expect(tryAcquireLock(dbPath)).toEqual({ acquired: true });
    expect(tryAcquireLock(dbPath)).toEqual({ acquired: false, existingPid: process.pid });
    releaseLock();
    expect(tryAcquireLock(dbPath)).toEqual({ acquired: true });
  });

  it('does not treat a process with denied signal permission as dead', () => {
    const dbPath = databasePath();
    expect(tryAcquireLock(dbPath)).toEqual({ acquired: true });
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); });
    expect(tryAcquireLock(dbPath)).toEqual({ acquired: false, existingPid: process.pid });
  });

  it('leaves legacy PID files intact instead of racing a migration', () => {
    const dbPath = databasePath();
    const lockPath = path.join(path.dirname(dbPath), 'memento-mcp.lock');
    fs.writeFileSync(lockPath, '1234');
    expect(tryAcquireLock(dbPath)).toEqual({ acquired: false, existingPid: 1234 });
    expect(fs.readFileSync(lockPath, 'utf8')).toBe('1234');
  });

  it('does not release a replacement owner', () => {
    const dbPath = databasePath();
    expect(tryAcquireLock(dbPath)).toEqual({ acquired: true });
    const ownerPath = path.join(path.dirname(dbPath), 'memento-mcp.lock', 'owner.json');
    const replacement = JSON.stringify({ pid: process.pid, token: 'replacement' });
    fs.writeFileSync(ownerPath, replacement);
    releaseLock();
    expect(fs.readFileSync(ownerPath, 'utf8')).toBe(replacement);
  });

  it('cannot reap a replacement after another contender already recovered the stale owner', () => {
    const dbPath = databasePath();
    expect(tryAcquireLock(dbPath)).toEqual({ acquired: true });
    const lockPath = path.join(path.dirname(dbPath), 'memento-mcp.lock');
    const replacement = JSON.stringify({ pid: process.pid, token: '11111111-1111-1111-1111-111111111111' });
    const rename = fs.renameSync.bind(fs);
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('dead'), { code: 'ESRCH' }); });
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (String(destination).includes('.stale-')) {
        // Another reaper wins and publishes a new owner while this one is paused.
        rename(source, destination);
        fs.mkdirSync(lockPath);
        fs.writeFileSync(path.join(lockPath, 'owner.json'), replacement);
      }
      return rename(source, destination);
    });
    expect(tryAcquireLock(dbPath).acquired).toBe(false);
    expect(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8')).toBe(replacement);
  });

  it.each([false, true])('elects one concurrent owner (stale lock: %s)', async stale => {
    const dbPath = databasePath();
    if (stale) {
      const previous = await contender(dbPath);
      const result = once(previous, 'message');
      previous.send('acquire');
      expect((await result)[0]).toEqual({ acquired: true });
      const exited = once(previous, 'exit');
      previous.kill('SIGKILL');
      await exited;
    }
    const contenders = await Promise.all(Array.from({ length: 8 }, () => contender(dbPath)));
    const results = await Promise.all(contenders.map(async child => {
      const result = once(child, 'message');
      child.send('acquire');
      return (await result)[0] as AcquireLockResult;
    }));
    expect(results.filter(result => result.acquired)).toHaveLength(1);
  });
});
