#!/usr/bin/env node
/**
 * 세 package manifest version 동기화 검사 (Issue #1077)
 *
 * 루트·memento-core·memento-server 매니페스트의 version 이 어긋나면
 * 배포 레이아웃에 따라 서버가 서로 다른 버전을 보고한다.
 *
 * 사용법:
 *   npx tsx scripts/check-version-sync.ts [--ci]
 */
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
  console.log(result.violations.length === 0 && !readError ? '\nOK' : '\n위반이 있습니다.');

  if (ci && result.violations.length > 0) process.exit(1);
  process.exit(0);
}

if (isMain(import.meta.url)) {
  main();
}
