import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(currentDir, '..', '..');
const domainsRoot = path.join(srcRoot, 'domains');
const sharedRoot = path.join(srcRoot, 'shared');
const ALLOWED_CONCRETE_RELATION_GRAPH_IMPORTS = [
  'domains/anchor/services/anchor/anchor-search-service.ts',
  'domains/anchor/services/anchor/n-hop-search-service.ts',
  'domains/search/algorithms/hybrid-search-engine.ts',
] as const;

/**
 * Frozen layer-boundary allowlist (#749).
 * Growth requires explicit PR review: bump FROZEN_*_SIZE and add rationale.
 * Snapshot refreshed 2026-08-15 via production import scan (excl. *.spec / __tests__).
 */
type AllowlistEntry = { readonly path: string; readonly rationale: string };

const DOMAIN_TO_INFRA_ALLOWLIST: readonly AllowlistEntry[] = [
  { path: 'domains/embedding/services/embedding-migration-service.ts', rationale: 'migration history service wiring' },
  { path: 'domains/embedding/services/embedding-migration-service/migration-execution.ts', rationale: 'migration history service wiring' },
  { path: 'domains/embedding/services/embedding-migration-service/migration-progress.ts', rationale: 'migration monitor service wiring' },
  { path: 'domains/embedding/services/gemini-embedding-service.ts', rationale: 'RetryManager for external embedding API' },
  { path: 'domains/embedding/services/openai-embedding-service.ts', rationale: 'RetryManager for external embedding API' },
  { path: 'domains/memory/services/memory-jsonl-portability.ts', rationale: 'SchemaVersionManager for JSONL portability' },
  { path: 'domains/memory/procedural/procedural-llm-extractor.ts', rationale: 'RetryManager for LLM extraction' },
  { path: 'domains/memory/semantic/semantic-memory-crud.ts', rationale: 'KgTripleRepositorySqlite concrete until port injection' },
  { path: 'domains/memory/semantic/semantic-memory-update-pipeline.ts', rationale: 'KgTripleRepositorySqlite concrete until port injection' },
  { path: 'domains/memory/semantic/semantic-memory-update-service.ts', rationale: 'KgTripleRepositorySqlite concrete until port injection' },
  { path: 'domains/memory/tools/feedback-tool.ts', rationale: 'FeedbackRepositorySQLite concrete until port injection' },
  { path: 'domains/memory/recall/recall-tool-direct.ts', rationale: 'KnowledgeVaultRepositorySqlite + createCoreMemoryRepository factory (dynamic) concrete until port injection' },
  { path: 'domains/memory/remember/remember-tool-core.ts', rationale: 'createCoreMemoryRepository factory via dynamic import — concrete until port injection (#926)' },
  { path: 'domains/memory/remember/remember-tool-vault.ts', rationale: 'KnowledgeVaultRepositorySqlite concrete until port injection' },
  { path: 'domains/relation/services/triple-extraction/triple-extraction-service.ts', rationale: 'tripleExtractionLogger infra logger' },
  { path: 'domains/relation/tools/extract-triples-tool.ts', rationale: 'KgTripleRepositorySqlite concrete until port injection' },
  { path: 'domains/search/algorithms/hybrid-result-ranker.ts', rationale: 'Feedback/ProcessAttribute SQLite repos until port injection' },
  { path: 'domains/search/algorithms/search-engine.ts', rationale: 'FeedbackRepositorySQLite concrete until port injection' },
  { path: 'domains/telemetry/services/telemetry-service.ts', rationale: 'import type BatchScheduler for optional scheduler hook' },
] as const;

const SHARED_TO_INFRA_OR_SERVER_ALLOWLIST: readonly AllowlistEntry[] = [
  { path: 'shared/config/retry-options-loader.ts', rationale: 'import type RetryConfig from retry-manager' },
  { path: 'shared/services/llm-client-initializer.ts', rationale: 'RetryManager construction for LLM clients' },
  { path: 'shared/services/llm-client-initializer/ollama.ts', rationale: 'import type RetryManager for Ollama client' },
  { path: 'shared/utils/triple-cache.ts', rationale: 'CacheService concrete cache backend' },
] as const;

/** Allowlist growth guard — bump only with explicit review (#749 / FR-018). */
const FROZEN_DOMAIN_TO_INFRA_ALLOWLIST_SIZE = 19; // 18 → 19 (#926: dynamic import now detected)
const FROZEN_SHARED_TO_INFRA_OR_SERVER_ALLOWLIST_SIZE = 4;

