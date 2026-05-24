import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import type { ExecFileLike } from '../sources.js';
import { readJsonlFiles, resolveDockerLogsRef, splitJsonlLines } from '../sources.js';

describe('splitJsonlLines', () => {
  it('trims and drops empty lines', () => {
    expect(splitJsonlLines('{"a":1}\n\n  {"b":2}  \n')).toEqual(['{"a":1}', '{"b":2}']);
  });
});

describe('resolveDockerLogsRef', () => {
  it('returns preferred when docker inspect succeeds', async () => {
    const exec = vi.fn((file, args, opts, cb) => {
      expect(file).toBe('docker');
      expect(args?.[0]).toBe('inspect');
      (cb as (e: Error | null, so?: string, se?: string) => void)(null, 'sha256:abc\n', '');
    }) as unknown as ExecFileLike;

    await expect(resolveDockerLogsRef('memento-mcp-server', exec)).resolves.toBe('memento-mcp-server');
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('resolves via docker ps when inspect fails and one id matches name filter', async () => {
    const exec = vi.fn((file, args, opts, cb) => {
      const callback = cb as (e: Error | null, so?: string, se?: string) => void;
      expect(file).toBe('docker');
      if (args?.[0] === 'inspect') {
        callback(new Error('no such object'));
        return;
      }
      if (args?.[0] === 'ps' && args?.[1] === '-aq') {
        callback(null, 'containerid1\n', '');
        return;
      }
      callback(new Error('unexpected'));
    }) as unknown as ExecFileLike;

    await expect(resolveDockerLogsRef('memento-mcp-server', exec)).resolves.toBe('containerid1');
  });

  it('when multiple ids match, prefers exact container name', async () => {
    const exec = vi.fn((file, args, opts, cb) => {
      const callback = cb as (e: Error | null, so?: string, se?: string) => void;
      expect(file).toBe('docker');
      if (args?.[0] === 'inspect' && args?.[3] === 'memento-mcp-server') {
        callback(new Error('no such object'));
        return;
      }
      if (args?.[0] === 'ps' && args?.[1] === '-aq') {
        callback(null, 'idA\nidB\n', '');
        return;
      }
      if (args?.[0] === 'inspect' && args?.[3] === 'idA') {
        callback(null, '/memento-memento-mcp-server-1\n', '');
        return;
      }
      if (args?.[0] === 'inspect' && args?.[3] === 'idB') {
        callback(null, '/memento-mcp-server\n', '');
        return;
      }
      if (args?.[0] === 'ps' && args?.[1] === '-q') {
        callback(null, 'idA\n', '');
        return;
      }
      callback(new Error('unexpected'));
    }) as unknown as ExecFileLike;

    await expect(resolveDockerLogsRef('memento-mcp-server', exec)).resolves.toBe('idB');
  });
});

describe('readJsonlFiles', () => {
  it('uses only the last line of docker-inspect.jsonl under docker-diagnostics', async () => {
    const root = join(tmpdir(), `memento-sources-test-${Date.now()}`);
    const dockerDiag = join(root, 'docker-diagnostics');
    await mkdir(dockerDiag, { recursive: true });

    const oldUnhealthy = JSON.stringify({
      Id: 'old',
      State: { Status: 'running', Health: { Status: 'unhealthy' } },
    });
    const newHealthy = JSON.stringify({
      Id: 'new',
      State: { Status: 'running', Health: { Status: 'healthy' } },
    });
    await writeFile(join(dockerDiag, 'docker-inspect.jsonl'), `${oldUnhealthy}\n${newHealthy}\n`, 'utf8');

    const { lines } = await readJsonlFiles(root);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).State.Health.Status).toBe('healthy');

    await rm(root, { recursive: true, force: true });
  });

  it('still reads all lines from diagnostics jsonl', async () => {
    const root = join(tmpdir(), `memento-sources-test-diag-${Date.now()}`);
    const diag = join(root, 'diagnostics');
    await mkdir(diag, { recursive: true });
    await writeFile(join(diag, 'events.jsonl'), '{"x":1}\n{"x":2}\n', 'utf8');

    const { lines } = await readJsonlFiles(root);
    expect(lines).toEqual(['{"x":1}', '{"x":2}']);

    await rm(root, { recursive: true, force: true });
  });

  it('reads only appended lines on subsequent calls using byte cursors', async () => {
    const root = join(tmpdir(), `memento-sources-test-cursor-${Date.now()}`);
    const diag = join(root, 'diagnostics');
    await mkdir(diag, { recursive: true });
    const filePath = join(diag, 'events.jsonl');
    await writeFile(filePath, '{"x":1}\n', 'utf8');

    const first = await readJsonlFiles(root);
    expect(first.lines).toEqual(['{"x":1}']);
    expect(first.cursors['diagnostics/events.jsonl']).toBeGreaterThan(0);

    await writeFile(filePath, '{"x":1}\n{"x":2}\n', 'utf8');
    const second = await readJsonlFiles(root, first.cursors);
    expect(second.lines).toEqual(['{"x":2}']);

    await rm(root, { recursive: true, force: true });
  });

  it('skips oversized unread JSONL without throwing', async () => {
    const root = join(tmpdir(), `memento-sources-test-skip-${Date.now()}`);
    const diag = join(root, 'diagnostics');
    await mkdir(diag, { recursive: true });
    await writeFile(join(diag, 'huge.jsonl'), '{"x":1}\n', 'utf8');

    const { lines, skips, cursors } = await readJsonlFiles(root, {}, 1);
    expect(lines).toEqual([]);
    expect(skips).toHaveLength(1);
    expect(skips[0]?.unreadBytes).toBeGreaterThan(1);
    expect(cursors['diagnostics/huge.jsonl']).toBeGreaterThan(0);

    await rm(root, { recursive: true, force: true });
  });

  it('concatenates many lines without spread stack overflow', async () => {
    const root = join(tmpdir(), `memento-sources-test-many-${Date.now()}`);
    const diag = join(root, 'diagnostics');
    await mkdir(diag, { recursive: true });
    const payload = `${'{"n":1}\n'.repeat(20_000)}`;
    await writeFile(join(diag, 'events.jsonl'), payload, 'utf8');

    await expect(readJsonlFiles(root)).resolves.toMatchObject({ lines: expect.any(Array) });

    await rm(root, { recursive: true, force: true });
  });
});
