#!/usr/bin/env node
import { parseArgs as parseCliArgs } from './lib/cli-runtime.js';
/**
 * Production dependency audit gate (#756 / #925).
 *
 * Runs `npm audit --omit=dev --json` and fails when any High/Moderate/Critical
 * vulnerability still has a fix available (wanted-range / audit-fixable).
 *
 * `--include-dev` (#909): audits the full tree (dev included). That lane gates
 * High/Critical only and ignores fixes that need a semver-major bump, because
 * AGENTS.md pins deps to wanted (minor/patch) ranges — vitest 4→5 is a separate
 * issue, not a security gate failure. The production lane is unchanged.
 *
 * Fail-closed (#925): audit service error JSON, missing report schema,
 * spawn/parse failures exit non-zero. Valid schema + npm exit≠0 (vulns present)
 * still uses classification below — do not fail on status alone.
 *
 * Upstream-blocked findings are accepted only when listed in
 * security/accepted-audit.json (#942). Unlisted accepted items fail both
 * lanes. Keep the allowlist in sync with docs/reference/{ko,en}/security.md
 * Upstream-blocked table. Do not add npm overrides for onnxruntime-node /
 * sharp / adm-zip.
 *
 * Usage:
 *   node scripts/check-production-audit-fixable.mjs
 *   node scripts/check-production-audit-fixable.mjs --include-dev
 *   node scripts/check-production-audit-fixable.mjs /path/to/audit.json
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  findStaleAllowlistEntries,
  findUnlistedAccepted,
  loadAcceptedAuditAllowlist,
} from './lib/accepted-audit-allowlist.js';
import { assertValidProductionAuditReport } from './lib/production-audit-report.js';

const PROD_FAIL_SEVERITIES = new Set(['critical', 'high', 'moderate']);
// #909: dev 를 포함한 전체 트리는 high/critical 만 본다. dev moderate(vitest)는
// major 업그레이드가 있어야 풀려서 wanted-only 정책과 충돌한다.
const FULL_TREE_FAIL_SEVERITIES = new Set(['critical', 'high']);

const cli = parseCliArgs({ options: { 'include-dev': { type: 'boolean' } } });
const includeDev = cli.values['include-dev'] === true;
const scope = includeDev ? 'full tree (dev included)' : 'production (--omit=dev)';
const failSeverities = includeDev
  ? FULL_TREE_FAIL_SEVERITIES
  : PROD_FAIL_SEVERITIES;

// prod 레인은 기존 동작(fixAvailable truthy)을 그대로 둔다. dev 포함 레인만
// major-only 수정을 "고칠 수 없음"으로 분류한다.
const isBlocking = includeDev
  ? (v) =>
      v.fixAvailable === true ||
      (typeof v.fixAvailable === 'object' &&
        v.fixAvailable !== null &&
        v.fixAvailable.isSemVerMajor !== true)
  : (v) => Boolean(v.fixAvailable);

function failLoad(message, detail) {
  console.error(message);
  if (detail) {
    console.error(detail);
  }
  process.exit(1);
}

function loadReport() {
  const argPath = cli.positionals[0];
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

  const auditArgs = includeDev
    ? ['audit', '--json']
    : ['audit', '--omit=dev', '--json'];
  const result = spawnSync('npm', auditArgs, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result.error) {
    failLoad(
      `Failed to run \`npm ${auditArgs.join(' ')}\`.`,
      result.error.message || String(result.error),
    );
  }

  const stdout = result.stdout || '';
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    console.error(`Failed to parse \`npm ${auditArgs.join(' ')}\` output.`);
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
const inScope = vulns.filter((v) => failSeverities.has(v.severity));
const fixable = inScope.filter(isBlocking);
const accepted = inScope.filter((v) => !isBlocking(v));

console.log(
  `Audit scope: ${scope}. Counts:`,
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

/** @type {Set<string>} */
let allowlist;
try {
  allowlist = loadAcceptedAuditAllowlist();
} catch (err) {
  failLoad(err instanceof Error ? err.message : String(err));
}

const unlisted = findUnlistedAccepted(accepted, allowlist);
const stale = findStaleAllowlistEntries(accepted, allowlist);

if (stale.length > 0) {
  console.log(
    `Note: allowlisted but no longer reported in ${scope}: ${stale.join(', ')}`,
  );
}

let failed = false;

if (fixable.length > 0) {
  failed = true;
  console.error(
    `FAIL: fixable ${[...failSeverities].join('/')} vulnerabilities remain in ${scope}:`,
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
}

if (unlisted.length > 0) {
  failed = true;
  console.error(
    'FAIL: new upstream-blocked vulnerabilities not in security/accepted-audit.json:',
  );
  for (const v of unlisted) {
    console.error(`  - ${v.name} (${v.severity})`);
  }
  console.error(
    'Document them in docs/reference/{ko,en}/security.md and add them to the allowlist.',
  );
}

if (failed) {
  process.exit(1);
}

console.log(`OK: no wanted-range fixable vulnerabilities in ${scope}`);
process.exit(0);
