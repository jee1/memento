import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const list = (env: Record<string, string> = {}) =>
  spawnSync('bash', ['scripts/ci-local.sh', '--list'], { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, CI_LOCAL_BASE: 'BASESHA', ...env } });

describe('ci-local.sh', () => {
  it('reads the lint-typecheck and security static checks from the workflows', () => {
    const r = list();
    expect(r.status).toBe(0);
    const cmds = r.stdout.split('\n').filter(Boolean);
    for (const expected of [
      'npm run lint',
      'npm run type-check',
      'npm run knip',
      'npm run docs:audit-links',
      'npm run docs:verify-npm-scripts',
      'npx tsx scripts/check-version-sync.ts --ci --base BASESHA --head HEAD',
      'npx tsx scripts/check-sql-injection.ts --ci',
      'npx tsx scripts/check-pii-masking.ts --ci',
      'npx tsx scripts/check-path-traversal.ts --ci',
      'npx tsx scripts/check-removed-names.ts --base=BASESHA',
    ]) expect(cmds).toContain(expected);
    expect(cmds).not.toContain('npm ci');
  });

  it('fails when ci.yml gains a multi-line step it does not know', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ci-local-'));
    dirs.push(dir);
    const yml = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8').replace(
      '      - run: npm run type-check\n',
      '      - run: npm run type-check\n      - name: New gate\n        run: |\n          echo a\n          echo b\n',
    );
    writeFileSync(join(dir, 'ci.yml'), yml);
    const r = list({ CI_LOCAL_CI_YML: join(dir, 'ci.yml') });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('처리하지 못하는 여러 줄 단계');
  });
});
