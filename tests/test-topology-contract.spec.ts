import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const NIGHTLY_SUFFIX = '.nightly.spec.ts';
const NIGHTLY_SPECS = [
  'packages/memento-core/src/domains/memory/services/__tests__/memory-embedding-service.nightly.spec.ts',
  'packages/memento-core/src/infrastructure/database/database-lock-scenarios.nightly.spec.ts',
  'packages/memento-core/src/infrastructure/database/database-performance.nightly.spec.ts',
  'packages/memento-core/src/infrastructure/database/sqlite/migration/migration-runner.nightly.spec.ts',
  'packages/memento-core/src/test/vector-search-quality-with-consolidation.nightly.spec.ts',
] as const;
const CI_OWNED_ROOTS = [
  'apps/',
  'scripts/',
  'tests/',
  'packages/memento-agent-integration/src/',
  'packages/memento-assistant/src/',
  'packages/memento-assistant/test/',
  'packages/memento-client/src/',
  'packages/memento-core/src/',
  'packages/memento-server/src/',
] as const;
const PRIMARY_TSCONFIGS = [
  'apps/experimental-example/tsconfig.json',
  'packages/memento-agent-integration/tsconfig.json',
  'packages/memento-assistant/tsconfig.json',
  'packages/memento-client/tsconfig.json',
  'packages/memento-core/tsconfig.json',
  'packages/memento-server/tsconfig.json',
] as const;
const BUILD_TSCONFIGS = [
  'packages/memento-agent-integration/tsconfig.build.json',
  'packages/memento-assistant/tsconfig.build.json',
  'packages/memento-client/tsconfig.build.json',
] as const;
const STRICT_CHECKS = [
  'strict',
  'noImplicitAny',
  'strictNullChecks',
  'strictFunctionTypes',
  'noImplicitReturns',
  'noFallthroughCasesInSwitch',
  'noUncheckedIndexedAccess',
] as const;

interface ParsedTsConfig {
  compilerOptions: Record<string, unknown>;
}

function collectFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(path) : [relative(ROOT, path)];
  });
}

function countOccurrences(text: string, value: string): number {
  return text.split(value).length - 1;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as Record<string, unknown>;
}

function resolveTsConfig(path: string): ParsedTsConfig {
  const output = execFileSync(
    process.execPath,
    [join(ROOT, 'node_modules/typescript/bin/tsc'), '--showConfig', '--project', join(ROOT, path)],
    { cwd: ROOT, encoding: 'utf8', timeout: 10_000 },
  );
  return JSON.parse(output) as ParsedTsConfig;
}

function resolveRootVitestConfig(includeNightly: boolean): { include: string[]; exclude: string[] } {
  const source = [
    "import { resolveConfig } from 'vitest/node';",
    "const { vitestConfig } = await resolveConfig({ root: process.cwd(), config: 'vitest.config.ts' });",
    'process.stdout.write(JSON.stringify({ include: vitestConfig.include, exclude: vitestConfig.exclude }));',
  ].join('\n');
  const output = execFileSync(
    process.execPath,
    ['--input-type=module', '--eval', source],
    {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        CI: '1',
        ...(includeNightly ? { VITEST_INCLUDE_NIGHTLY: '1' } : { VITEST_INCLUDE_NIGHTLY: '' }),
      },
    },
  );
  return JSON.parse(output) as { include: string[]; exclude: string[] };
}

