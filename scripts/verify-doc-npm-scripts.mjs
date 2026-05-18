#!/usr/bin/env node
/**
 * 모든 .md에서 `npm run <script>` 패턴을 찾아, <script>가 루트 또는 workspace
 * package.json의 scripts에 존재하는지 검사한다.
 * 제외 디렉터리: node_modules, dist, .git, .worktrees (git worktree 별 클론)
 *
 * 오탐(문서에만 등장하는 가상 명령 등): 아래 ALLOWLIST_NAMES에 스크립트명 추가.
 *
 * 사용: node scripts/verify-doc-npm-scripts.mjs
 * 종료 코드: 미정의 스크립트 인용이 있으면 1
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.worktrees']);

/** 문서에만 허용할 npm 스크립트명 (실제 package.json에 없을 때만 추가) */
const ALLOWLIST_NAMES = new Set([
  // 예: 'legacy-example-script'
  // issue-409 PR에서 추가 예정인 스크립트 (plan 파일 선참조)
  'quality:benchmark:tune-weights',
  'quality:benchmark:tune-report',
]);

function* walkMarkdownFiles(dir, rel = '') {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const name = e.name;
    const relPath = rel ? `${rel}/${name}` : name;
    const full = path.join(dir, name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      yield* walkMarkdownFiles(full, relPath);
    } else if (name.endsWith('.md')) {
      yield { full, relPath };
    }
  }
}

function* workspaceDirs(rootPkg) {
  const ws = rootPkg.workspaces;
  if (!Array.isArray(ws)) return;
  for (const w of ws) {
    if (w.endsWith('/*')) {
      const relDir = w.slice(0, -2);
      const abs = path.join(ROOT, relDir);
      if (!fs.existsSync(abs)) continue;
      for (const sub of fs.readdirSync(abs, { withFileTypes: true })) {
        if (sub.isDirectory()) {
          yield path.join(relDir, sub.name);
        }
      }
    } else {
      yield w;
    }
  }
}

function collectAllScriptNames() {
  const names = new Set();
  const rootPath = path.join(ROOT, 'package.json');
  const rootPkg = JSON.parse(fs.readFileSync(rootPath, 'utf8'));
  for (const k of Object.keys(rootPkg.scripts ?? {})) {
    names.add(k);
  }
  for (const dir of workspaceDirs(rootPkg)) {
    const pkgPath = path.join(ROOT, dir, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    for (const k of Object.keys(pkg.scripts ?? {})) {
      names.add(k);
    }
  }
  return names;
}

/**
 * (1) 줄 시작(선행 공백만)의 `npm run <name>`
 * (2) 인라인 백틱 `` `npm run <name>` ``
 * 만 집계한다. 본문 속 "verify npm run script …" 같은 영어 구절은 제외한다.
 */
function collectReferencedScriptNames(mdText) {
  const names = new Set();
  for (const line of mdText.split('\n')) {
    const m = line.match(/^\s*npm\s+run\s+([a-z0-9][a-z0-9:-]*)\b/i);
    if (m) names.add(m[1]);
  }
  for (const m of mdText.matchAll(/`npm\s+run\s+([^`\s]+)`/gi)) {
    const raw = m[1];
    if (/^[a-z0-9][a-z0-9:-]*$/i.test(raw)) names.add(raw);
  }
  return names;
}

function findUnknownRuns(mdText, known) {
  const unknown = new Set();
  for (const name of collectReferencedScriptNames(mdText)) {
    if (ALLOWLIST_NAMES.has(name)) continue;
    if (!known.has(name)) unknown.add(name);
  }
  return unknown;
}

function main() {
  const known = collectAllScriptNames();
  const files = [...walkMarkdownFiles(ROOT)];
  const problems = [];

  for (const { full, relPath } of files) {
    const text = fs.readFileSync(full, 'utf8');
    const bad = findUnknownRuns(text, known);
    for (const name of bad) {
      problems.push({ file: relPath, script: name });
    }
  }

  console.log(
    `Known npm scripts (union): ${known.size}; scanned ${files.length} markdown files.`,
  );
  if (problems.length === 0) {
    console.log('All npm run <script> references in .md match a workspace script name.');
    process.exit(0);
  }

  console.error(`\nUnknown npm scripts cited in markdown (${problems.length}):\n`);
  for (const p of problems) {
    console.error(`  ${p.file}: npm run ${p.script}`);
  }
  console.error(
    '\nFix docs, add script to package.json, or add name to ALLOWLIST_NAMES with comment in commit.',
  );
  process.exit(1);
}

main();
