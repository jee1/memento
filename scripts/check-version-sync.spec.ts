import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkVersionSync } from './check-version-sync.js';

const MANIFEST_PATHS = [
  'package.json',
  'packages/memento-core/package.json',
  'packages/memento-server/package.json',
];

let root: string;

const writeManifest = (relativePath: string, version: string) => {
  const full = join(root, relativePath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, `${JSON.stringify({ name: 'test', version }, null, 2)}\n`);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'version-sync-'));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('checkVersionSync', () => {
  it('세 버전이 같을 때 위반이 0건이다', () => {
    for (const file of MANIFEST_PATHS) {
      writeManifest(file, '1.0.0');
    }
    const result = checkVersionSync(root, MANIFEST_PATHS);
    expect(result.violations).toHaveLength(0);
    expect(result.manifests).toHaveLength(3);
  });

  it('세 버전 중 하나가 다를 때 위반이 보고된다', () => {
    writeManifest('package.json', '1.0.0');
    writeManifest('packages/memento-core/package.json', '1.0.0');
    writeManifest('packages/memento-server/package.json', '1.1.0');
    const result = checkVersionSync(root, MANIFEST_PATHS);
    expect(result.violations).toHaveLength(3);
    expect(result.violations.map((entry) => entry.version)).toEqual(['1.0.0', '1.0.0', '1.1.0']);
  });
});