describe('test topology contracts', () => {
  it('keeps the reviewed heavy inventory explicit and suffix-based', () => {
    const discovered = collectFiles(join(ROOT, 'packages'))
      .filter((path) => path.endsWith(NIGHTLY_SUFFIX))
      .sort();

    expect(discovered).toEqual([...NIGHTLY_SPECS].sort());

    const rootConfig = readFileSync(join(ROOT, 'vitest.config.ts'), 'utf8');
    const baseConfig = readFileSync(join(ROOT, 'vitest.base.ts'), 'utf8');
    const includeBlock = rootConfig.match(/include:\s*\[([\s\S]*?)\]\s*,/)?.[1] ?? '';
    const includePatterns = includeBlock.match(/'[^']+'/g) ?? [];

    expect(includePatterns.length).toBeLessThanOrEqual(2);
    expect(rootConfig).toContain("from './vitest.base.js'");
    expect(baseConfig).toContain(`**/*${NIGHTLY_SUFFIX}`);
    expect(rootConfig).not.toContain('**/*.integration.spec.ts');
  });

  it('assigns every reviewed heavy suite to nightly exactly once', () => {
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    const nightly = readFileSync(join(ROOT, '.github/workflows/nightly-tests.yml'), 'utf8');
    const rootPackage = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const nightlyOwners = `${nightly}\n${rootPackage.scripts['test:vector-search-quality:ci']}`;

    expect(ci).not.toContain('test:vector-search-quality:ci');
    expect(countOccurrences(nightly, 'test:vector-search-quality:ci')).toBe(1);
    expect(nightly).toContain("VITEST_INCLUDE_NIGHTLY: '1'");

    for (const spec of NIGHTLY_SPECS) {
      expect(countOccurrences(nightlyOwners, spec)).toBe(1);
    }
  });

  it('keeps ordinary integration specs in PR collection', () => {
    const rootPackage = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const rootConfig = readFileSync(join(ROOT, 'vitest.config.ts'), 'utf8');
    const baseConfig = readFileSync(join(ROOT, 'vitest.base.ts'), 'utf8');
    const packageConfigs = [
      'packages/memento-agent-integration/vitest.config.ts',
      'packages/memento-assistant/vitest.config.ts',
      'packages/memento-client/vitest.config.ts',
    ].map((path) => readFileSync(join(ROOT, path), 'utf8'));

    expect(rootPackage.scripts['test:ci:scripts']).not.toContain('integration.spec.ts');
    expect(rootConfig).not.toContain('**/*.integration.spec.ts');
    expect(packageConfigs.every((config) => !config.includes('**/*.integration.spec.ts'))).toBe(true);
    expect(packageConfigs.every((config) => config.includes("from '../../vitest.base.js'"))).toBe(true);
    expect(baseConfig).toContain('**/*.nightly.spec.ts');
  });

  it('watches the SQLite relation migration in push and pull request workflows', () => {
    const workflow = readFileSync(join(ROOT, '.github/workflows/relation-engine.yml'), 'utf8');
    const migrationPath = 'packages/memento-core/src/infrastructure/database/sqlite/migration/migrations/005-relation-engine-schema.*';

    expect(countOccurrences(workflow, migrationPath)).toBe(2);
  });

  it('keeps moved Compose entrypoints usable with or without a root environment file', () => {
    const rootPackage = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts['docker:dev']).toBe(
      'docker compose -p memento -f docker/docker-compose.dev.yml up -d',
    );
    expect(rootPackage.scripts['docker:prod']).toBe(
      'docker compose -p memento -f docker/docker-compose.prod.yml up -d',
    );

    for (const path of ['scripts/deploy.sh', 'scripts/rollback.sh']) {
      const script = readFileSync(join(ROOT, path), 'utf8');
      const invocations = script
        .split('\n')
        .filter((line) => line.trimStart().startsWith('$DC -p') && line.includes('COMPOSE_FILE'));

      expect(script, path).toContain('if [[ -f .env ]]');
      expect(invocations.length, path).toBeGreaterThan(0);
      expect(invocations.every((line) => line.includes('"${ENV_FILE_ARGS[@]}"')), path).toBe(true);
    }
  });

  it('has no test files outside the PR and nightly owners', () => {
    const rootPackage = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const allTests = ['apps', 'packages', 'scripts', 'tests']
      .flatMap((directory) => collectFiles(join(ROOT, directory)))
      .filter((path) => /\.(?:spec|test)\.(?:js|ts)$/.test(path));
    const orphans = allTests.filter((path) => (
      !path.endsWith(NIGHTLY_SUFFIX)
      && !CI_OWNED_ROOTS.some((root) => path.startsWith(root))
    ));

    expect(orphans).toEqual([]);
    expect(rootPackage.scripts['test:ci:root']).toContain('tests/');
    expect(rootPackage.scripts['test:ci:root']).toContain('apps/');
  });
});

