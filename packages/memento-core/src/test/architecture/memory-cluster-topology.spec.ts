import { access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const memoryRoot = path.join(srcRoot, 'domains', 'memory');

const REQUIRED_CLUSTER_ENTRYPOINTS = {
  recall: 'recall-tool.ts',
  remember: 'remember-tool.ts',
  review: 'memory-review-candidate-selection-service.ts',
  semantic: 'semantic-memory-update-service.ts',
  procedural: 'procedural-memory-extractor.ts',
  introspection: 'meta-memory-introspection-service.ts',
} as const;

async function collectProductionTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    if (entry.name === '__tests__' || entry.name === 'test') return [];
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectProductionTsFiles(entryPath);
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) return [];
    return [entryPath];
  }))).flat();
}

describe('memory domain cluster topology', () => {
  it('keeps each behavior cluster explicit and below the 20-file review limit', async () => {
    const counts: Record<string, number> = {};

    for (const [cluster, entrypoint] of Object.entries(REQUIRED_CLUSTER_ENTRYPOINTS)) {
      const clusterRoot = path.join(memoryRoot, cluster);
      await expect(access(path.join(clusterRoot, entrypoint))).resolves.toBeUndefined();
      counts[cluster] = (await collectProductionTsFiles(clusterRoot)).length;
    }

    expect(counts).toEqual({
      recall: 15,
      remember: 11,
      review: 8,
      semantic: 12,
      procedural: 12,
      introspection: 6,
    });
    expect(Object.values(counts).every((count) => count <= 20)).toBe(true);
  });

  it('keeps procedural-memory implementation files out of shared utils', async () => {
    const sharedUtilsRoot = path.join(srcRoot, 'shared', 'utils');
    const oldFiles = (await readdir(sharedUtilsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.startsWith('procedural-memory-'))
      .map((entry) => entry.name)
      .sort();

    expect(oldFiles).toEqual([]);
  });
});
