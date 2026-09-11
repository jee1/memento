/**
 * #942 — accepted (upstream-blocked) audit allowlist helpers.
 * Pure functions for check-production-audit-fixable.mjs and sync specs.
 */

import { readFileSync } from 'node:fs';

/**
 * @param {URL | string} [url]
 * @returns {Set<string>}
 */
export function loadAcceptedAuditAllowlist(url) {
  const target =
    url ?? new URL('../../security/accepted-audit.json', import.meta.url);
  let raw;
  try {
    raw = readFileSync(target, 'utf8');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read accepted audit allowlist: ${detail}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid accepted audit allowlist JSON: ${detail}`);
  }

  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    !Array.isArray(/** @type {Record<string, unknown>} */ (parsed).packages)
  ) {
    throw new Error(
      'Invalid accepted audit allowlist: packages must be an array',
    );
  }

  const packages = /** @type {unknown[]} */ (
    /** @type {Record<string, unknown>} */ (parsed).packages
  );
  for (const entry of packages) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new Error(
        'Invalid accepted audit allowlist: packages entries must be non-empty strings',
      );
    }
  }

  return new Set(/** @type {string[]} */ (packages));
}

/**
 * @param {Array<{ name: string, severity?: string }>} accepted
 * @param {Set<string>} allowlist
 * @returns {Array<{ name: string, severity?: string }>}
 */
export function findUnlistedAccepted(accepted, allowlist) {
  /** @type {Map<string, { name: string, severity?: string }>} */
  const byName = new Map();
  for (const item of accepted) {
    if (!allowlist.has(item.name) && !byName.has(item.name)) {
      byName.set(item.name, item);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {Array<{ name: string }>} accepted
 * @param {Set<string>} allowlist
 * @returns {string[]}
 */
export function findStaleAllowlistEntries(accepted, allowlist) {
  const reported = new Set(accepted.map((v) => v.name));
  return [...allowlist].filter((name) => !reported.has(name)).sort();
}

/**
 * Extract package tokens from the Upstream-blocked table first column
 * (cells may contain multiple `` `pkg` `` tokens in a dependency path).
 *
 * @param {string} markdown
 * @returns {Set<string>}
 */
export function extractDocumentedAcceptedPackages(markdown) {
  const lines = markdown.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) =>
    /^\|\s*Package path\s*\|/.test(line),
  );
  if (headerIndex < 0) {
    throw new Error(
      'Upstream-blocked table header "| Package path |" not found',
    );
  }

  /** @type {Set<string>} */
  const packages = new Set();
  // headerIndex + 1 is the separator row (|---|); data starts after that.
  for (let i = headerIndex + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('|')) {
      break;
    }
    const cell = line.split('|')[1] ?? '';
    for (const match of cell.matchAll(/`([^`]+)`/g)) {
      packages.add(match[1]);
    }
  }
  return packages;
}
