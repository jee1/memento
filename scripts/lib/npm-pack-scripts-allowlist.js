/**
 * #859 — npm pack tarball: only these package/scripts files may ship.
 * Used by verify-npm-pack-bundle.js (always, independent of MEMENTO_PACK_SMOKE).
 */

/** Exact tarball paths (ustar names) allowed under package/scripts/ */
export const ALLOWED_PACKAGE_SCRIPT_PATHS = Object.freeze([
  'package/scripts/auto-setup.js',
  'package/scripts/lib/cli-runtime.js',
  'package/scripts/lib/postinstall-db-init.js',
]);

const ALLOWED = new Set(ALLOWED_PACKAGE_SCRIPT_PATHS);

/**
 * @param {Iterable<string>} paths tarball entry paths
 * @returns {string[]} sorted unique violating file paths under package/scripts/
 */
export function findDisallowedScriptPaths(paths) {
  /** @type {Set<string>} */
  const bad = new Set();
  for (const raw of paths) {
    if (typeof raw !== 'string') continue;
    const p = raw.replace(/\\/g, '/');
    if (!p.startsWith('package/scripts/')) continue;
    if (p.endsWith('/')) continue;
    if (p.endsWith('.ts') || !ALLOWED.has(p)) {
      bad.add(p);
    }
  }
  return [...bad].sort();
}
