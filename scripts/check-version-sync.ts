#!/usr/bin/env node
/**
 * 세 package manifest version 동기화 검사 (Issue #1077) + CHANGELOG 게이트 (Issue #1116)
 *
 * 루트·memento-core·memento-server 매니페스트의 version 이 어긋나면
 * 배포 레이아웃에 따라 서버가 서로 다른 버전을 보고한다.
 *
 * 사용법:
 *   npx tsx scripts/check-version-sync.ts [--ci]
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
  const data = JSON.parse(readFileSync(path, 'utf-8')) as { version?: unknown };
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

function main(): void {
  const { values } = parseCliArgs({
    options: {
      ci: { type: 'boolean', default: false },
    },
  });
  const ci = Boolean(values.ci);

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

  console.log(`버전 동기화 검사 - manifest ${result.manifests.length}건\n`);
  for (const entry of result.manifests) {
    console.log(`  ${entry.file}: ${entry.version}`);
  }
  console.log(`\n위반 ${result.violations.length}건`);
  if (result.violations.length > 0) {
    console.log(
      '세 매니페스트의 version 이 어긋나면 배포 레이아웃에 따라 서버가 서로 다른 버전을 보고한다 (#1077).',
    );
    for (const violation of result.violations) {
      console.log(`  ${violation.file}: ${violation.version}`);
    }
  }
  const gate = checkChangelogGate({
    changelog: readFileSync(join(REPO_ROOT, 'CHANGELOG.md'), 'utf-8'),
    packageVersion: result.manifests[0].version,
    ...readGitFacts(REPO_ROOT),
  });

  console.log(`\nCHANGELOG [Unreleased] 항목 ${gate.entryCount}건`);
  if (gate.skipReason !== null) {
    console.log(`  게이트 생략 - ${CHANGELOG_SKIP_MESSAGES[gate.skipReason]}`);
  } else if (gate.violated) {
    console.log(
      '  직전 태그 이후 커밋이 있는데 [Unreleased] 가 비어 있다. 이대로 릴리스를 끊으면 노트가 없다 (#1116).',
    );
  }

  const violated = result.violations.length > 0 || gate.violated;
  console.log(!violated && !readError ? '\nOK' : '\n위반이 있습니다.');

  if (ci && violated) process.exit(1);
  process.exit(0);
}

if (isMain(import.meta.url)) {
  main();
}
