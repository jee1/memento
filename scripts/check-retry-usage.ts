#!/usr/bin/env node
/**
 * 재시도 사용 검증 스크립트
 * 
 * 외부 API 호출에서 RetryManager 사용 여부를 검증합니다.
 * 
 * 사용법:
 *   npx tsx scripts/check-retry-usage.ts [옵션]
 * 
 * 옵션:
 *   --format=<json|csv|text>  출력 형식 (기본값: text)
 *   --output=<path>            출력 파일 경로 (기본값: stdout)
 *   --ci                       CI 모드 (검증 실패 시 exit code 1)
 */

import { readFileSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { readdir } from 'fs/promises';

interface RetryUsageResult {
  file: string;
  hasRetryManager: boolean;
  hasExternalAPICall: boolean;
  usesRetryManager: boolean;
  issues: string[];
}

// 외부 API 호출 패턴
const EXTERNAL_API_PATTERNS = [
  /\bfetch\s*\(/g,
  /\baxios\.(get|post|put|delete|patch|request)\s*\(/g,
  /\.(completions|embeddings)\.create\s*\(/g,
  /\.getGenerativeModel\s*\(/g,
  /\.generateContent\s*\(/g,
  /\.embedContent\s*\(/g,
];

// RetryManager 사용 패턴
const RETRY_MANAGER_PATTERNS = [
  /retryManager\.retry\s*\(/g,
  /this\.retryManager\.retry\s*\(/g,
];

async function getAllTsFiles(dir: string, baseDir: string = dir): Promise<string[]> {
  const files: string[] = [];
  
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = relative(baseDir, fullPath);
      
      // 제외할 디렉토리/파일 건너뛰기
      if (entry.name === 'node_modules' || entry.name === 'dist' || 
          entry.name === '__tests__' || entry.name.endsWith('.spec.ts') ||
          entry.name.endsWith('.test.ts')) {
        continue;
      }
      
      if (entry.isDirectory()) {
        const subFiles = await getAllTsFiles(fullPath, baseDir);
        files.push(...subFiles);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        files.push(relativePath);
      }
    }
  } catch (error) {
    // 디렉토리를 읽을 수 없는 경우 무시
  }
  
  return files;
}

function checkRetryUsage(filePath: string): RetryUsageResult {
  if (!existsSync(filePath)) {
    return {
      file: relative(process.cwd(), filePath),
      hasRetryManager: false,
      hasExternalAPICall: false,
      usesRetryManager: false,
      issues: ['File not found']
    };
  }

  const content = readFileSync(filePath, 'utf-8');
  
  // RetryManager import 확인
  const hasRetryManager = /import.*RetryManager|from.*retry-manager/.test(content) ||
                          /private.*retryManager|readonly.*retryManager/.test(content);
  
  // 외부 API 호출 확인
  const hasExternalAPICall = EXTERNAL_API_PATTERNS.some(pattern => pattern.test(content));
  
  // RetryManager 사용 확인
  const usesRetryManager = RETRY_MANAGER_PATTERNS.some(pattern => pattern.test(content));
  
  const issues: string[] = [];
  
  if (hasExternalAPICall && !usesRetryManager) {
    issues.push('외부 API 호출이 있지만 RetryManager를 사용하지 않음');
  }
  
  if (hasRetryManager && !usesRetryManager) {
    issues.push('RetryManager가 import되었지만 사용되지 않음');
  }

  return {
    file: relative(process.cwd(), filePath),
    hasRetryManager,
    hasExternalAPICall,
    usesRetryManager,
    issues
  };
}

async function checkAllFiles(directory: string): Promise<RetryUsageResult[]> {
  const allFiles = await getAllTsFiles(directory);
  const results: RetryUsageResult[] = [];

  for (const file of allFiles) {
    const filePath = join(directory, file);
    const result = checkRetryUsage(filePath);
    
    // 문제가 있는 파일만 포함 (또는 모든 파일 포함)
    if (result.issues.length > 0 || result.hasExternalAPICall) {
      results.push(result);
    }
  }

  return results;
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
  console.log('file,hasRetryManager,hasExternalAPICall,usesRetryManager,issues');
  for (const result of results) {
    const issues = result.issues.join(';');
    console.log(`${result.file},${result.hasRetryManager},${result.hasExternalAPICall},${result.usesRetryManager},"${issues}"`);
  }
}

function printResultsText(results: RetryUsageResult[]): void {
  const issues = results.filter(r => r.issues.length > 0);
  
  console.log(`재시도 사용 검증 결과 (총 ${results.length}개 파일 검사, ${issues.length}개 문제 발견)\n`);
  
  if (issues.length === 0) {
    console.log('✅ 모든 외부 API 호출이 RetryManager를 사용하고 있습니다.');
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
  const args = process.argv.slice(2);
  const format = args.find(arg => arg.startsWith('--format='))?.split('=')[1] || 'text';
  const ci = args.includes('--ci');

  const srcDir = join(process.cwd(), 'src');
  const results = await checkAllFiles(srcDir);
  
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

main().catch(console.error);

