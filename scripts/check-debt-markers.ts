#!/usr/bin/env node
/**
 * Debt marker 검사 스크립트 (Issue #586)
 *
 * tech-debt-analyzer의 naive 부분 문자열 매칭(false positive) 대신
 * actionable 마커만 보고한다.
 *
 * 사용법:
 *   npx tsx scripts/check-debt-markers.ts [--production-only] [--path=<dir>]
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

interface Finding {
  file: string;
  line: number;
  marker: string;
  message: string;
  code: string;
}

const ROOT = process.cwd();
const DEFAULT_SCAN_ROOT = join(ROOT, 'packages/memento-core/src');

const EXPLICIT_COMMENT_MARKERS = /\b(TODO|FIXME|HACK|XXX)\b/i;
const EXPLICIT_BUG_COMMENT = /\bBUG\b/;

const PRODUCTION_SKIP = /\.spec\.(ts|tsx)$|\/__tests__\//;

/** 로그/진단 레벨 등 의도적 패턴 — actionable에서 제외 */
const IGNORE_LINE_PATTERNS: RegExp[] = [
  /['"]debug['"]/,
  /\.debug\s*\(/,
  /logger\.debug/,
  /mcpLogger\.log(Server|Batch)\(\s*['"]debug['"]/,
  /LogLevel\.DEBUG/,
  /DEBUG\s*=\s*['"]DEBUG['"]/,
  /level === ['"]debug['"]/,
  /dataLevel === ['"]debug['"]/,
  /MCP_DEBUG|MEMENTO_DB_DEBUG|DEBUG_PERFORMANCE/,
  /getCurrentLogLevel|shouldLog|logWithMCPLogger\(['"]debug['"]/,
  /export type LogLevel = ['"]debug['"]/,
  /debug:\s*\d+/,
  /\/\*\*?\s*DEBUG/,
  /DEBUG 레벨/,
  /\/\/\s*.*진단\s*레벨/,
  /status IN \([^)]*'deprecated'[^)]*\)/,
  /\[LEGACY TYPE\]/,
  /\[deprecated\]/i,
  /Knowledge Vault Repository \(Deprecated\)/i,
  /deprecated 예정/,
  /deprecated\s+—/i,
  /Use IFeedbackRepository/,
  /Use FeedbackRepositorySQLite/,
  /Use IKnowledgeVaultRepository/,
  /Use KnowledgeVaultRepositorySqlite/,
  /Use IProcessAttributeRepository/,
  /heapUsagePercent/,
  /AsyncTaskQueue가 자동으로 처리/,
  /하위 호환성을 위해 유지/,
  /테스트 호환용/,
  /직접 searchService를 사용/,
  /직접 cacheService를 사용/,
  /리팩토링이 완료되어 더 이상 필요하지 않습니다/,
  /embedding-service\.ts/,
  /type-param-rollout\.md/,
];

function parseArgs(): { productionOnly: boolean; scanRoot: string } {
  let productionOnly = false;
  let scanRoot = DEFAULT_SCAN_ROOT;
  for (const arg of process.argv.slice(2)) {
    if (arg === '--production-only') productionOnly = true;
    else if (arg.startsWith('--path=')) scanRoot = arg.slice('--path='.length);
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: npx tsx scripts/check-debt-markers.ts [--production-only] [--path=<dir>]');
      process.exit(0);
    }
  }
  return { productionOnly, scanRoot };
}

function collectTsFiles(dir: string, productionOnly: boolean): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      files.push(...collectTsFiles(full, productionOnly));
      continue;
    }
    if (!full.endsWith('.ts') && !full.endsWith('.tsx')) continue;
    const rel = relative(ROOT, full);
    if (productionOnly && PRODUCTION_SKIP.test(rel)) continue;
    files.push(full);
  }
  return files;
}

function isIgnoredLine(line: string): boolean {
  return IGNORE_LINE_PATTERNS.some((p) => p.test(line));
}

function scanFile(filePath: string): Finding[] {
  const rel = relative(ROOT, filePath);
  const lines = readFileSync(filePath, 'utf8').split('\n');
  const findings: Finding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('*')) continue;
    if (isIgnoredLine(line)) continue;

    // @deprecated JSDoc: docs/architecture/core-deprecated-inventory.md 로 추적 (스캔 대상 아님)

    if (EXPLICIT_COMMENT_MARKERS.test(line) && /\/\/|\/\*/.test(line)) {
      const m = line.match(EXPLICIT_COMMENT_MARKERS);
      findings.push({
        file: rel,
        line: i + 1,
        marker: (m?.[1] ?? 'MARKER').toUpperCase(),
        message: 'Explicit debt comment',
        code: trimmed.slice(0, 120),
      });
      continue;
    }

    if (EXPLICIT_BUG_COMMENT.test(line) && /\/\/|\/\*/.test(line)) {
      findings.push({
        file: rel,
        line: i + 1,
        marker: 'BUG',
        message: 'Explicit BUG comment',
        code: trimmed.slice(0, 120),
      });
      continue;
    }

    // Substring bug in comments/strings (exclude log debug — handled by ignore list)
    if (/(?<![a-zA-Z])bug(?![a-zA-Z-])/i.test(line) && !isIgnoredLine(line)) {
      if (/['"][^'"]*bug[^'"]*['"]/.test(line) || /\/\//.test(line)) {
        findings.push({
          file: rel,
          line: i + 1,
          marker: 'BUG',
          message: 'bug keyword in comment or string',
          code: trimmed.slice(0, 120),
        });
      }
    }

    // XXX placeholder in comments (JWT example)
    if (/\bXXX\b/i.test(line) && /\/\//.test(line)) {
      findings.push({
        file: rel,
        line: i + 1,
        marker: 'XXX',
        message: 'XXX placeholder in comment',
        code: trimmed.slice(0, 120),
      });
    }
  }

  return findings;
}

function main(): void {
  const { productionOnly, scanRoot } = parseArgs();
  if (!statSync(scanRoot).isDirectory()) {
    console.error(`Scan root not found: ${scanRoot}`);
    process.exit(1);
  }

  const files = collectTsFiles(scanRoot, productionOnly);
  const findings = files.flatMap(scanFile);

  if (findings.length === 0) {
    console.log(
      `check-debt-markers: OK (${files.length} files, productionOnly=${productionOnly})`
    );
    process.exit(0);
  }

  console.error(`check-debt-markers: ${findings.length} finding(s)`);
  for (const f of findings) {
    console.error(`${f.file}:${f.line} [${f.marker}] ${f.message}`);
    console.error(`  ${f.code}`);
  }
  process.exit(1);
}

main();
