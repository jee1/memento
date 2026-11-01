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

const DOMAIN_TO_INFRA_ALLOWLIST: readonly AllowlistEntry[] = [] as const;

const SHARED_TO_INFRA_OR_SERVER_ALLOWLIST: readonly AllowlistEntry[] = [] as const;

/** Allowlist growth guard — bump only with explicit review (#749 / FR-018). */
const FROZEN_DOMAIN_TO_INFRA_ALLOWLIST_SIZE = 0; // #1333: telemetry uses a narrow scheduler type
const FROZEN_SHARED_TO_INFRA_OR_SERVER_ALLOWLIST_SIZE = 0; // #1327: RetryManager moved to shared

// #1534: direction pairs include type-only and dynamic edges; order proves the frozen graph is a DAG.
const DOMAIN_DEPENDENCY_ORDER = [
  'agent-integration', 'anchor', 'consolidation', 'personal-agent', 'monitoring',
  'memory', 'forgetting', 'telemetry', 'search', 'relation', 'embedding', 'settings',
] as const;
const DOMAIN_DIRECTION_ALLOWLIST: readonly AllowlistEntry[] = [
  { path: 'agent-integration→search', rationale: '주입 후보 검색' },
  { path: 'anchor→embedding', rationale: '앵커 검색·관계 탐색·관측' },
  { path: 'anchor→monitoring', rationale: '앵커 검색·관계 탐색·관측' },
  { path: 'anchor→relation', rationale: '앵커 검색·관계 탐색·관측' },
  { path: 'anchor→search', rationale: '앵커 검색·관계 탐색·관측' },
  { path: 'consolidation→embedding', rationale: '증류 임베딩·요약·텔레메트리' },
  { path: 'consolidation→personal-agent', rationale: '증류 임베딩·요약·텔레메트리' },
  { path: 'consolidation→telemetry', rationale: '증류 임베딩·요약·텔레메트리' },
  { path: 'memory→embedding', rationale: '기억 조회·망각·관계·관측' },
  { path: 'memory→forgetting', rationale: '기억 조회·망각·관계·관측' },
  { path: 'memory→relation', rationale: '기억 조회·망각·관계·관측' },
  { path: 'memory→search', rationale: '기억 조회·망각·관계·관측' },
  { path: 'memory→telemetry', rationale: '기억 조회·망각·관계·관측' },
  { path: 'monitoring→memory', rationale: '품질 측정·메타 메모리 통계' },
  { path: 'monitoring→relation', rationale: '품질 측정·메타 메모리 통계' },
  { path: 'monitoring→search', rationale: '품질 측정·메타 메모리 통계' },
  { path: 'personal-agent→memory', rationale: '지식 컨텍스트 구성' },
  { path: 'relation→embedding', rationale: '관계 임베딩' },
  { path: 'search→embedding', rationale: '검색 임베딩·관계 확장' },
  { path: 'search→relation', rationale: '검색 임베딩·관계 확장' },
  { path: 'telemetry→search', rationale: '검색 품질 집계' },
];
const FROZEN_DOMAIN_DIRECTION_ALLOWLIST_SIZE = 21;

