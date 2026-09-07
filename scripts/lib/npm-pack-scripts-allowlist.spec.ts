/**
 * #859 — tarball package/scripts allowlist (pure checker).
 */
import { describe, it, expect } from 'vitest';

describe('findDisallowedScriptPaths (#859)', () => {
  it('flags .ts under package/scripts even if somehow listed', async () => {
    const { findDisallowedScriptPaths, ALLOWED_PACKAGE_SCRIPT_PATHS } = await import(
      './npm-pack-scripts-allowlist.js'
    );
    const violations = findDisallowedScriptPaths([
      ...ALLOWED_PACKAGE_SCRIPT_PATHS,
      'package/scripts/lib/postinstall-db-init.spec.ts',
    ]);
    expect(violations).toContain('package/scripts/lib/postinstall-db-init.spec.ts');
  });

  it('flags non-allowlisted .js under package/scripts', async () => {
    const { findDisallowedScriptPaths, ALLOWED_PACKAGE_SCRIPT_PATHS } = await import(
      './npm-pack-scripts-allowlist.js'
    );
    const violations = findDisallowedScriptPaths([
      ...ALLOWED_PACKAGE_SCRIPT_PATHS,
      'package/scripts/verify-npm-pack-bundle.js',
      'package/scripts/prepack-bundle-core.js',
    ]);
    expect(violations).toEqual([
      'package/scripts/prepack-bundle-core.js',
      'package/scripts/verify-npm-pack-bundle.js',
    ]);
  });

  it('passes when only allowlisted script files (+ dirs) are present', async () => {
    const { findDisallowedScriptPaths, ALLOWED_PACKAGE_SCRIPT_PATHS } = await import(
      './npm-pack-scripts-allowlist.js'
    );
    const violations = findDisallowedScriptPaths([
      'package/scripts/',
      'package/scripts/lib/',
      ...ALLOWED_PACKAGE_SCRIPT_PATHS,
      'package/dist/server/index.js',
    ]);
    expect(violations).toEqual([]);
  });

  it('exports exactly the three runtime script paths', async () => {
    const { ALLOWED_PACKAGE_SCRIPT_PATHS } = await import('./npm-pack-scripts-allowlist.js');
    expect([...ALLOWED_PACKAGE_SCRIPT_PATHS].sort()).toEqual([
      'package/scripts/auto-setup.js',
      'package/scripts/lib/cli-runtime.js',
      'package/scripts/lib/postinstall-db-init.js',
    ]);
  });
});
