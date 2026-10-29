#!/usr/bin/env node
/**
 * 세 package manifest version 동기화 검사 (Issue #1077) + CHANGELOG 게이트 (Issue #1116, #1489)
 *
 * 루트·memento-core·memento-server 매니페스트의 version 이 어긋나면
 * 배포 레이아웃에 따라 서버가 서로 다른 버전을 보고한다.
 *
 * 사용법:
 *   npx tsx scripts/check-version-sync.ts [--ci] [--base <base>] [--head <head>] [--title "<title>"] [--labels "<labels>"]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain, parseArgs as parseCliArgs } from './lib/cli.js';

export const MANIFEST_PATHS = [
  'package.json',
  'packages/memento-core/package.json',
  'packages/memento-server/package.json',
  'plugins/memento/.mcp.json',
] as const;

export interface ManifestVersion {
  file: string;
  version: string;
}

export interface CheckResult {
  manifests: ManifestVersion[];
  violations: ManifestVersion[];
}

// 저장소 루트는 스크립트 위치에서 유도한다. cwd 에 의존하지 않아야
// CI 든 로컬이든 보고 경로가 같은 기준을 쓴다.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function readManifestVersion(root: string, relativePath: string): string {
  const path = join(root, relativePath);
  if (!existsSync(path)) {
    throw new Error(`${relativePath}: 파일을 찾을 수 없습니다.`);
  }
  const raw = readFileSync(path, 'utf-8');
  const data = JSON.parse(raw) as Record<string, unknown>;

  if (relativePath.endsWith('.mcp.json')) {
    const mcpServers = data.mcpServers as Record<string, { args?: unknown[] }> | undefined;
    const mementoServer = mcpServers?.memento;
    const args = Array.isArray(mementoServer?.args) ? mementoServer.args : [];
    for (const arg of args) {
      if (typeof arg === 'string') {
        const match = arg.match(/^memento-mcp-server@(.+)$/);
        if (match) {
          return match[1];
        }
      }
    }
    throw new Error(`${relativePath}: memento-mcp-server@<version> 인자를 찾을 수 없습니다.`);
  }

  if (typeof data.version !== 'string' || data.version.trim() === '') {
    throw new Error(`${relativePath}: version 필드가 없거나 비어 있습니다.`);
  }
  return data.version;
}

export function checkVersionSync(
  root: string,
  manifestPaths: readonly string[] = MANIFEST_PATHS,
): CheckResult {
  const manifests: ManifestVersion[] = manifestPaths.map((file) => ({
    file,
    version: readManifestVersion(root, file),
  }));

  const versions = new Set(manifests.map((entry) => entry.version));
  const violations = versions.size <= 1 ? [] : manifests;

  return { manifests, violations };
}

export type ChangelogSkipReason = 'no-tag' | 'release-prep' | 'no-commits';

export interface ChangelogGateInput {
  changelog: string;
  packageVersion: string;
  /** `git describe --tags --abbrev=0`. 태그를 못 찾으면 null. */
  lastTag: string | null;
  commitsSinceTag: number;
}

export interface ChangelogGateResult {
  entryCount: number;
  skipReason: ChangelogSkipReason | null;
  violated: boolean;
}

const CHANGELOG_SKIP_MESSAGES: Record<ChangelogSkipReason, string> = {
  'no-tag': '직전 태그를 찾을 수 없다 (얕은 체크아웃).',
  'release-prep': '매니페스트 버전이 직전 태그보다 앞서 있다 — 릴리스 준비 중.',
  'no-commits': '직전 태그 이후 커밋이 없다.',
};

/** `## [Unreleased]` 절의 목록 항목만 센다. 다음 버전 절에서 멈춘다. */
export function countUnreleasedEntries(changelog: string): number {
  let inSection = false;
  let count = 0;
  for (const line of changelog.split('\n')) {
    if (/^## \[Unreleased\]/.test(line)) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (/^## \[/.test(line)) break;
    if (/^\s*-\s/.test(line)) count += 1;
  }
  return count;
}

export function checkChangelogGate(input: ChangelogGateInput): ChangelogGateResult {
  const entryCount = countUnreleasedEntries(input.changelog);
  if (input.lastTag === null || input.lastTag === '') {
    return { entryCount, skipReason: 'no-tag', violated: false };
  }
  // 태그 표기가 `1.32.0` 과 `v1.7.3` 로 섞여 있다.
  if (input.lastTag.replace(/^v/, '') !== input.packageVersion) {
    return { entryCount, skipReason: 'release-prep', violated: false };
  }
  if (input.commitsSinceTag <= 0) {
    return { entryCount, skipReason: 'no-commits', violated: false };
  }
  return { entryCount, skipReason: null, violated: entryCount === 0 };
}

export const USER_FACING_PATTERNS: readonly RegExp[] = [
  /^packages\/[^/]+\/src\//,
  /^static\//,
  /^apps\/[^/]+\/src\//,
] as const;

export const EXEMPT_PR_TYPES = ['test', 'docs', 'chore', 'style', 'ci'] as const;
export const NO_CHANGELOG_LABEL = 'no-changelog';

export function isUserFacingPath(filePath: string): boolean {
  return USER_FACING_PATTERNS.some((pattern) => pattern.test(filePath));
}

export function isExemptPrTitle(title: string): boolean {
  if (!title) return false;
  const match = title.trim().match(/^([a-z]+)(?:\([^)]+\))?!?:/i);
  if (!match) return false;
  const type = match[1].toLowerCase();
  return (EXEMPT_PR_TYPES as readonly string[]).includes(type);
}

