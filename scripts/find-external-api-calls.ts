#!/usr/bin/env node
/**
 * 외부 API 호출 검색 스크립트
 * 
 * 코드베이스에서 외부 API 호출을 검색하고 우선순위 목록을 생성합니다.
 * 
 * 검색 패턴:
 * - 표준 패턴: fetch(, axios., http.request(, https.request(
 * - 커스텀 클라이언트: *Client, *Api 클래스
 * - 임베딩 제공자: OpenAI SDK, Gemini SDK 등
 * 
 * 사용법:
 *   npx tsx scripts/find-external-api-calls.ts [옵션]
 * 
 * 옵션:
 *   --format=<json|csv|text>  출력 형식 (기본값: json)
 *   --output=<path>            출력 파일 경로 (기본값: stdout)
 *   --core-only                핵심 모듈만 검색 (src/domains/embedding/, src/domains/relation/)
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { readdir } from 'fs/promises';
import { join, relative } from 'path';

interface ExternalAPICall {
  file: string;
  line: number;
  pattern: string;
  type: 'fetch' | 'axios' | 'http' | 'https' | 'client' | 'sdk';
  context: string;
}

interface FileResult {
  file: string;
  count: number;
  calls: ExternalAPICall[];
  priority: number; // 높을수록 우선순위 높음
}

// 외부 API 호출 패턴 (더 정확한 패턴)
const PATTERNS = [
  { regex: /\bfetch\s*\(/g, type: 'fetch' as const },
  { regex: /\baxios\.(get|post|put|delete|patch|request)\s*\(/g, type: 'axios' as const },
  { regex: /\bhttp\.request\s*\(/g, type: 'http' as const },
  { regex: /\bhttps\.request\s*\(/g, type: 'https' as const },
  { regex: /\bnew\s+OpenAI\s*\(/g, type: 'sdk' as const },
  { regex: /\bnew\s+GoogleGenerativeAI\s*\(/g, type: 'sdk' as const },
  { regex: /\bnew\s+GoogleGenAI\s*\(/g, type: 'sdk' as const },
  { regex: /\bfrom\s+['"]openai['"]/g, type: 'sdk' as const },
  { regex: /\bfrom\s+['"]@google\/generative-ai['"]/g, type: 'sdk' as const },
  // OpenAI SDK 메서드 호출
  { regex: /\.(chat|embeddings|completions)\.create\s*\(/g, type: 'sdk' as const },
  // Gemini SDK 메서드 호출
  { regex: /\.getGenerativeModel\s*\(/g, type: 'sdk' as const },
  { regex: /\.generateContent\s*\(/g, type: 'sdk' as const },
];

// 핵심 모듈 디렉토리
const CORE_DIRECTORIES = [
  'src/domains/embedding/',
  'src/domains/relation/',
];

function isCoreModule(filePath: string): boolean {
  return CORE_DIRECTORIES.some(dir => filePath.includes(dir));
}

function findExternalAPICalls(filePath: string): ExternalAPICall[] {
  if (!existsSync(filePath)) {
    return [];
  }

  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const calls: ExternalAPICall[] = [];

  // 표준 패턴 검색
  for (const pattern of PATTERNS) {
    const matches = [...content.matchAll(pattern.regex)];
    for (const match of matches) {
      const index = match.index!;
      const lineNumber = content.substring(0, index).split('\n').length;
      const line = lines[lineNumber - 1]?.trim() || '';
      
      calls.push({
        file: filePath,
        line: lineNumber,
        pattern: match[0],
        type: pattern.type,
        context: line.substring(0, 100) // 첫 100자만
      });
    }
  }

  // 클라이언트 클래스 검색 (더 정확한 패턴)
  // 실제로 외부 API를 호출하는 클래스만 찾기
  const clientClassPattern = /class\s+(\w+Client|\w+Api)\s*(?:extends|implements|\{)/g;
  const clientMatches = [...content.matchAll(clientClassPattern)];
  
  // 클라이언트 클래스가 있고, 실제로 API 호출 메서드가 있는 경우만 포함
  if (clientMatches.length > 0) {
    // API 호출 메서드가 있는지 확인
    const hasApiCall = PATTERNS.some(p => p.regex.test(content));
    if (hasApiCall) {
      for (const match of clientMatches) {
        const index = match.index!;
        const lineNumber = content.substring(0, index).split('\n').length;
        const line = lines[lineNumber - 1]?.trim() || '';
        
        calls.push({
          file: filePath,
          line: lineNumber,
          pattern: match[0],
          type: 'client',
          context: line.substring(0, 100)
        });
      }
    }
  }

  return calls;
}

async function getAllTsFiles(dir: string, baseDir: string = dir): Promise<string[]> {
  const files: string[] = [];
  
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = relative(baseDir, fullPath);
      
      // 제외할 디렉토리/파일 건너뛰기
      if (entry.name === 'node_modules' || entry.name === 'dist' || 
          entry.name === '__tests__' || entry.name.endsWith('.spec.ts')) {
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

async function countExternalAPICalls(directory: string, coreOnly: boolean = false): Promise<FileResult[]> {
  const allFiles = await getAllTsFiles(directory);
  const results: FileResult[] = [];

  for (const file of allFiles) {
    const filePath = join(directory, file);
    
    if (coreOnly && !isCoreModule(filePath)) {
      continue;
    }

    const calls = findExternalAPICalls(filePath);
    if (calls.length > 0) {
      // 우선순위 계산: 호출 수 + 타입별 가중치
      const priority = calls.length * 10 + 
        calls.filter(c => c.type === 'sdk' || c.type === 'client').length * 5;

      results.push({
        file: relative(process.cwd(), filePath),
        count: calls.length,
        calls,
        priority
      });
    }
  }

  // 우선순위 순으로 정렬
  results.sort((a, b) => b.priority - a.priority);

  return results;
}

function printResultsJSON(results: FileResult[]): void {
  const output = {
    total: results.length,
    totalCalls: results.reduce((sum, r) => sum + r.count, 0),
    files: results
  };
  console.log(JSON.stringify(output, null, 2));
}

function printResultsCSV(results: FileResult[]): void {
  console.log('file,count,priority,types');
  for (const result of results) {
    const types = [...new Set(result.calls.map(c => c.type))].join(';');
    console.log(`${result.file},${result.count},${result.priority},${types}`);
  }
}

function printResultsText(results: FileResult[]): void {
  console.log(`외부 API 호출 검색 결과 (총 ${results.length}개 파일, ${results.reduce((sum, r) => sum + r.count, 0)}개 호출)\n`);
  
  for (const result of results) {
    console.log(`${result.file} (${result.count}개, 우선순위: ${result.priority})`);
    const types = [...new Set(result.calls.map(c => c.type))];
    console.log(`  타입: ${types.join(', ')}`);
    console.log();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const format = args.find(arg => arg.startsWith('--format='))?.split('=')[1] || 'json';
  const outputPath = args.find(arg => arg.startsWith('--output='))?.split('=')[1];
  const coreOnly = args.includes('--core-only');

  const srcDir = join(process.cwd(), 'src');
  const results = await countExternalAPICalls(srcDir, coreOnly);

  let output: string;
  if (format === 'json') {
    output = JSON.stringify({
      total: results.length,
      totalCalls: results.reduce((sum, r) => sum + r.count, 0),
      files: results
    }, null, 2);
  } else if (format === 'csv') {
    const lines = ['file,count,priority,types'];
    for (const result of results) {
      const types = [...new Set(result.calls.map(c => c.type))].join(';');
      lines.push(`${result.file},${result.count},${result.priority},${types}`);
    }
    output = lines.join('\n');
  } else {
    output = `외부 API 호출 검색 결과 (총 ${results.length}개 파일, ${results.reduce((sum, r) => sum + r.count, 0)}개 호출)\n\n`;
    for (const result of results) {
      output += `${result.file} (${result.count}개, 우선순위: ${result.priority})\n`;
      const types = [...new Set(result.calls.map(c => c.type))];
      output += `  타입: ${types.join(', ')}\n\n`;
    }
  }

  if (outputPath) {
    writeFileSync(outputPath, output, 'utf-8');
    console.log(`결과가 ${outputPath}에 저장되었습니다.`);
  } else {
    console.log(output);
  }
}

main().catch(console.error);

