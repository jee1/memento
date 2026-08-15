import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  { path: 'domains/memory/services/procedural-llm-extractor.ts', rationale: 'RetryManager for LLM extraction' },
  { path: 'domains/memory/services/semantic-memory/semantic-memory-crud.ts', rationale: 'KgTripleRepositorySqlite concrete until port injection' },
  { path: 'domains/memory/services/semantic-memory/semantic-memory-update-pipeline.ts', rationale: 'KgTripleRepositorySqlite concrete until port injection' },
  { path: 'domains/memory/services/semantic-memory/semantic-memory-update-service.ts', rationale: 'KgTripleRepositorySqlite concrete until port injection' },
  { path: 'domains/memory/tools/feedback-tool.ts', rationale: 'FeedbackRepositorySQLite concrete until port injection' },
  { path: 'domains/memory/tools/recall-tool-direct.ts', rationale: 'KnowledgeVaultRepositorySqlite concrete until port injection' },
  { path: 'domains/memory/tools/remember-tool-vault.ts', rationale: 'KnowledgeVaultRepositorySqlite concrete until port injection' },
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
const FROZEN_DOMAIN_TO_INFRA_ALLOWLIST_SIZE = 18;
const FROZEN_SHARED_TO_INFRA_OR_SERVER_ALLOWLIST_SIZE = 4;

const IMPORT_FROM_RE =
  /^\s*import\s+(?:type\s+)?(?:[\w*{}\s,$]+)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/;

/** Runtime module edges only (import / export-from). Skips `import type` and `export type`. */
const RUNTIME_FROM_RE =
  /^\s*(?:import(?!\s+type\b)|export(?!\s+type\b))\s+(?:[\w*{}\s,$]+)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/;

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

function findForbiddenImportSpecs(source: string, isForbidden: (spec: string) => boolean): string[] {
  const hits: string[] = [];
  for (const line of source.split('\n')) {
    const match = IMPORT_FROM_RE.exec(line);
    if (!match) {
      continue;
    }
    const spec = match[1];
    if (isForbidden(spec)) {
      hits.push(spec);
    }
  }
  return hits;
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

function extractRuntimeFromSpecs(source: string): string[] {
  const specs: string[] = [];
  for (const line of source.split('\n')) {
    const match = RUNTIME_FROM_RE.exec(line);
    if (match) {
      specs.push(match[1]);
    }
  }

  // Multiline `import { ... } from` / `export { ... } from` (not type-only).
  const multilineRe =
    /(?:^|\n)\s*(?:import(?!\s+type\b)|export(?!\s+type\b))\s+(?:type\s+)?\{[\s\S]*?\}\s+from\s+['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(multilineRe)) {
    const full = match[0];
    if (/\bexport\s+type\b|\bimport\s+type\b/.test(full)) {
      continue;
    }
    if (!specs.includes(match[1])) {
      specs.push(match[1]);
    }
  }

  return specs;
}

async function findCyclesAmong(files: readonly string[]): Promise<string[][]> {
  const fileSet = new Set(files);
  const graph = new Map<string, string[]>();

  for (const file of files) {
    const source = await readSource(file);
    const deps: string[] = [];
    for (const spec of extractRuntimeFromSpecs(source)) {
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
      const forbidden = findForbiddenImportSpecs(source, (spec) => {
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
      const forbidden = findForbiddenImportSpecs(source, isInfrastructureOrServerSpec);
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
    ] as const;

    const cycles = await findCyclesAmong(cycleFiles);
    expect(cycles, `runtime cycles: ${JSON.stringify(cycles)}`).toEqual([]);
  });
});