// Registration stays here until ToolContext contracts are separated from the composition root.
const TOOLS_TO_DOMAIN_ALLOWLIST = [
  { path: 'tools/base-tool.ts', rationale: '실패 감지 훅 타입', targets: [
    'domains/monitoring/services/failure-detector.ts',
  ] },
  { path: 'tools/types.ts', rationale: '기존 ToolContext 서비스 계약; 새 서비스 의존은 별도 리뷰', targets: [
    'domains/search/algorithms/search-engine.ts',
    'domains/search/algorithms/hybrid-search-engine.ts',
    'domains/embedding/services/memory-embedding-service.ts',
    'domains/forgetting/services/forgetting-policy-service.ts',
    'domains/monitoring/services/error-logging-service.ts',
    'domains/anchor/services/anchor/anchor-manager.ts',
    'domains/relation/ports/relation-graph.port.ts',
    'domains/search/algorithms/vector-search-engine.ts',
    'domains/monitoring/services/failure-detector.ts',
    'domains/memory/introspection/meta-memory-service.ts',
    'domains/memory/introspection/introspection-scan-cache.ts',
    'domains/monitoring/services/performance-monitor.ts',
    'domains/telemetry/services/telemetry-service.ts',
  ] },
  { path: 'tools/migrate-embeddings-tool.ts', rationale: '임베딩 이관 핸들러', targets: [
    'domains/embedding/services/unified-embedding-service.ts',
    'domains/embedding/services/vector-compatibility-service.ts',
  ] },
  { path: 'tools/index.ts', rationale: '도구 등록 조립 루트', targets: [
    'domains/memory/remember/remember-tool.ts',
    'domains/memory/recall/recall-tool.ts',
    'domains/memory/tools/forget-tool.ts',
    'domains/memory/tools/pin-tool.ts',
    'domains/memory/tools/unpin-tool.ts',
    'domains/memory/tools/memory-injection-prompt.ts',
    'domains/memory/tools/get-memory-neighbors-tool.ts',
    'domains/anchor/tools/set-anchor-tool.ts',
    'domains/anchor/tools/get-anchor-tool.ts',
    'domains/anchor/tools/search-local-tool.ts',
    'domains/anchor/tools/clear-anchor-tool.ts',
    'domains/memory/procedural/procedural-diff-tool.ts',
    'domains/memory/procedural/procedural-rollback-tool.ts',
    'domains/memory/procedural/remember-procedure-tool.ts',
    'domains/memory/introspection/get-introspection-summary-tool.ts',
    'domains/memory/tools/feedback-tool.ts',
    'domains/telemetry/tools/get-telemetry-summary-tool.ts',
    'domains/relation/tools/add-relation-tool.ts',
    'domains/relation/tools/get-relations-tool.ts',
    'domains/relation/tools/remove-relation-tool.ts',
    'domains/memory/tools/export-memories-tool.ts',
    'domains/memory/tools/wipe-memory-tool.ts',
  ] },
] as const;
const FROZEN_TOOLS_TO_DOMAIN_EDGE_COUNT = 38;
const TOOL_CONTRACT_FILES = new Set(['tools/types.ts', 'tools/base-tool.ts', 'tools/caller-scope.ts']);

/**
 * Module edges collected via the TypeScript AST (#926).
 * Covers static / dynamic / side-effect imports, `export ... from`, and `import('...')` type nodes —
 * all of which the previous line-based regex missed.
 */
type ModuleEdgeKind = 'import' | 'export-from' | 'dynamic' | 'import-type';
type ModuleEdge = { readonly spec: string; readonly kind: ModuleEdgeKind; readonly typeOnly: boolean };

/** Virtual fileName for ts.createSourceFile — ScriptKind.TS is fixed; path does not affect parsing (#926 review). */
const AST_VIRTUAL_FILE = 'virtual.ts';

