/**
 * #942 — accepted audit allowlist load, compare, and docs sync.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const REPO_ROOT = process.cwd();

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

function validAuditReport(
  vulnerabilities: Record<
    string,
    {
      name: string;
      severity: string;
      fixAvailable: boolean | { name: string; version: string; isSemVerMajor: boolean };
      via?: unknown[];
      effects?: unknown[];
      range?: string;
      nodes?: unknown[];
      isDirect?: boolean;
    }
  >,
) {
  const high = Object.values(vulnerabilities).filter((v) => v.severity === 'high').length;
  return {
    auditReportVersion: 2,
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high,
        critical: 0,
        total: Object.keys(vulnerabilities).length,
      },
    },
    vulnerabilities,
  };
}

const LEGACY_ACCEPTED = {
  '@huggingface/transformers': {
    name: '@huggingface/transformers',
    severity: 'high',
    fixAvailable: false,
    via: [],
    effects: [],
    range: '*',
    nodes: [],
    isDirect: true,
  },
  'adm-zip': {
    name: 'adm-zip',
    severity: 'high',
    fixAvailable: false,
    via: [],
    effects: [],
    range: '*',
    nodes: [],
    isDirect: false,
  },
  'onnxruntime-node': {
    name: 'onnxruntime-node',
    severity: 'high',
    fixAvailable: false,
    via: [],
    effects: [],
    range: '*',
    nodes: [],
    isDirect: false,
  },
  sharp: {
    name: 'sharp',
    severity: 'high',
    fixAvailable: false,
    via: [],
    effects: [],
    range: '*',
    nodes: [],
    isDirect: true,
  },
};

describe('loadAcceptedAuditAllowlist (#942)', () => {
  it('loads the repository allowlist (empty since #989)', async () => {
    const { loadAcceptedAuditAllowlist } = await import('./accepted-audit-allowlist.js');
    const set = loadAcceptedAuditAllowlist();
    expect([...set]).toEqual([]);
  });

  it('throws fail-closed on missing file / bad packages / non-string entries', async () => {
    const { loadAcceptedAuditAllowlist } = await import('./accepted-audit-allowlist.js');
    const dir = mkdtempSync(join(tmpdir(), 'accepted-audit-'));
    tempDirs.push(dir);

    expect(() =>
      loadAcceptedAuditAllowlist(pathToFileURL(join(dir, 'missing.json'))),
    ).toThrow(/Failed to read|ENOENT|no such file/i);

    const noPackages = join(dir, 'no-packages.json');
    writeFileSync(noPackages, JSON.stringify({ note: 'x' }));
    expect(() => loadAcceptedAuditAllowlist(pathToFileURL(noPackages))).toThrow(
      /packages must be an array/i,
    );

    const badEntry = join(dir, 'bad-entry.json');
    writeFileSync(badEntry, JSON.stringify({ packages: ['sharp', 1] }));
    expect(() => loadAcceptedAuditAllowlist(pathToFileURL(badEntry))).toThrow(
      /non-empty strings/i,
    );
  });
});

describe('findUnlistedAccepted (#942)', () => {
  it('returns only names missing from the allowlist, deduped and sorted', async () => {
    const { findUnlistedAccepted } = await import('./accepted-audit-allowlist.js');
    // Literal Set — repo JSON must not leak into pure-function tests; allowlist changes
    // should not force unrelated expectation updates here (#989 T3).
    const allowlist = new Set(['sharp']);
    const unlisted = findUnlistedAccepted(
      [
        { name: 'left-pad', severity: 'high' },
        { name: 'sharp', severity: 'high' },
        { name: 'left-pad', severity: 'high' },
        { name: 'zzz-pkg', severity: 'critical' },
      ],
      allowlist,
    );
    expect(unlisted.map((v) => v.name)).toEqual(['left-pad', 'zzz-pkg']);
  });
});

describe('findStaleAllowlistEntries (#942)', () => {
  it('returns all allowlisted names when audit reports none; empty when all present', async () => {
    const { findStaleAllowlistEntries } = await import('./accepted-audit-allowlist.js');
    // Literal Set — stale detection logic should be tested in isolation from repo state (#989 T3).
    const allowlist = new Set(['alpha', 'beta']);
    expect(findStaleAllowlistEntries([], allowlist)).toEqual(['alpha', 'beta']);
    expect(
      findStaleAllowlistEntries(
        ['alpha', 'beta'].map((name) => ({ name })),
        allowlist,
      ),
    ).toEqual([]);
  });
});

describe('extractDocumentedAcceptedPackages (#942)', () => {
  it('collects all first-column backticks and stops before a second table', async () => {
    const { extractDocumentedAcceptedPackages } = await import(
      './accepted-audit-allowlist.js'
    );
    const md = `
## Upstream-blocked

| Package path | Advisory |
|--------------|----------|
| \`adm-zip\` ← \`onnxruntime-node\` ← \`@huggingface/transformers\` | GHSA-1 |
| \`sharp\` ← \`@huggingface/transformers\` | GHSA-2 |

- next section

| 패키지 (경로) | 취약점 |
|---------------|--------|
| \`should-not-appear\` | x |
`;
    expect([...extractDocumentedAcceptedPackages(md)].sort()).toEqual(
      [
        '@huggingface/transformers',
        'adm-zip',
        'onnxruntime-node',
        'sharp',
      ].sort(),
    );
  });

  it('throws when the Package path header is missing', async () => {
    const { extractDocumentedAcceptedPackages } = await import(
      './accepted-audit-allowlist.js'
    );
    expect(() => extractDocumentedAcceptedPackages('# no table\n')).toThrow(
      /Package path/i,
    );
  });
});

describe('accepted-audit allowlist ↔ docs sync (#942)', () => {
  it('JSON packages equal Upstream-blocked table tokens in ko and en docs', async () => {
    const { extractDocumentedAcceptedPackages, loadAcceptedAuditAllowlist } =
      await import('./accepted-audit-allowlist.js');
    const allowlist = loadAcceptedAuditAllowlist();
    const allowlistSet = new Set(allowlist);

    for (const rel of [
      'docs/reference/ko/security.md',
      'docs/reference/en/security.md',
    ]) {
      const md = readFileSync(join(REPO_ROOT, rel), 'utf8');
      const documented = extractDocumentedAcceptedPackages(md);
      const onlyInJson = [...allowlistSet].filter((p) => !documented.has(p)).sort();
      const onlyInDocs = [...documented].filter((p) => !allowlistSet.has(p)).sort();
      expect(
        { onlyInJson, onlyInDocs },
        `${rel}: 작성 누락=${onlyInJson.join(',') || '(없음)'}; 문서 누락=${onlyInDocs.join(',') || '(없음)'}`,
      ).toEqual({ onlyInJson: [], onlyInDocs: [] });
    }
  });
});

describe('check-production-audit-fixable end-to-end (#942)', () => {
  function runGate(args: string[]) {
    return spawnSync(process.execPath, ['scripts/check-production-audit-fixable.mjs', ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, NODE_ENV: 'test' },
      encoding: 'utf8',
      timeout: 30_000,
    });
  }

  it('exits 0 when no vulnerabilities remain (#989)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'audit-e2e-'));
    tempDirs.push(dir);
    const file = join(dir, 'ok.json');
    writeFileSync(file, JSON.stringify(validAuditReport({})));
    const result = runGate([file]);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it('exits 1 when an unlisted upstream-blocked finding appears (both lanes)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'audit-e2e-'));
    tempDirs.push(dir);
    const file = join(dir, 'unlisted.json');
    writeFileSync(
      file,
      JSON.stringify(
        validAuditReport({
          ...LEGACY_ACCEPTED,
          'left-pad': {
            name: 'left-pad',
            severity: 'high',
            fixAvailable: false,
            via: [],
            effects: [],
            range: '*',
            nodes: [],
            isDirect: false,
          },
        }),
      ),
    );

    for (const extra of [[], ['--include-dev']]) {
      const result = runGate([...extra, file]);
      const combined = `${result.stdout}\n${result.stderr}`;
      expect(result.status, combined).toBe(1);
      expect(combined).toMatch(/not in security\/accepted-audit\.json/);
      expect(combined).toContain('left-pad');
    }
  });

  // #942 review Finding 1: dev-lane major-only (`isSemVerMajor: true`) must
  // classify as accepted and hit the allowlist gate — boolean-only fixtures
  // leave this path untested.
  it('exits 1 on --include-dev when major-only High is not allowlisted (#989)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'audit-e2e-'));
    tempDirs.push(dir);
    const file = join(dir, 'major-unlisted.json');
    writeFileSync(
      file,
      JSON.stringify(
        validAuditReport({
          sharp: {
            name: 'sharp',
            severity: 'high',
            fixAvailable: {
              name: 'sharp',
              version: '0.35.0',
              isSemVerMajor: true,
            },
            via: [],
            effects: [],
            range: '*',
            nodes: [],
            isDirect: true,
          },
        }),
      ),
    );
    const result = runGate(['--include-dev', file]);
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(result.status, combined).toBe(1);
    expect(combined).toMatch(/not in security\/accepted-audit\.json/);
    expect(combined).toContain('sharp');
  });

  it('exits 1 on --include-dev when major-only High is not in the allowlist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'audit-e2e-'));
    tempDirs.push(dir);
    const file = join(dir, 'major-unlisted.json');
    writeFileSync(
      file,
      JSON.stringify(
        validAuditReport({
          ...LEGACY_ACCEPTED,
          'left-pad': {
            name: 'left-pad',
            severity: 'high',
            fixAvailable: {
              name: 'left-pad',
              version: '2.0.0',
              isSemVerMajor: true,
            },
            via: [],
            effects: [],
            range: '*',
            nodes: [],
            isDirect: false,
          },
        }),
      ),
    );
    const result = runGate(['--include-dev', file]);
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(result.status, combined).toBe(1);
    expect(combined).toMatch(/not in security\/accepted-audit\.json/);
    expect(combined).toContain('left-pad');
  });
});