/**
 * Module edges collected via the TypeScript AST (#926).
 * Covers static / dynamic / side-effect imports, `export ... from`, and `import('...')` type nodes —
 * all of which the previous line-based regex missed.
 */
type ModuleEdgeKind = 'import' | 'export-from' | 'dynamic' | 'import-type';
type ModuleEdge = { readonly spec: string; readonly kind: ModuleEdgeKind; readonly typeOnly: boolean };

function collectModuleEdges(source: string, filePath: string): ModuleEdge[] {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edges: ModuleEdge[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      edges.push({ spec: node.moduleSpecifier.text, kind: 'import', typeOnly: node.importClause?.isTypeOnly === true });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      edges.push({ spec: node.moduleSpecifier.text, kind: 'export-from', typeOnly: node.isTypeOnly });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      // Non-literal specifiers (template/variable) are unresolvable statically — none exist today.
      if (arg && ts.isStringLiteral(arg)) {
        edges.push({ spec: arg.text, kind: 'dynamic', typeOnly: false });
      }
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      edges.push({ spec: node.argument.literal.text, kind: 'import-type', typeOnly: true });
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return edges;
}

async function readSource(relativePath: string): Promise<string> {
  return await readFile(path.join(srcRoot, relativePath), 'utf8');
}

async function collectProductionTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'test') {
        return [];
      }
      return await collectProductionTsFiles(entryPath);
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) {
      return [];
    }
    return [path.relative(srcRoot, entryPath).split(path.sep).join('/')];
  }));

  return files.flat().sort();
}

async function collectDomainProductionFiles(dir: string): Promise<string[]> {
  return collectProductionTsFiles(dir);
}

/** Boundary check counts every edge, type-only included (allowlist rationale에 `import type` 항목이 있음). */
function findForbiddenImportSpecs(source: string, filePath: string, isForbidden: (spec: string) => boolean): string[] {
  return collectModuleEdges(source, filePath).filter((e) => isForbidden(e.spec)).map((e) => e.spec);
}

function isInfrastructureOrServerSpec(spec: string): boolean {
  const normalized = spec.replace(/\\/g, '/');
  return (
    normalized.includes('/infrastructure/')
    || normalized.includes('infrastructure/')
    || normalized.includes('memento-server')
    || normalized.includes('/packages/memento-server/')
  );
}

function resolveRelativeImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) {
    return null;
  }
  const fromDir = path.posix.dirname(fromFile);
  let resolved = path.posix.normalize(path.posix.join(fromDir, spec));
  if (resolved.endsWith('.js')) {
    resolved = `${resolved.slice(0, -3)}.ts`;
  } else if (!resolved.endsWith('.ts')) {
    resolved = `${resolved}.ts`;
  }
  return resolved;
}

/**
 * Load-time module edges only. Dynamic `import()` is deliberately excluded:
 * it is evaluated lazily and cannot form a load-time cycle (#926).
 */
function extractRuntimeSpecs(source: string, filePath: string): string[] {
  return collectModuleEdges(source, filePath)
    .filter((e) => !e.typeOnly && (e.kind === 'import' || e.kind === 'export-from'))
    .map((e) => e.spec);
}

async function findCyclesAmong(files: readonly string[]): Promise<string[][]> {
  const fileSet = new Set(files);
  const graph = new Map<string, string[]>();

  for (const file of files) {
    const source = await readSource(file);
    const deps: string[] = [];
    for (const spec of extractRuntimeSpecs(source, file)) {
      const resolved = resolveRelativeImport(file, spec);
      if (resolved && fileSet.has(resolved)) {
        deps.push(resolved);
      }
    }
    graph.set(file, deps);
  }

  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function dfs(node: string): void {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      cycles.push(stack.slice(start).concat(node));
      return;
    }
    if (visited.has(node)) {
      return;
    }
    visiting.add(node);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      dfs(next);
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }

  for (const file of files) {
    dfs(file);
  }

  return cycles;
}

