import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMain, openDb, parseArgs, resolveBackupDir, resolveDbPath } from '../lib/cli.js';

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
    // CI/vitest may set DB_PATH; explicit undefined still hits default param = env
    vi.stubEnv('DB_PATH', '');
    expect(resolveDbPath()).toBe(join(fakeHome, '.memento', 'data', 'memory.db'));
  });

  it('treats whitespace-only values as unset', () => {
    vi.stubEnv('HOME', fakeHome);
    vi.stubEnv('DB_PATH', '');
    expect(resolveDbPath('   ')).toBe(join(fakeHome, '.memento', 'data', 'memory.db'));
  });

  it('does not expand ~user forms', () => {
    expect(resolveDbPath('~notauser/x.db')).toBe(resolve('~notauser/x.db'));
  });
});

describe('resolveBackupDir (#963)', () => {
  const fakeHome = '/tmp/fake-memento-home-963';

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to ~/.memento/backups when unset', () => {
    vi.stubEnv('HOME', fakeHome);
    vi.stubEnv('MEMENTO_BACKUP_DIR', '');
    expect(resolveBackupDir()).toBe(join(fakeHome, '.memento', 'backups'));
  });

  it('treats whitespace-only values as unset', () => {
    vi.stubEnv('HOME', fakeHome);
    expect(resolveBackupDir('   ')).toBe(join(fakeHome, '.memento', 'backups'));
  });

  it('expands ~/ and ~\\ against HOME', () => {
    vi.stubEnv('HOME', fakeHome);
    expect(resolveBackupDir('~/custom-backups')).toBe(join(fakeHome, 'custom-backups'));
    expect(resolveBackupDir('~\\custom-backups')).toBe(join(fakeHome, 'custom-backups'));
  });

  it('expands a lone tilde to HOME', () => {
    vi.stubEnv('HOME', fakeHome);
    expect(resolveBackupDir('~')).toBe(fakeHome);
  });

  it('leaves absolute paths unchanged', () => {
    expect(resolveBackupDir('/var/backups/memento')).toBe('/var/backups/memento');
  });

  it('resolves relative paths against cwd', () => {
    expect(resolveBackupDir('rel/backups')).toBe(resolve('rel/backups'));
  });

  it('does not expand ~user forms', () => {
    expect(resolveBackupDir('~notauser/backups')).toBe(resolve('~notauser/backups'));
  });
});
