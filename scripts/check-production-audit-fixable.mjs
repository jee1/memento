#!/usr/bin/env node
import { parseArgs as parseCliArgs } from './lib/cli-runtime.js';
/**
 * Production dependency audit gate (#756 / #925).
 *
 * Runs `npm audit --omit=dev --json` and fails when any High/Moderate/Critical
 * vulnerability still has a fix available (wanted-range / audit-fixable).
 *
 * Fail-closed (#925): audit service error JSON, missing report schema,
 * spawn/parse failures exit non-zero. Valid schema + npm exit≠0 (vulns present)
 * still uses classification below — do not fail on status alone.
 *
 * Upstream-blocked ML transitive deps (no fix without force-override) are
 * logged as accepted — see docs/reference/{ko,en}/security.md. Do not add
 * npm overrides for onnxruntime-node / sharp / adm-zip.
 *
 * Usage:
 *   node scripts/check-production-audit-fixable.mjs
 *   node scripts/check-production-audit-fixable.mjs /path/to/audit.json
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { assertValidProductionAuditReport } from './lib/production-audit-report.js';

const FAIL_SEVERITIES = new Set(['critical', 'high', 'moderate']);

function failLoad(message, detail) {
  console.error(message);
  if (detail) {
    console.error(detail);
  }
  process.exit(1);
}

function loadReport() {
  const argPath = parseCliArgs().args[0];
  if (argPath) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(argPath, 'utf8'));
    } catch (err) {
      failLoad(
        `Failed to parse audit JSON file: ${argPath}`,
        err instanceof Error ? err.message : String(err),
      );
    }
    try {
      assertValidProductionAuditReport(parsed);
    } catch (err) {
      failLoad(err instanceof Error ? err.message : String(err));
    }
    return parsed;
  }

  const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result.error) {
    failLoad(
      'Failed to run `npm audit --omit=dev --json`.',
      result.error.message || String(result.error),
    );
  }

  const stdout = result.stdout || '';
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    console.error('Failed to parse `npm audit --omit=dev --json` output.');
    if (result.stderr) {
      console.error(result.stderr);
    }
    console.error(stdout.slice(0, 2000));
    process.exit(1);
  }

  try {
    assertValidProductionAuditReport(parsed);
  } catch (err) {
    failLoad(
      err instanceof Error ? err.message : String(err),
      result.stderr ? result.stderr.slice(0, 2000) : undefined,
    );
  }

  // FR-005: npm exits non-zero when advisories exist; schema already validated.
  return parsed;
}

const report = loadReport();
const vulns = Object.values(report.vulnerabilities);
const fixable = vulns.filter(
  (v) => v.fixAvailable && FAIL_SEVERITIES.has(v.severity),
);
const accepted = vulns.filter(
  (v) => !v.fixAvailable && FAIL_SEVERITIES.has(v.severity),
);

console.log(
  'Production audit (--omit=dev) counts:',
  report.metadata?.vulnerabilities ?? '(no metadata)',
);

if (accepted.length > 0) {
  console.log(
    'Accepted upstream-blocked (documented; no force-override):',
  );
  for (const v of accepted) {
    console.log(`  - ${v.name} (${v.severity}, fixAvailable=false)`);
  }
}

if (fixable.length > 0) {
  console.error(
    'FAIL: fixable High/Moderate/Critical production vulnerabilities remain:',
  );
  for (const v of fixable) {
    const via = Array.isArray(v.via)
      ? v.via
          .map((item) => (typeof item === 'string' ? item : item?.url || item?.title))
          .filter(Boolean)
          .join(', ')
      : '';
    console.error(`  - ${v.name} (${v.severity})${via ? ` via ${via}` : ''}`);
  }
  process.exit(1);
}

console.log('OK: no fixable High/Moderate/Critical production vulnerabilities');
process.exit(0);
