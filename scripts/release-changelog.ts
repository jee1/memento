#!/usr/bin/env node
/**
 * CHANGELOG 조각을 새 버전 절로 합친다 (#1780)
 *
 * `changelog.d/*.md` 조각과 `CHANGELOG.md` 의 `[Unreleased]` 에 남은 기존 항목을 `## [버전] - 날짜` 절로 옮기고,
 * 합친 조각을 지운다. 릴리스 준비 PR 에서 한 번 돌린다 (docs/operations/ko/github-release-workflow.md §4).
 *
 * 사용법:
 *   npx tsx scripts/release-changelog.ts --version 2.4.0 [--date 2026-11-23] [--dry-run]
 *   npx tsx scripts/release-changelog.ts --check          # 조각 형식만 검사한다 (아무것도 쓰지 않는다)
 *
 * 조각의 형식이 하나라도 틀리면 아무것도 쓰지 않고 실패한다.
 */
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain, parseArgs as parseCliArgs } from './lib/cli.js';
import {
  FRAGMENT_DIR,
  isFragmentFileName,
  mergeIntoRelease,
  parseFragment,
  type Fragment,
  type FragmentProblem,
} from './lib/changelog-fragments.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** `changelog.d/` 의 조각을 모두 읽는다. 형식 문제는 모아서 돌려준다. */
export function readFragments(root: string): { fragments: Fragment[]; problems: FragmentProblem[] } {
  const dir = join(root, FRAGMENT_DIR);
  if (!existsSync(dir)) return { fragments: [], problems: [] };
  const fragments: Fragment[] = [];
  const problems: FragmentProblem[] = [];
  for (const name of readdirSync(dir).filter(isFragmentFileName).sort()) {
    const parsed = parseFragment(name, readFileSync(join(dir, name), 'utf-8'));
    problems.push(...parsed.problems);
    if (parsed.fragment) fragments.push(parsed.fragment);
  }
  return { fragments, problems };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function main(): void {
  const { values } = parseCliArgs({
    options: {
      version: { type: 'string' },
      date: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
    },
  });

  const { fragments, problems } = readFragments(REPO_ROOT);
  if (problems.length > 0) {
    console.error(`조각 형식 문제 ${problems.length}건:`);
    for (const p of problems) console.error(`  ${FRAGMENT_DIR}/${p.file}: ${p.message}`);
    process.exit(1);
  }
  if (values.check) {
    console.log(`조각 ${fragments.length}개, 형식 문제 없음`);
    process.exit(0);
  }

  const version = values.version ? String(values.version) : '';
  if (!version) {
    console.error('--version <x.y.z> 가 필요하다');
    process.exit(1);
  }
  const date = values.date ? String(values.date) : today();

  const changelogPath = join(REPO_ROOT, 'CHANGELOG.md');
  const result = mergeIntoRelease(readFileSync(changelogPath, 'utf-8'), fragments, version, date);
  console.log(`## [${version}] - ${date}: 항목 ${result.entryCount}개 (조각 ${result.consumed.length}개)`);
  for (const file of result.consumed) console.log(`  ${FRAGMENT_DIR}/${file}`);

  if (values['dry-run']) {
    console.log('(--dry-run: 아무것도 쓰지 않았다)');
    process.exit(0);
  }
  if (result.entryCount === 0) {
    console.error('합칠 항목이 없다: 조각도 `[Unreleased]` 항목도 없다');
    process.exit(1);
  }

  // CHANGELOG 를 먼저 쓰고 조각을 지운다. 중간에 멈춰도 항목이 사라지지 않는다(같은 항목은 다시 합쳐도 한 번만 들어간다).
  writeFileSync(changelogPath, result.changelog, 'utf-8');
  for (const file of result.consumed) unlinkSync(join(REPO_ROOT, FRAGMENT_DIR, file));
  console.log('CHANGELOG.md 를 갱신하고 합친 조각을 지웠다');
}

if (isMain(import.meta.url)) {
  main();
}
