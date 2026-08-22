import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { isMain, openDb, parseArgs } from '../lib/cli.js';

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