describe('shared TypeScript and Vitest configuration contracts', () => {
  it('enumerates every surviving TypeScript config and keeps one inheritance chain', () => {
    const discovered = [
      'tsconfig.json',
      ...['apps', 'packages']
        .flatMap((directory) => collectFiles(join(ROOT, directory)))
        .filter((path) => /(?:^|\/)tsconfig(?:\.build)?\.json$/.test(path)),
    ].sort();
    const expected = ['tsconfig.json', ...PRIMARY_TSCONFIGS, ...BUILD_TSCONFIGS].sort();

    expect(discovered).toEqual(expected);
    for (const path of PRIMARY_TSCONFIGS) {
      expect(readJson(path).extends).toBe('../../tsconfig.json');
    }
    for (const path of BUILD_TSCONFIGS) {
      expect(readJson(path).extends).toBe('./tsconfig.json');
    }
  });

  it('keeps the server strict while preserving reviewed package exceptions', () => {
    const server = resolveTsConfig('packages/memento-server/tsconfig.json').compilerOptions;
    const core = resolveTsConfig('packages/memento-core/tsconfig.json').compilerOptions;
    const strictButLegacyChecks = [
      'packages/memento-agent-integration/tsconfig.json',
      'packages/memento-assistant/tsconfig.json',
      'packages/memento-client/tsconfig.json',
    ] as const;

    for (const check of STRICT_CHECKS) {
      expect(server[check], `server ${check}`).toBe(true);
      expect(core[check], `core ${check}`).toBe(true);
    }
    expect(server.allowJs).toBe(true);
    expect(server.isolatedModules).toBe(true);
    expect(server.verbatimModuleSyntax).toBe(true);

    for (const path of strictButLegacyChecks) {
      const options = resolveTsConfig(path).compilerOptions;
      expect(options.strict, `${path} strict`).toBe(true);
      expect(options.noImplicitAny, `${path} noImplicitAny`).toBe(true);
      expect(options.strictNullChecks, `${path} strictNullChecks`).toBe(true);
      expect(options.strictFunctionTypes, `${path} strictFunctionTypes`).toBe(true);
      expect(options.isolatedModules, `${path} isolatedModules`).toBe(true);
      expect(options.noImplicitReturns, `${path} noImplicitReturns`).toBe(false);
      expect(options.noFallthroughCasesInSwitch, `${path} noFallthroughCasesInSwitch`).toBe(false);
      expect(options.noUncheckedIndexedAccess, `${path} noUncheckedIndexedAccess`).toBe(false);
      expect(options.allowJs, `${path} allowJs`).toBe(false);
      expect(options.verbatimModuleSyntax, `${path} verbatimModuleSyntax`).toBe(false);
    }

    for (const path of [
      'packages/memento-assistant/tsconfig.json',
      'packages/memento-client/tsconfig.json',
    ] as const) {
      expect(resolveTsConfig(path).compilerOptions.baseUrl, `${path} baseUrl`).toBe('./');
    }

    const experimental = resolveTsConfig('apps/experimental-example/tsconfig.json').compilerOptions;
    for (const check of STRICT_CHECKS) {
      expect(experimental[check], `experimental ${check}`).toBe(false);
    }
    expect(experimental.allowJs).toBe(false);
    expect(experimental.sourceMap).toBe(false);
    expect(experimental.declarationMap).toBe(false);
    expect(experimental.isolatedModules).toBe(false);
    expect(experimental.verbatimModuleSyntax).toBe(false);
  });

  it('resolves bounded CI and nightly collection from the shared Vitest base', () => {
    const ci = resolveRootVitestConfig(false);
    const nightly = resolveRootVitestConfig(true);
    const expectedInclude = [
      '{tests,scripts,apps}/**/*.{test,spec}.{js,ts}',
      'packages/{memento-core,memento-client,memento-server}/src/**/*.{test,spec}.{js,ts}',
    ];

    expect(ci.include).toEqual(expectedInclude);
    expect(nightly.include).toEqual(expectedInclude);
    expect(ci.exclude).toContain('**/node_modules/**');
    expect(ci.exclude).toContain('**/dist/**');
    expect(ci.exclude).toContain('**/*.nightly.spec.ts');
    expect(nightly.exclude).toContain('**/node_modules/**');
    expect(nightly.exclude).toContain('**/dist/**');
    expect(nightly.exclude).not.toContain('**/*.nightly.spec.ts');
  });
});
