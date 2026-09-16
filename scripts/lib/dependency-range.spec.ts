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
    // Avoid importing semver: tree semver is sharp's transitive dep (phantom dependency).
    // Exact match is intentional — range changes must be deliberate edits (§2.4 nested-install trap).
    expect(range).toBe('^0.35.4');
  });
});
