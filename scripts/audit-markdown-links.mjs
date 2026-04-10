#!/usr/bin/env node
/**
 * 모든 .md 파일의 인라인 상대 링크 `[text](path)` 존재 여부를 검사합니다.
 * 제외: node_modules, dist, .git, http(s), mailto, #fragment-only
 *
 * 사용: node scripts/audit-markdown-links.mjs
 * 종료 코드: 깨진 링크가 있으면 1
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

function shouldSkipDir(parts) {
  return parts.some((p) => SKIP_DIRS.has(p));
}

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

const LINK_RE = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function checkFile(mdPath, relPath) {
  const text = fs.readFileSync(mdPath, 'utf8');
  const dir = path.dirname(mdPath);
  const broken = [];

  let m;
  while ((m = LINK_RE.exec(text)) !== null) {
    let target = m[2].trim();
    if (
      !target ||
      target.startsWith('http://') ||
      target.startsWith('https://') ||
      target.startsWith('mailto:') ||
      target.startsWith('vscode:') ||
      target.startsWith('file:') ||
      target.startsWith('mdc:')
    ) {
      continue;
    }
    const hashIdx = target.indexOf('#');
    const pathPart = hashIdx >= 0 ? target.slice(0, hashIdx) : target;
    if (!pathPart) continue;

    // `[table](col)` SQL 등 마크다운이 아닌 괄호 패턴 제외: 경로에 `/` 또는 확장자가 있을 때만 검사
    const looksLikePath =
      pathPart.includes('/') ||
      /\.[a-z0-9]{1,8}$/i.test(pathPart) ||
      pathPart === '.' ||
      pathPart === '..';
    if (!looksLikePath) continue;

    const resolved = path.normalize(path.join(dir, pathPart));
    if (!resolved.startsWith(ROOT)) {
      broken.push({ target, reason: 'outside repo' });
      continue;
    }
    try {
      const st = fs.statSync(resolved);
      if (!st.isFile() && !st.isDirectory()) {
        broken.push({ target, reason: 'not file or dir' });
      }
    } catch {
      broken.push({ target, reason: 'missing' });
    }
  }

  return broken;
}

function main() {
  const files = [...walkMarkdownFiles(ROOT)];
  const allBroken = [];

  for (const { full, relPath } of files) {
    const broken = checkFile(full, relPath);
    for (const b of broken) {
      allBroken.push({ file: relPath, ...b });
    }
  }

  console.log(`Scanned ${files.length} markdown files under ${ROOT}`);
  if (allBroken.length === 0) {
    console.log('All relative markdown links resolve to existing paths.');
    process.exit(0);
  }

  console.log(`\nBroken links (${allBroken.length}):\n`);
  for (const row of allBroken) {
    console.log(`  ${row.file}`);
    console.log(`    -> ${row.target} (${row.reason})`);
  }
  process.exit(1);
}

main();