describe('dependency boundaries', () => {
  it('keeps infrastructure cache and retry-manager imports out of relation service production files', async () => {
    const relationServicesRoot = path.join(domainsRoot, 'relation', 'services');
    const relationServiceFiles = await collectDomainProductionFiles(relationServicesRoot);
    const offenders: string[] = [];

    for (const relativePath of relationServiceFiles) {
      const source = await readSource(relativePath);
      const hasConcreteCacheImport = /import\s+.*['"].*infrastructure\/cache\/cache-service\.js['"]/m.test(source);
      const hasConcreteRetryImport = /import\s+.*['"].*infrastructure\/scheduler\/retry-manager\.js['"]/m.test(source);

      if (hasConcreteCacheImport || hasConcreteRetryImport) {
        offenders.push(relativePath);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps relation graph factory imports and fallbacks out of domain production files', async () => {
    const domainFiles = await collectDomainProductionFiles(domainsRoot);
    const offenders: string[] = [];

    for (const relativePath of domainFiles) {
      const source = await readSource(relativePath);
      const hasFactoryImport = /^\s*import\s+.*relation-graph-factory\.js['"];?$/m.test(source);
      const hasFallback = /relationGraph\s*(?:\?\?|\|\|)\s*createRelationGraph\s*\(/m.test(source);

      if (hasFactoryImport || hasFallback) {
        offenders.push(relativePath);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps concrete RelationGraph imports pinned to an explicit allowlist', async () => {
    const domainFiles = await collectDomainProductionFiles(domainsRoot);
    const offenders: string[] = [];

    for (const relativePath of domainFiles) {
      const source = await readSource(relativePath);
      const hasConcreteRelationGraphImport = /import\s+(?:type\s+)?\{?\s*RelationGraph\s*\}?\s+from\s+['"].*relation\/services\/relation-graph\.js['"]/m.test(source);

      if (hasConcreteRelationGraphImport) {
        offenders.push(relativePath);
      }
    }

    expect(offenders).toEqual([...ALLOWED_CONCRETE_RELATION_GRAPH_IMPORTS]);
  });

  it('wires relationGraph through the domain port from bootstrap to tool context', async () => {
    const [portSource, toolTypesSource, bootstrapSource, batchTelemetryRelationSource, contextSource] = await Promise.all([
      readSource('domains/relation/ports/relation-graph.port.ts'),
      readSource('tools/types.ts'),
      readSource('bootstrap.ts'),
      readSource('bootstrap/batch-telemetry-relation.ts'),
      readSource('context.ts'),
    ]);

    expect(portSource).toContain('RelationGraphPort');
    expect(toolTypesSource).toContain('relationGraph?: RelationGraphPort;');
    expect(toolTypesSource).not.toContain('services/relation-graph.js');
    expect(bootstrapSource).toContain('relationGraph: RelationGraphPort;');
    expect(batchTelemetryRelationSource).toContain('const relationGraph = createRelationGraph(db);');
    expect(bootstrapSource).toContain('createBatchTelemetryRelationAndSleep');
    expect(contextSource).toContain('relationGraph: serverContext.services.relationGraph');
  });

  it('freezes domain→infrastructure imports to an allowlist with growth guard (#749)', async () => {
    expect(DOMAIN_TO_INFRA_ALLOWLIST).toHaveLength(FROZEN_DOMAIN_TO_INFRA_ALLOWLIST_SIZE);
    expect(new Set(DOMAIN_TO_INFRA_ALLOWLIST.map((e) => e.path)).size).toBe(FROZEN_DOMAIN_TO_INFRA_ALLOWLIST_SIZE);
    expect(DOMAIN_TO_INFRA_ALLOWLIST.every((e) => e.rationale.trim().length > 0)).toBe(true);

    const domainFiles = await collectProductionTsFiles(domainsRoot);
    const allowlistPaths = new Set(DOMAIN_TO_INFRA_ALLOWLIST.map((e) => e.path));
    const offenders: string[] = [];

    for (const relativePath of domainFiles) {
      const source = await readSource(relativePath);
      const forbidden = findForbiddenImportSpecs(source, relativePath, (spec) => {
        const normalized = spec.replace(/\\/g, '/');
        return normalized.includes('/infrastructure/') || normalized.includes('infrastructure/');
      });
      if (forbidden.length > 0) {
        offenders.push(relativePath);
      }
    }

    const unexpected = offenders.filter((p) => !allowlistPaths.has(p)).sort();
    const stale = [...allowlistPaths].filter((p) => !offenders.includes(p)).sort();

    expect(unexpected, `new domain→infra imports (not on allowlist): ${unexpected.join(', ')}`).toEqual([]);
    expect(stale, `allowlist stale entries (remove or restore import): ${stale.join(', ')}`).toEqual([]);
    expect([...offenders].sort()).toEqual([...allowlistPaths].sort());
  });

  it('freezes shared→infrastructure|server imports to an allowlist with growth guard (#749)', async () => {
    expect(SHARED_TO_INFRA_OR_SERVER_ALLOWLIST).toHaveLength(FROZEN_SHARED_TO_INFRA_OR_SERVER_ALLOWLIST_SIZE);
    expect(new Set(SHARED_TO_INFRA_OR_SERVER_ALLOWLIST.map((e) => e.path)).size).toBe(
      FROZEN_SHARED_TO_INFRA_OR_SERVER_ALLOWLIST_SIZE,
    );
    expect(SHARED_TO_INFRA_OR_SERVER_ALLOWLIST.every((e) => e.rationale.trim().length > 0)).toBe(true);

    const sharedFiles = await collectProductionTsFiles(sharedRoot);
    const allowlistPaths = new Set(SHARED_TO_INFRA_OR_SERVER_ALLOWLIST.map((e) => e.path));
    const offenders: string[] = [];

    for (const relativePath of sharedFiles) {
      const source = await readSource(relativePath);
      const forbidden = findForbiddenImportSpecs(source, relativePath, isInfrastructureOrServerSpec);
      if (forbidden.length > 0) {
        offenders.push(relativePath);
      }
    }

    const unexpected = offenders.filter((p) => !allowlistPaths.has(p)).sort();
    const stale = [...allowlistPaths].filter((p) => !offenders.includes(p)).sort();

    expect(unexpected, `new shared→infra|server imports (not on allowlist): ${unexpected.join(', ')}`).toEqual([]);
    expect(stale, `allowlist stale entries (remove or restore import): ${stale.join(', ')}`).toEqual([]);
    expect([...offenders].sort()).toEqual([...allowlistPaths].sort());
  });

  it('has no runtime import cycle among database utils / schema-init / fts5 (#749)', async () => {
    const cycleFiles = [
      'shared/utils/database.ts',
      'shared/utils/database/schema-initialization.ts',
      'shared/utils/fts5-migration-status.ts',
    ] as const;

    const cycles = await findCyclesAmong(cycleFiles);
    expect(cycles, `runtime cycles: ${JSON.stringify(cycles)}`).toEqual([]);
  });

  it('has no runtime import cycle between batch-scheduler and singleton (#749)', async () => {
    const cycleFiles = [
      'infrastructure/scheduler/batch-scheduler.ts',
      'infrastructure/scheduler/batch-scheduler/batch-scheduler-singleton.ts',
      'infrastructure/scheduler/batch-scheduler/batch-scheduler.ts',
    ] as const;

    const cycles = await findCyclesAmong(cycleFiles);
    expect(cycles, `runtime cycles: ${JSON.stringify(cycles)}`).toEqual([]);
  });

  it('detects dynamic import, re-export, multiline and side-effect edges (#926)', () => {
    const source = [
      "import { A } from '../../infrastructure/a.js';",
      'import {',
      '  B,',
      "} from '../../infrastructure/b.js';",
      "export { C } from '../../infrastructure/c.js';",
      "export * from '../../infrastructure/d.js';",
      "import '../../infrastructure/e.js';",
      "import type { F } from '../../infrastructure/f.js';",
      'async function load() {',
      "  const { g } = await import('../../infrastructure/g.js');",
      '  return g;',
      '}',
    ].join('\n');

    const hits = findForbiddenImportSpecs(source, 'domains/fixture.ts', (spec) => spec.includes('infrastructure/'));

    expect(hits.sort()).toEqual([
      '../../infrastructure/a.js',
      '../../infrastructure/b.js',
      '../../infrastructure/c.js',
      '../../infrastructure/d.js',
      '../../infrastructure/e.js',
      '../../infrastructure/f.js',
      '../../infrastructure/g.js',
    ]);
  });

  it('detects the two known dynamic infrastructure imports in domain files (#926)', async () => {
    const targets = [
      'domains/memory/recall/recall-tool-direct.ts',
      'domains/memory/remember/remember-tool-core.ts',
    ] as const;

    for (const relativePath of targets) {
      const source = await readSource(relativePath);
      const hits = findForbiddenImportSpecs(source, relativePath, (spec) => spec.includes('infrastructure/'));
      expect(hits, relativePath).toContain(
        '../../../infrastructure/database/factories/core-memory-repository.factory.js',
      );
    }
  });

  it('keeps type-only and dynamic edges out of the runtime cycle graph (#926)', () => {
    const source = [
      "import type { A } from './a.js';",
      "export type { B } from './b.js';",
      "import { C } from './c.js';",
      "export { D } from './d.js';",
      "const e = await import('./e.js');",
    ].join('\n');

    expect(extractRuntimeSpecs(source, 'shared/fixture.ts').sort()).toEqual(['./c.js', './d.js']);
  });
});
