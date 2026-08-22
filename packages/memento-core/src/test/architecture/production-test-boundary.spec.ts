import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const packageRoot = path.resolve(srcRoot, '..');

async function collectProductionTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    if (entry.name === 'test' || entry.name === '__tests__') return [];
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectProductionTsFiles(entryPath);
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) return [];
    return [entryPath];
  }))).flat();
}

describe('production/test boundary', () => {
  it('keeps production source independent from test modules', async () => {
    const offenders: string[] = [];
    for (const file of await collectProductionTsFiles(srcRoot)) {
      const source = await readFile(file, 'utf8');
      if (/from\s+['"][^'"]*\/test(?:\/|['"])/.test(source)) {
        offenders.push(path.relative(srcRoot, file));
      }
    }
    expect(offenders.sort()).toEqual([]);
  });

  it('does not publish build artifacts from the test tree', async () => {
    const packageJson = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8')) as {
      exports?: Record<string, unknown>;
    };
    expect(JSON.stringify(packageJson.exports)).not.toContain('dist/test');
  });
});
