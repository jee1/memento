/**
 * #989 — sharp range must admit 0.35.4 and reject 0.34.x (§2.4 nested-install trap).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('package.json dependency ranges (#989)', () => {
  it('sharp range admits 0.35.4 and rejects 0.34.x', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    const range = pkg.dependencies.sharp;
    // String assertion avoids adding semver as a devDependency; the range is pinned explicitly.
    expect(range).toBe('^0.35.4');
  });
});
