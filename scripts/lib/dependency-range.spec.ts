/**
 * #989/#993 — sharp must resolve exactly once, at or above the security floor.
 *
 * #989 pinned the root range to `^0.35.4`. #993 removed the root declaration
 * entirely: `@huggingface/transformers` declares `sharp` as a hard dependency,
 * so a second root requirer only re-arms the §2.4 nested-install trap whenever
 * upstream moves its own range.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (f: string) => JSON.parse(readFileSync(join(process.cwd(), f), 'utf8'));

describe('sharp dependency shape (#989/#993)', () => {
  it('is not declared as a direct dependency', () => {
    const pkg = read('package.json');
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      expect(pkg[field] ?? {}).not.toHaveProperty('sharp');
    }
  });

  it('resolves to exactly one tree entry (no nested install, §2.4)', () => {
    const lock = read('package-lock.json');
    const paths = Object.keys(lock.packages).filter(
      (p) => p === 'node_modules/sharp' || p.endsWith('/node_modules/sharp'),
    );
    expect(paths).toEqual(['node_modules/sharp']);
  });

  it('sits at or above the 0.35.4 security floor', () => {
    // Avoid importing semver: tree semver is sharp's transitive dep (phantom dependency).
    const lock = read('package-lock.json');
    const version: string = lock.packages['node_modules/sharp'].version;
    const [major, minor, patch] = version.split('.').map(Number);
    // GHSA-f88m-g3jw-g9cj (libvips, >=0.35) / GHSA-rgj7-g3m4-5g8c (libheif, >=0.35.4)
    expect(major).toBe(0);
    expect(minor).toBeGreaterThanOrEqual(35);
    if (minor === 35) expect(patch).toBeGreaterThanOrEqual(4);
  });
});
