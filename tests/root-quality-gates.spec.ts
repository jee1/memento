import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

type RootPackageJson = {
  scripts?: Record<string, string>;
};

const typeCheckContract = [
  'npm run type-check -w @memento/core',
  'npm run type-check -w memento-server',
  'npm run type-check -w @memento/client',
  'npm run type-check -w @memento/assistant',
  'npm run type-check -w experimental-example',
];

const broadTopLevelIgnorePattern =
  /--ignore-pattern\s+(?:"|')?(?:src|packages|apps|tests|scripts|static(?:\/js)?)(?:\/|\s|$|(?:"|'))/;

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(process.cwd(), relativePath), 'utf-8')) as T;
}

type RuleConfig = number | string | [number | string, ...unknown[]] | undefined;

function normalizeCommand(command: string): string {
  return command.replace(/\s+/g, ' ').trim();
}

function readScript(pkg: RootPackageJson, name: string): string {
  const script = pkg.scripts?.[name];

  expect(script, `missing package.json script: ${name}`).toBeDefined();

  return normalizeCommand(script ?? '');
}

function expectExactScript(pkg: RootPackageJson, name: string, expected: string): void {
  expect(readScript(pkg, name)).toBe(normalizeCommand(expected));
}

function splitSequentialCommands(command: string): string[] {
  return normalizeCommand(command).split(' && ');
}

function ruleSeverity(rule: RuleConfig): number {
  if (typeof rule === 'number') {
    return rule;
  }

  if (typeof rule === 'string') {
    if (rule === 'off') {
      return 0;
    }

    if (rule === 'warn') {
      return 1;
    }

    if (rule === 'error') {
      return 2;
    }
  }

  if (Array.isArray(rule)) {
    return ruleSeverity(rule[0]);
  }

  return 0;
}

describe('root quality gate contracts', () => {
  it('package quality gate scripts stay pinned to the exact root contracts', () => {
    const pkg = readJson<RootPackageJson>('package.json');

    expectExactScript(pkg, 'lint', 'npm run lint:ts && npm run lint:js');
    expectExactScript(pkg, 'lint:ts', 'eslint "{packages,apps,tests,scripts}/**/*.ts"');
    expectExactScript(pkg, 'lint:js', 'eslint "static/js/**/*.js"');
    expectExactScript(pkg, 'test:prepare', 'npm run build -w @memento/core && npm run build -w memento-server');
    expectExactScript(pkg, 'test', 'npm run test:prepare && vitest --run');
    expect(splitSequentialCommands(readScript(pkg, 'type-check'))).toEqual(typeCheckContract);
  });

  it('lint scripts should not allow broad top-level ignore-pattern bypasses', () => {
    const pkg = readJson<RootPackageJson>('package.json');
    const lintScripts = [readScript(pkg, 'lint:ts'), readScript(pkg, 'lint:js')];

    for (const command of lintScripts) {
      expect(command).not.toMatch(broadTopLevelIgnorePattern);
    }
  });

  it('resolved static js lint config keeps browser globals and core safety rules enabled', async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    const staticConfig = await eslint.calculateConfigForFile('static/js/anchor-map.js');

    expect(staticConfig.env?.browser).toBe(true);
    expect(staticConfig.globals?.d3).toBe('readonly');
    expect(staticConfig.globals?.mementoAdminFetch).toBe('readonly');
    expect(ruleSeverity(staticConfig.rules?.['no-undef'])).toBe(2);
    expect(ruleSeverity(staticConfig.rules?.['no-console'])).toBe(2);
    expect(ruleSeverity(staticConfig.rules?.['no-unused-vars'])).toBe(2);
    expect(ruleSeverity(staticConfig.rules?.['no-var'])).toBe(2);
    expect(ruleSeverity(staticConfig.rules?.['prefer-const'])).toBe(2);
  });

  it('resolved ts lint config keeps no-unused-vars enabled for production code', async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    const tsConfig = await eslint.calculateConfigForFile('packages/memento-server/src/cli.ts');

    expect(ruleSeverity(tsConfig.rules?.['@typescript-eslint/no-unused-vars'])).toBe(2);
  });
});
