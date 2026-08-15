/**
 * T019 (#750): parameterized CLI/import smoke that *spawns* registered ops CLIs.
 * Replaces SQL-clone coverage in migrate-embedding-data.integration.spec.ts for CI.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

type SmokeCase = {
  name: string;
  script: string;
  args: string[];
  env?: Record<string, string>;
  withTempDb?: boolean;
};

const CASES: SmokeCase[] = [
  {
    name: 'migrate-embedding-data usage/--help (module load)',
    script: 'scripts/migrate-embedding-data.js',
    args: ['--help'],
  },
  {
    name: 'migrate-embedding-data analyze (spawn CLI, not SQL clone)',
    script: 'scripts/migrate-embedding-data.js',
    args: ['analyze'],
    withTempDb: true,
  },
];

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

describe('T019 registered ops CLI spawn smoke (#750)', () => {
  it.each(CASES)('$name', (c) => {
    const env: NodeJS.ProcessEnv = { ...process.env, ...(c.env ?? {}) };
    if (c.withTempDb) {
      const dir = mkdtempSync(join(tmpdir(), 'memento-ops-smoke-'));
      tempDirs.push(dir);
      env.DB_PATH = join(dir, 'memory.db');
    }

    const result = spawnSync(process.execPath, [c.script, ...c.args], {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
      timeout: 120_000,
    });

    const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    expect(combined, combined).not.toMatch(/ERR_MODULE_NOT_FOUND/);
    expect(combined, combined).not.toMatch(/Cannot find module.*\/src\//);
    expect(result.error, String(result.error)).toBeUndefined();
    expect(result.status, combined).toBe(0);
  });
});
