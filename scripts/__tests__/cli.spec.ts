import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMain, openDb, parseArgs, resolveDbPath } from '../lib/cli.js';

describe('shared CLI helpers', () => {
  const originalEntry = process.argv[1];

  afterEach(() => {
    process.argv[1] = originalEntry;
  });

  it('parses options and positionals with Node util.parseArgs', () => {
    const parsed = parseArgs({
      args: ['benchmark', '--dry-run', '--output', 'report.json'],
      allowPositionals: true,
      options: {
        'dry-run': { type: 'boolean' },
        output: { type: 'string' },
      },
    });

    expect(parsed.positionals).toEqual(['benchmark']);
    expect(parsed.values).toMatchObject({ 'dry-run': true, output: 'report.json' });
    expect(parsed.args).toEqual(['benchmark', '--dry-run', '--output', 'report.json']);
  });

  it('opens and closes an in-memory sqlite database', () => {
    const db = openDb(':memory:');
    db.exec('CREATE TABLE example (id INTEGER PRIMARY KEY)');

    expect(db.prepare('SELECT COUNT(*) AS count FROM example').get()).toEqual({ count: 0 });
    db.close();
  });

  it('compares the current entrypoint with an import.meta URL', () => {
    process.argv[1] = fileURLToPath(import.meta.url);

    expect(isMain(import.meta.url)).toBe(true);
    expect(isMain(new URL('../lib/cli.ts', import.meta.url).href)).toBe(false);
  });
});

describe('resolveDbPath (#962)', () => {
  const fakeHome = '/tmp/fake-memento-home-962';

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('expands a leading ~/ against HOME', () => {
    vi.stubEnv('HOME', fakeHome);
    expect(resolveDbPath('~/.memento/data/memory.db')).toBe(
      join(fakeHome, '.memento/data/memory.db'),
    );
  });

  it('expands a lone tilde to HOME', () => {
    vi.stubEnv('HOME', fakeHome);
    expect(resolveDbPath('~')).toBe(fakeHome);
  });

  it('leaves absolute container paths unchanged', () => {
    expect(resolveDbPath('/app/data/memory.db')).toBe('/app/data/memory.db');
  });

  it('resolves relative paths against cwd', () => {
    expect(resolveDbPath('./data/memory.db')).toBe(resolve('./data/memory.db'));
  });

  it('defaults to ~/.memento/data/memory.db when unset', () => {
    vi.stubEnv('HOME', fakeHome);
    expect(resolveDbPath(undefined)).toBe(join(fakeHome, '.memento', 'data', 'memory.db'));
  });

  it('treats whitespace-only values as unset', () => {
    vi.stubEnv('HOME', fakeHome);
    expect(resolveDbPath('   ')).toBe(join(fakeHome, '.memento', 'data', 'memory.db'));
  });

  it('does not expand ~user forms', () => {
    expect(resolveDbPath('~notauser/x.db')).toBe(resolve('~notauser/x.db'));
  });
});
