import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentFile = fileURLToPath(import.meta.url);
const packageRoot = resolve(dirname(currentFile), '..', '..', '..');

function collectSpecs(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return collectSpecs(path);
    return /\.(?:spec|test)\.ts$/.test(entry.name) ? [path] : [];
  });
}

function packagePath(path: string): string {
  return relative(packageRoot, path).replaceAll('\\', '/');
}

const specs = collectSpecs(resolve(packageRoot, 'src')).filter(path => path !== currentFile);

const LEGACY_FULL_SCHEMA_BOOTSTRAP_ALLOWLIST = [
  // Minimal compatibility fixture: malformed legacy embedding JSON must be insertable.
  'src/domains/memory/services/__tests__/memory-neighbor-service.spec.ts',
  // Historical migration fixture: the pre-migration FTS shape is the behavior under test.
  'src/infrastructure/database/sqlite/migration/migrations/006-fts5-reflection-notes.spec.ts',
  // Self-test for the legacy initializer itself.
  'src/shared/utils/database.spec.ts'
];

const INLINE_MEMORY_EMBEDDING_DDL_ALLOWLIST = [
  // Migration and repair services require deliberately incomplete or corrupt schemas.
  'src/domains/embedding/services/__tests__/embedding-migration-service.spec.ts',
  'src/domains/embedding/services/__tests__/embedding-reindex-service.spec.ts',
  'src/domains/memory/introspection/__tests__/introspection-healing-service.spec.ts',
  'src/domains/memory/introspection/__tests__/introspection-heal-tool.spec.ts',
  'src/infrastructure/database/sqlite/__tests__/ensure-memory-embedding-metadata-defaults.spec.ts',
  'src/infrastructure/database/sqlite/__tests__/migrate-embedding-rebuild-atomicity.spec.ts',
  'src/infrastructure/database/sqlite/init.spec.ts',
  'src/infrastructure/database/sqlite/migrate.spec.ts'
];

const RECALL_SHARDS = {
  'src/domains/memory/recall/__tests__/recall-tool-auto-anchor.spec.ts': 16,
  'src/domains/memory/recall/__tests__/recall-tool-basics.spec.ts': 53,
  'src/domains/memory/recall/__tests__/recall-tool-metadata.spec.ts': 12,
  'src/domains/memory/recall/__tests__/recall-tool-neighbors.spec.ts': 10,
  'src/domains/memory/recall/__tests__/recall-tool-reflection-notes.spec.ts': 17
};

describe('database test topology', () => {
  it('keeps legacy full-schema bootstrap calls on an explicit behavior allowlist', () => {
    const actual = specs
      .filter(path => readFileSync(path, 'utf8').includes('DatabaseUtils.initializeDatabase('))
      .map(packagePath)
      .sort();

    expect(actual).toEqual([...LEGACY_FULL_SCHEMA_BOOTSTRAP_ALLOWLIST].sort());
  });

  it('keeps copied memory-item plus embedding DDL limited to migration and repair fixtures', () => {
    const actual = specs
      .filter(path => {
        const source = readFileSync(path, 'utf8');
        return (
          /CREATE\s+TABLE[^;]*\bmemory_item\b/is.test(source) &&
          /CREATE\s+TABLE[^;]*\bmemory_embedding\b/is.test(source) &&
          !packagePath(path).includes('/sqlite/migration/')
        );
      })
      .map(packagePath)
      .sort();

    expect(actual).toEqual([...INLINE_MEMORY_EMBEDDING_DDL_ALLOWLIST].sort());
  });

  it('keeps recall behavior in five reviewable shards without losing cases', () => {
    const metrics = Object.entries(RECALL_SHARDS).map(([path, expectedCases]) => {
      const source = readFileSync(resolve(packageRoot, path), 'utf8');
      return {
        path,
        expectedCases,
        cases: source.match(/^\s*it\(/gm)?.length ?? 0,
        lines: source.trimEnd().split('\n').length
      };
    });

    expect(metrics.map(({ path, cases, expectedCases }) => ({ path, cases, expectedCases })))
      .toEqual(metrics.map(({ path, expectedCases }) => ({ path, cases: expectedCases, expectedCases })));
    expect(metrics.reduce((sum, metric) => sum + metric.cases, 0)).toBe(108);
    expect(Math.max(...metrics.map(metric => metric.lines))).toBeLessThanOrEqual(1500);
    expect(specs.map(packagePath)).not.toContain(
      'src/domains/memory/tools/__tests__/recall-tool.spec.ts'
    );
  });
});
