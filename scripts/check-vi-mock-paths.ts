#!/usr/bin/env node
/**
 * vi.mock 상대 경로 실재성 검사 (Issue #821)
 *
 * 존재하지 않는 모듈을 가리키는 상대 경로 vi.mock 을 찾아 차단한다.
 * 이런 선언은 같은 경로의 동적 import 까지 함께 가로채기 때문에 실행 중에는
 * 드러나지 않는다 - 스펙은 조용히 전량 통과한다. 정적 스캔이어야만 잡힌다.
 *
 * 이번 범위 밖의 기존 위반은 scripts/vi-mock-path-baseline.json 에 사유·후속
 * 추적과 함께 등재해 통과시킨다. 새 위반만 차단한다.
 *
 * 사용법:
 *   npx tsx scripts/check-vi-mock-paths.ts [--ci] [--format=text|json] [--path=<dir>]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs as parseCliArgs } from './lib/cli.js';

export interface MockRef {
  file: string;
  line: number;
  specifier: string;
}

export interface BaselineEntry {
  file: string;
  specifier: string;
  reason: string;
  followUp: string;
}

export interface ScanResult {
  scanned: number;
  violations: MockRef[];
  baselined: Array<MockRef & BaselineEntry>;
  staleBaseline: BaselineEntry[];
}

const SPEC_FILE = /\.(spec|test)\.tsx?$/;
const SKIP_DIR = new Set(['node_modules', 'dist', '.git', 'coverage', 'graphify-out', 'test-results']);
const VI_MOCK = /vi\.mock\(\s*['"]([^'"]+)['"]/g;
const BASELINE_PATH = 'scripts/vi-mock-path-baseline.json';

export function resolvesToModule(fromDir: string, specifier: string): boolean {
  const base = resolve(fromDir, specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')];
  if (base.endsWith('.js')) {
    const stem = base.slice(0, -3);
    candidates.push(`${stem}.ts`, `${stem}.tsx`);
  }
  return candidates.some((candidate) => existsSync(candidate));
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SPEC_FILE.test(name)) out.push(full);
  }
}

export function collectMockRefs(root: string): MockRef[] {
  const files: string[] = [];
  walk(root, files);
  const refs: MockRef[] = [];
  for (const full of files.sort()) {
    const src = readFileSync(full, 'utf-8');
    for (const match of src.matchAll(VI_MOCK)) {
      const specifier = match[1];
      // 패키지 이름 모킹은 이 게이트의 대상이 아니다 (FR-010)
      if (!specifier.startsWith('.')) continue;
      refs.push({
        file: relative(root, full),
        line: src.slice(0, match.index).split('\n').length,
        specifier,
      });
    }
  }
  return refs;
}

export function validateBaseline(entries: unknown): BaselineEntry[] {
  if (!Array.isArray(entries)) throw new Error('baseline 은 배열이어야 합니다.');
  return entries.map((entry, index) => {
    for (const key of ['file', 'specifier', 'reason', 'followUp'] as const) {
      const value = (entry as Record<string, unknown> | null)?.[key];
      if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(
          `baseline[${index}]: '${key}' 가 비어 있습니다. 사유 없는 예외는 허용하지 않습니다.`,
        );
      }
    }
    return entry as BaselineEntry;
  });
}

export function scan(root: string, baseline: BaselineEntry[]): ScanResult {
  const refs = collectMockRefs(root);
  const key = (file: string, specifier: string) => `${file} ${specifier}`;
  // 매칭 키에 줄 번호를 넣지 않는다 - 무관한 편집에 밀려 예외가 조용히 풀린다.
  const listed = new Map(baseline.map((entry) => [key(entry.file, entry.specifier), entry]));
  const matched = new Set<string>();

  const violations: MockRef[] = [];
  const baselined: Array<MockRef & BaselineEntry> = [];

  for (const ref of refs) {
    if (resolvesToModule(dirname(join(root, ref.file)), ref.specifier)) continue;
    const k = key(ref.file, ref.specifier);
    const entry = listed.get(k);
    if (entry) {
      matched.add(k);
      baselined.push({ ...ref, ...entry });
    } else {
      violations.push(ref);
    }
  }

  // 등재됐지만 이제 위반이 아닌 항목 (FR-014)
  const staleBaseline = baseline.filter((entry) => !matched.has(key(entry.file, entry.specifier)));

  return { scanned: refs.length, violations, baselined, staleBaseline };
}

function main(): void {
  const { values } = parseCliArgs({
    options: {
      ci: { type: 'boolean', default: false },
      format: { type: 'string', default: 'text' },
      path: { type: 'string', default: process.cwd() },
    },
  });
  const root = resolve(String(values.path));
  const ci = Boolean(values.ci);

  let baseline: BaselineEntry[] = [];
  const baselineFile = join(root, BASELINE_PATH);
  try {
    baseline = validateBaseline(existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, 'utf-8')) : []);
  } catch (error) {
    console.error(`baseline 파일 오류: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ci ? 1 : 0);
  }

  const result = scan(root, baseline);

  if (values.format === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`vi.mock 경로 검사 - 상대경로 ${result.scanned}건 스캔\n`);
    console.log(`위반 (차단) ${result.violations.length}건`);
    for (const violation of result.violations) {
      console.log(`  ${violation.file}:${violation.line} -> ${violation.specifier}`);
    }
    console.log(`예외 등재 (baseline) ${result.baselined.length}건`);
    for (const entry of result.baselined) {
      console.log(`  ${entry.file}:${entry.line} -> ${entry.specifier}`);
      console.log(`    사유: ${entry.reason} / 후속: ${entry.followUp}`);
    }
    console.log(`정리 대상 (baseline 에 있으나 위반 아님) ${result.staleBaseline.length}건`);
    for (const stale of result.staleBaseline) {
      console.log(`  ${stale.file} -> ${stale.specifier}`);
    }
    console.log(result.violations.length === 0 ? '\nOK' : '\n새 위반이 있습니다.');
  }

  if (ci && result.violations.length > 0) process.exit(1);
  process.exit(0);
}

if (process.argv[1] && resolve(process.argv[1]).endsWith('check-vi-mock-paths.ts')) {
  main();
}