export function hasNoChangelogLabel(labels: readonly string[] = []): boolean {
  return labels.some((l) => l.trim().toLowerCase() === NO_CHANGELOG_LABEL);
}

export function extractUnreleasedSection(changelog: string): string {
  let inSection = false;
  const lines: string[] = [];
  for (const line of changelog.split('\n')) {
    if (/^## \[Unreleased\]/i.test(line)) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (/^## \[/.test(line)) break;
    lines.push(line);
  }
  return lines.join('\n');
}

export function isUnreleasedSectionUpdated(baseChangelog: string, headChangelog: string): boolean {
  const baseSection = extractUnreleasedSection(baseChangelog).trim();
  const headSection = extractUnreleasedSection(headChangelog).trim();
  return baseSection !== headSection;
}

export type PrChangelogSkipReason =
  | 'no-user-facing-changes'
  | 'exempt-title'
  | 'exempt-label';

export interface PrChangelogGateInput {
  changedFiles: readonly string[];
  title?: string;
  labels?: readonly string[];
  baseChangelog?: string | null;
  headChangelog?: string | null;
}

export interface PrChangelogGateResult {
  violated: boolean;
  userFacingFiles: string[];
  skipReason: PrChangelogSkipReason | null;
  reason?: string;
}

const PR_SKIP_MESSAGES: Record<PrChangelogSkipReason, string> = {
  'no-user-facing-changes': '사용자에게 닿는 경로 변경 없음.',
  'exempt-title': '예외 제목 타입 (test, docs, chore, style, ci).',
  'exempt-label': 'no-changelog 라벨 지정됨.',
};

export function checkPrChangelogGate(input: PrChangelogGateInput): PrChangelogGateResult {
  const userFacingFiles = input.changedFiles.filter(isUserFacingPath);
  if (userFacingFiles.length === 0) {
    return {
      violated: false,
      userFacingFiles: [],
      skipReason: 'no-user-facing-changes',
    };
  }

  const labels = input.labels ?? [];
  if (hasNoChangelogLabel(labels)) {
    return {
      violated: false,
      userFacingFiles,
      skipReason: 'exempt-label',
    };
  }

  const title = input.title ?? '';
  if (isExemptPrTitle(title)) {
    return {
      violated: false,
      userFacingFiles,
      skipReason: 'exempt-title',
    };
  }

  const hasChangelogInDiff = input.changedFiles.includes('CHANGELOG.md');
  if (!hasChangelogInDiff) {
    return {
      violated: true,
      userFacingFiles,
      skipReason: null,
      reason: '사용자 영향 경로가 바뀌었으나 CHANGELOG.md 가 수정되지 않았습니다.',
    };
  }

  if (input.baseChangelog !== undefined && input.baseChangelog !== null && input.headChangelog !== undefined && input.headChangelog !== null) {
    const updated = isUnreleasedSectionUpdated(input.baseChangelog, input.headChangelog);
    if (!updated) {
      return {
        violated: true,
        userFacingFiles,
        skipReason: null,
        reason: 'CHANGELOG.md 가 수정되었으나 [Unreleased] 절 내용에 변경이 없습니다.',
      };
    }
  }

  return {
    violated: false,
    userFacingFiles,
    skipReason: null,
  };
}

export function readPrGitFacts(
  root: string,
  base: string,
  head: string = 'HEAD',
): {
  changedFiles: string[];
  baseChangelog: string | null;
  headChangelog: string | null;
} {
  try {
    const output = execFileSync(
      'git',
      ['diff', '--name-only', '--no-renames', `${base}...${head}`],
      {
        cwd: root,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    const changedFiles = output
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f.length > 0);

    let baseChangelog: string | null = null;
    try {
      baseChangelog = execFileSync('git', ['show', `${base}:CHANGELOG.md`], {
        cwd: root,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      baseChangelog = null;
    }

    let headChangelog: string | null = null;
    const changelogPath = join(root, 'CHANGELOG.md');
    if (existsSync(changelogPath)) {
      headChangelog = readFileSync(changelogPath, 'utf-8');
    }

    return { changedFiles, baseChangelog, headChangelog };
  } catch {
    return { changedFiles: [], baseChangelog: null, headChangelog: null };
  }
}

function readGitFacts(root: string): { lastTag: string | null; commitsSinceTag: number } {
  try {
    const lastTag = execFileSync('git', ['describe', '--tags', '--abbrev=0'], {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (lastTag === '') return { lastTag: null, commitsSinceTag: 0 };
    const commits = execFileSync('git', ['rev-list', '--count', `${lastTag}..HEAD`], {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return { lastTag, commitsSinceTag: Number.parseInt(commits, 10) || 0 };
  } catch {
    return { lastTag: null, commitsSinceTag: 0 };
  }
}

function printVersionReport(result: CheckResult): void {
  console.log(`버전 동기화 검사 - 대상 ${result.manifests.length}건\n`);
  for (const entry of result.manifests) {
    console.log(`  ${entry.file}: ${entry.version}`);
  }
  console.log(`\n위반 ${result.violations.length}건`);
  if (result.violations.length > 0) {
    console.log(
      '매니페스트와 플러그인 설정의 version 이 어긋나면 배포 레이아웃에 따라 서버가 서로 다른 버전을 보고한다 (#1077).',
    );
    for (const violation of result.violations) {
      console.log(`  ${violation.file}: ${violation.version}`);
    }
  }
}

function printChangelogReport(gate: ChangelogGateResult): void {
  console.log(`\nCHANGELOG [Unreleased] 항목 ${gate.entryCount}건`);
  if (gate.skipReason !== null) {
    console.log(`  게이트 생략 - ${CHANGELOG_SKIP_MESSAGES[gate.skipReason]}`);
  } else if (gate.violated) {
    console.log(
      '  직전 태그 이후 커밋이 있는데 [Unreleased] 가 비어 있다. 이대로 릴리스를 끊으면 노트가 없다 (#1116).',
    );
  }
}

function printPrChangelogReport(prGate: PrChangelogGateResult): void {
  console.log(`\nPR 단위 CHANGELOG 검사 (#1489)`);
  if (prGate.skipReason !== null) {
    console.log(`  게이트 생략 - ${PR_SKIP_MESSAGES[prGate.skipReason]}`);
  } else if (prGate.violated) {
    console.log(`  위반: ${prGate.reason}`);
    console.log(`  사용자 영향 경로 변경 (${prGate.userFacingFiles.length}건):`);
    for (const file of prGate.userFacingFiles.slice(0, 10)) {
      console.log(`    - ${file}`);
    }
    if (prGate.userFacingFiles.length > 10) {
      console.log(`    ... 외 ${prGate.userFacingFiles.length - 10}건`);
    }
  } else {
    console.log(`  통과 (사용자 영향 경로 변경 ${prGate.userFacingFiles.length}건 반영 확인)`);
  }
}

function main(): void {
  const { values } = parseCliArgs({
    options: {
      ci: { type: 'boolean', default: false },
      base: { type: 'string' },
      head: { type: 'string' },
      title: { type: 'string' },
      labels: { type: 'string' },
    },
  });
  const ci = Boolean(values.ci);
  const base = values.base ? String(values.base) : (process.env.PR_BASE || '');
  const head = values.head ? String(values.head) : (process.env.PR_HEAD || 'HEAD');
  const title = values.title !== undefined ? String(values.title) : (process.env.PR_TITLE || '');
  const labelsRaw = values.labels !== undefined ? String(values.labels) : (process.env.PR_LABELS || '');
  const labels = labelsRaw
    ? labelsRaw.split(',').map((l) => l.trim()).filter((l) => l.length > 0)
    : [];

  let result: CheckResult;
  let readError: string | null = null;
  try {
    result = checkVersionSync(REPO_ROOT);
  } catch (error) {
    readError = error instanceof Error ? error.message : String(error);
    console.error(readError);
    if (ci) process.exit(1);
    process.exit(0);
  }

  printVersionReport(result);

  const gate = checkChangelogGate({
    changelog: readFileSync(join(REPO_ROOT, 'CHANGELOG.md'), 'utf-8'),
    packageVersion: result.manifests[0].version,
    ...readGitFacts(REPO_ROOT),
  });
  printChangelogReport(gate);

  let prGate: PrChangelogGateResult | null = null;
  if (base) {
    const gitFacts = readPrGitFacts(REPO_ROOT, base, head);
    prGate = checkPrChangelogGate({
      changedFiles: gitFacts.changedFiles,
      title,
      labels,
      baseChangelog: gitFacts.baseChangelog,
      headChangelog: gitFacts.headChangelog,
    });
    printPrChangelogReport(prGate);
  }

  const violated = result.violations.length > 0 || gate.violated || (prGate?.violated ?? false);
  console.log(!violated && !readError ? '\nOK' : '\n위반이 확인되었습니다.');

  if (ci && violated) process.exit(1);
  process.exit(0);
}

if (isMain(import.meta.url)) {
  main();
}
