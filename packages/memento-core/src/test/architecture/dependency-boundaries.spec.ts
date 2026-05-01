import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(currentDir, '..', '..');
const domainsRoot = path.join(srcRoot, 'domains');
const ALLOWED_CONCRETE_RELATION_GRAPH_IMPORTS = [
  'domains/anchor/services/anchor/anchor-search-service.ts',
  'domains/anchor/services/anchor/n-hop-search-service.ts',
  'domains/search/algorithms/hybrid-search-engine.ts',
] as const;

async function readSource(relativePath: string): Promise<string> {
  return await readFile(path.join(srcRoot, relativePath), 'utf8');
}

async function collectDomainProductionFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') {
        return [];
      }
      return await collectDomainProductionFiles(entryPath);
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) {
      return [];
    }
    return [path.relative(srcRoot, entryPath)];
  }));

  return files.flat().sort();
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
});
