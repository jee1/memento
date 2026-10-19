#!/usr/bin/env node
import { isMain, parseArgs as parseCliArgs } from './lib/cli.js';
/**
 * 재시도 사용 검증 스크립트
 *
 * 외부 API 호출에서 RetryManager 사용 여부를 검증합니다.
 *
 * 사용법:
 *   npx tsx scripts/check-retry-usage.ts [옵션]
 *
 * 옵션:
 *   --directory=<path>         검사할 디렉토리 (기본값: packages)
 *   --format=<json|csv|text>  출력 형식 (기본값: text)
 *   --ci                       CI 모드 (검증 실패 시 exit code 1)
 *
 * 검사할 파일이 0개면 모드와 관계없이 exit 1 입니다(#1338 — 대상 경로가 사라져
 * 0 파일을 검사하고 통과하던 게이트).
 */

import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { readdir } from 'fs/promises';

export interface RetryUsageResult {
  file: string;
  hasExternalAPICall: boolean;
  usesRetryManager: boolean;
  issues: string[];
}

// 외부 API 호출 패턴. `/g` 를 붙이지 말 것 — test() 가 lastIndex 를 남겨 다음 파일 검사가 중간부터 시작한다.
const EXTERNAL_API_PATTERNS = [
  /\bfetch\s*\(/,
  /\baxios\.(get|post|put|delete|patch|request)\s*\(/,
  /\.(completions|embeddings)\.create\s*\(/,
  /\.getGenerativeModel\s*\(/,
  /\.generateContent\s*\(/,
  /\.embedContent\s*\(/,
];

// RetryManager 사용 패턴 (배치 작업용 shouldRetry·incrementErrorCount 등 포함)
const RETRY_MANAGER_PATTERN = /retryManager\.(retry|shouldRetry|incrementErrorCount|getErrorCount|resetErrorCount)\s*\(/;

/**
 * 재시도 없이 외부 호출을 해도 되는 파일과 그 근거 (`--directory` 기준 경로).
 * 새 항목은 실패 시 동작(폴백·호출자에게 에러 노출 등)을 근거로 적는다.
 */
export const RETRY_EXEMPTIONS: Readonly<Record<string, string>> = {
  'memento-core/src/domains/consolidation/services/cluster-judge.ts':
    '배치 판정 실패는 NaN 으로 돌려 cosine 클러스터링으로 폴백한다',
  'memento-core/src/domains/consolidation/services/summarization-service.ts':
    'LLM 요약 실패는 extractive 요약으로 폴백한다',
  'memento-core/src/domains/search/services/relevance-gate/jev-relevance-gate.ts':
    '검색 경로의 타임아웃 예산 안에서 도는 게이트다. 실패하면 게이트를 건너뛴다(재시도는 지연을 곱한다)',
  'memento-core/src/shared/services/typesafe/system-one-client.ts':
    'System One noul 전송이다. ask 는 던지지 않고 waf|auth|http|timeout|parse|network 로 돌린다. WAF 펜스 재시도 1회는 클라이언트 안에 있다. RetryManager 재시도는 검색 게이트·관계 추출 soft-fail 지연을 곱한다',
  'memento-core/src/domains/personal-agent/adapters/gemini-chat-llm-adapter.ts':
    '대화형 호출이다. 실패를 PersonalAgentLlmError 로 호출자에게 바로 알린다',
  'memento-core/src/domains/personal-agent/adapters/ollama-chat-llm-adapter.ts':
    '대화형 호출이다. 실패를 PersonalAgentLlmError 로 호출자에게 바로 알린다',
  'memento-core/src/domains/personal-agent/adapters/openai-chat-llm-adapter.ts':
    'OpenAI SDK 가 자체 재시도(maxRetries)를 한다',
  'memento-server/src/server/review-candidates-changed-fanout.ts':
    'best-effort relay 다. 실패는 로그만 남기고 SSE 알림은 이미 나갔다',
  'memento-server/src/server/server-info.ts':
    '로컬 서버 생존 확인·CLI 도구 호출이다. 실패를 그대로 사용자에게 보여 준다',
  'memento-server/src/cli/agent-ops.ts':
    'CLI 요청이다. 실패를 그대로 사용자에게 보여 준다',
};

async function getAllTsFiles(dir: string, baseDir: string = dir): Promise<string[]> {
  const files: string[] = [];
  // 디렉토리를 못 읽으면 그대로 던진다 — 삼키면 빈 검사가 통과로 보인다(#1338).
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    // 제외할 디렉토리/파일 건너뛰기
    if (entry.name === 'node_modules' || entry.name === 'dist' ||
        entry.name === '__tests__' || entry.name === 'test' ||
        entry.name.endsWith('.spec.ts') || entry.name.endsWith('.test.ts') ||
        entry.name.endsWith('.d.ts')) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...await getAllTsFiles(fullPath, baseDir));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(relative(baseDir, fullPath));
    }
  }

  return files;
}

function stripComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

export function checkRetryUsage(file: string, content: string): RetryUsageResult {
  const code = stripComments(content);
  const hasExternalAPICall = EXTERNAL_API_PATTERNS.some(pattern => pattern.test(code));
  const usesRetryManager = RETRY_MANAGER_PATTERN.test(code);
  const issues: string[] = [];

  if (hasExternalAPICall && !usesRetryManager && !(file in RETRY_EXEMPTIONS)) {
    issues.push('외부 API 호출이 있지만 RetryManager를 사용하지 않음');
  }

  return { file, hasExternalAPICall, usesRetryManager, issues };
}

export async function checkAllFiles(directory: string): Promise<RetryUsageResult[]> {
  const allFiles = await getAllTsFiles(directory);
  if (allFiles.length === 0) {
    throw new Error(`검사할 파일이 없습니다: ${directory}`);
  }

  return allFiles
    .map(file => checkRetryUsage(file, readFileSync(join(directory, file), 'utf-8')))
    .filter(result => result.issues.length > 0 || result.hasExternalAPICall);
}

function printResultsJSON(results: RetryUsageResult[]): void {
  const output = {
    total: results.length,
    issues: results.filter(r => r.issues.length > 0).length,
    files: results
  };
  console.log(JSON.stringify(output, null, 2));
}

function printResultsCSV(results: RetryUsageResult[]): void {
  console.log('file,hasExternalAPICall,usesRetryManager,issues');
  for (const result of results) {
    const issues = result.issues.join(';');
    console.log(`${result.file},${result.hasExternalAPICall},${result.usesRetryManager},"${issues}"`);
  }
}

function printResultsText(results: RetryUsageResult[]): void {
  const issues = results.filter(r => r.issues.length > 0);

  console.log(`재시도 사용 검증 결과 (외부 호출 파일 ${results.length}개, ${issues.length}개 문제 발견)\n`);

  if (issues.length === 0) {
    console.log('✅ 모든 외부 API 호출이 RetryManager를 사용하거나 예외 목록에 있습니다.');
    return;
  }

  console.log('⚠️  다음 파일에서 문제가 발견되었습니다:\n');

  for (const result of issues) {
    console.log(`${result.file}`);
    for (const issue of result.issues) {
      console.log(`  - ${issue}`);
    }
    console.log();
  }
}

async function main() {
  const args = parseCliArgs().args;
  const format = args.find(arg => arg.startsWith('--format='))?.split('=')[1] || 'text';
  const directory = args.find(arg => arg.startsWith('--directory='))?.split('=')[1] || 'packages';
  const ci = args.includes('--ci');

  const results = await checkAllFiles(join(process.cwd(), directory));
  const issues = results.filter(r => r.issues.length > 0);

  if (format === 'json') {
    printResultsJSON(results);
  } else if (format === 'csv') {
    printResultsCSV(results);
  } else {
    printResultsText(results);
  }

  // CI 모드: 문제가 있으면 exit code 1
  if (ci && issues.length > 0) {
    process.exit(1);
  }
}

if (isMain(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