function collectModuleEdges(source: string): ModuleEdge[] {
  const sourceFile = ts.createSourceFile(AST_VIRTUAL_FILE, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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
function findForbiddenImportSpecs(source: string, isForbidden: (spec: string) => boolean): string[] {
  return collectModuleEdges(source).filter((e) => isForbidden(e.spec)).map((e) => e.spec);
}

/**
 * Resolves `spec` from `fromFile` (src-relative) and reports whether it lands in one of `layers`
 * (top-level src dirs such as `infrastructure`, `server`) or in the memento-server package.
 * Path-based so core `src/server/` counts as the server layer (#1339).
 */
function importsLayer(fromFile: string, spec: string, layers: readonly string[]): boolean {
  const normalized = spec.replace(/\\/g, '/');
  if (normalized.includes('memento-server')) {
    return true;
  }
  const resolved = resolveRelativeImport(fromFile, normalized);
  return resolved !== null && layers.some((layer) => resolved.startsWith(`${layer}/`));
}

const INFRA_OR_SERVER_LAYERS = ['infrastructure', 'server'] as const;

function resolveRelativeImport(fromFile: string, spec: string): string | null {
  if (spec.startsWith('@memento/core/')) {
    return path.posix.normalize(spec.slice('@memento/core/'.length)).replace(/\.js$/, '.ts');
  }
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
function extractRuntimeSpecs(source: string): string[] {
  return collectModuleEdges(source)
    .filter((e) => !e.typeOnly && (e.kind === 'import' || e.kind === 'export-from'))
    .map((e) => e.spec);
}

async function findCyclesAmong(files: readonly string[]): Promise<string[][]> {
  const fileSet = new Set(files);
  const graph = new Map<string, string[]>();

  for (const file of files) {
    const source = await readSource(file);
    const deps: string[] = [];
    for (const spec of extractRuntimeSpecs(source)) {
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
      const hasConcreteRetryImport = /import\s+.*['"].*(?:infrastructure\/scheduler|shared\/utils)\/retry-manager\.js['"]/m.test(source);

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

  it('freezes domain→infrastructure|server imports to an allowlist with growth guard (#749)', async () => {
    expect(DOMAIN_TO_INFRA_ALLOWLIST).toHaveLength(FROZEN_DOMAIN_TO_INFRA_ALLOWLIST_SIZE);
    expect(new Set(DOMAIN_TO_INFRA_ALLOWLIST.map((e) => e.path)).size).toBe(FROZEN_DOMAIN_TO_INFRA_ALLOWLIST_SIZE);
    expect(DOMAIN_TO_INFRA_ALLOWLIST.every((e) => e.rationale.trim().length > 0)).toBe(true);

    const domainFiles = await collectProductionTsFiles(domainsRoot);
    const allowlistPaths = new Set(DOMAIN_TO_INFRA_ALLOWLIST.map((e) => e.path));
    const offenders: string[] = [];

    for (const relativePath of domainFiles) {
      const source = await readSource(relativePath);
      const forbidden = findForbiddenImportSpecs(source, (spec) =>
        importsLayer(relativePath, spec, INFRA_OR_SERVER_LAYERS));
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

  it('keeps tools/ imports inside domain handler files (#1341)', async () => {
    // Handler = MCP tool code living in its domain: a `tools/` or `adapters/` dir, or a `*-tool.ts` / `*-tool-*.ts` file.
    const isHandlerFile = (p: string): boolean =>
      /\/(tools|adapters)\//.test(p) || /-tool(-[^/]+)?\.ts$/.test(p);
    const domainFiles = await collectProductionTsFiles(domainsRoot);
    const offenders: string[] = [];

    for (const relativePath of domainFiles.filter((p) => !isHandlerFile(p))) {
      const source = await readSource(relativePath);
      if (findForbiddenImportSpecs(source, (spec) => importsLayer(relativePath, spec, ['tools'])).length > 0) {
        offenders.push(relativePath);
      }
    }

    expect(offenders, `non-handler domain files importing tools/: ${offenders.join(', ')}`).toEqual([]);
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
      const forbidden = findForbiddenImportSpecs(source, (spec) => importsLayer(relativePath, spec, INFRA_OR_SERVER_LAYERS));
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

  it('forbids shared→domains imports (#1534)', async () => {
    const offenders: string[] = [];
    for (const file of await collectProductionTsFiles(sharedRoot)) {
      for (const edge of collectModuleEdges(await readSource(file))) {
        if (resolveRelativeImport(file, edge.spec)?.startsWith('domains/')) {
          offenders.push(`${file}→${edge.spec}`);
        }
      }
    }
    expect(offenders, `shared→domains imports: ${offenders.join(', ')}`).toEqual([]);
  });

  it('freezes domain directions to an acyclic graph (#1534)', async () => {
    expect(DOMAIN_DIRECTION_ALLOWLIST).toHaveLength(FROZEN_DOMAIN_DIRECTION_ALLOWLIST_SIZE);
    const allowed = new Set(DOMAIN_DIRECTION_ALLOWLIST.map((entry) => entry.path));
    expect(allowed.size).toBe(FROZEN_DOMAIN_DIRECTION_ALLOWLIST_SIZE);
    expect(DOMAIN_DIRECTION_ALLOWLIST.every((entry) => entry.rationale.trim().length > 0)).toBe(true);
    const order = new Map<string, number>(DOMAIN_DEPENDENCY_ORDER.map((domain, index) => [domain, index]));
    for (const direction of allowed) {
      const [from, to] = direction.split('→');
      expect(order.has(from) && order.has(to), direction).toBe(true);
      expect(order.get(from)!, direction).toBeLessThan(order.get(to)!);
    }

    const directions = new Set<string>();
    const offenders: string[] = [];
    const files = await collectProductionTsFiles(domainsRoot);
    expect([...new Set(files.map((file) => file.split('/')[1]))].sort()).toEqual([...order.keys()].sort());
    for (const file of files) {
      const from = file.split('/')[1];
      for (const edge of collectModuleEdges(await readSource(file))) {
        const target = resolveRelativeImport(file, edge.spec);
        if (!target?.startsWith('domains/')) continue;
        const to = target.split('/')[1];
        if (from === to) continue;
        const direction = `${from}→${to}`;
        directions.add(direction);
        if (!allowed.has(direction)) offenders.push(`${file}→${target}`);
      }
    }
    expect(offenders, `new domain directions: ${offenders.join(', ')}`).toEqual([]);
    expect([...directions].sort()).toEqual([...allowed].sort());
  });

  it('freezes tools→domain imports and permits only tool contracts from domain handlers (#1534)', async () => {
    expect(TOOLS_TO_DOMAIN_ALLOWLIST.every((entry) => entry.rationale.trim().length > 0)).toBe(true);
    const allowed = TOOLS_TO_DOMAIN_ALLOWLIST.flatMap((entry) => entry.targets.map((target) => `${entry.path}→${target}`));
    expect(allowed).toHaveLength(FROZEN_TOOLS_TO_DOMAIN_EDGE_COUNT);
    expect(new Set(allowed).size).toBe(FROZEN_TOOLS_TO_DOMAIN_EDGE_COUNT);
    const actual: string[] = [];
    for (const file of await collectProductionTsFiles(path.join(srcRoot, 'tools'))) {
      for (const edge of collectModuleEdges(await readSource(file))) {
        const target = resolveRelativeImport(file, edge.spec);
        if (target?.startsWith('domains/')) actual.push(`${file}→${target}`);
      }
    }
    expect(actual.sort()).toEqual([...allowed].sort());

    const offenders: string[] = [];
    for (const file of await collectProductionTsFiles(domainsRoot)) {
      for (const edge of collectModuleEdges(await readSource(file))) {
        const target = resolveRelativeImport(file, edge.spec);
        if (target?.startsWith('tools/') && !TOOL_CONTRACT_FILES.has(target)) {
          offenders.push(`${file}→${target}`);
        }
      }
    }
    expect(offenders, `domain imports of tool registration/implementation: ${offenders.join(', ')}`).toEqual([]);
  });

  it('has no runtime import cycle among database utils / schema-init / fts5 (#749)', async () => {
    const cycleFiles = [
      'shared/utils/database.ts',
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
    expect(resolveRelativeImport('shared/probe.ts', '@memento/core/shared/../domains/search/algorithms/search-engine.js'))
      .toBe('domains/search/algorithms/search-engine.ts');
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
      "type H = import('../../infrastructure/h.js').Foo;",
    ].join('\n');

    const hits = findForbiddenImportSpecs(source, (spec) => spec.includes('infrastructure/'));

    expect(hits.sort()).toEqual([
      '../../infrastructure/a.js',
      '../../infrastructure/b.js',
      '../../infrastructure/c.js',
      '../../infrastructure/d.js',
      '../../infrastructure/e.js',
      '../../infrastructure/f.js',
      '../../infrastructure/g.js',
      '../../infrastructure/h.js',
    ]);
  });

  it('keeps type-only and dynamic edges out of the runtime cycle graph (#926)', () => {
    const source = [
      "import type { A } from './a.js';",
      "export type { B } from './b.js';",
      "import { C } from './c.js';",
      "export { D } from './d.js';",
      "const e = await import('./e.js');",
      "type F = import('./f.js').Foo;",
    ].join('\n');

    expect(extractRuntimeSpecs(source).sort()).toEqual(['./c.js', './d.js']);
  });
});
