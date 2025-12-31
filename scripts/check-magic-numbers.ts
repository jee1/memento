#!/usr/bin/env node
/**
 * 매직 넘버 검색 스크립트
 * 
 * 코드베이스에서 매직 넘버를 검색하고 우선순위 목록을 생성합니다.
 * 
 * 검색 규칙:
 * - 숫자 리터럴 (0, 1, -1, 0.5 등)을 매직 넘버로 간주
 * - 제외할 패턴:
 *   - 배열 인덱스: array[0], array[1]
 *   - 비교 연산자: === 0, !== 1
 *   - 반환값: return 0, return null
 *   - 타입 정의: : number = 0
 *   - 상수 정의: const VALUE = 1
 *   - 함수 파라미터 기본값: function(x = 0)
 * - 포함할 패턴:
 *   - 계산식: value * 0.5, delay * 1000
 *   - 설정값: maxAttempts: 3, timeout: 5000
 *   - 임계값: threshold > 0.7, limit < 10
 * 
 * 사용법:
 *   npx tsx scripts/check-magic-numbers.ts [옵션]
 * 
 * 옵션:
 *   --format=<json|csv|text>  출력 형식 (기본값: json)
 *   --output=<path>            출력 파일 경로 (기본값: stdout)
 *   --core-only                핵심 모듈만 검색 (src/domains/search/, src/domains/embedding/)
 *   --min-priority=<number>    최소 우선순위 필터 (기본값: 0)
 */

import { readFileSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { readdir } from 'fs/promises';

interface MagicNumber {
  file: string;
  line: number;
  value: string;
  context: string;
  type: 'integer' | 'float' | 'negative';
}

interface FileResult {
  file: string;
  count: number;
  numbers: MagicNumber[];
  priority: number; // 높을수록 우선순위 높음
}

// 매직 넘버 패턴 (숫자 리터럴)
const NUMBER_PATTERN = /(-?\d+\.?\d*)/g;

// 제외할 패턴 (매직 넘버로 간주하지 않음)
const EXCLUDE_PATTERNS = [
  /\[0\]|\[1\]|\[-1\]/, // 배열 인덱스
  /===\s*0|===\s*1|!==\s*0|!==\s*1/, // 비교 연산자
  /return\s+0|return\s+1|return\s+null|return\s+undefined/, // 반환값
  /:\s*number\s*=\s*\d+/, // 타입 정의
  /const\s+\w+\s*=\s*\d+/, // 상수 정의
  /function\s*\([^)]*=\s*\d+/, // 함수 파라미터 기본값
  /^\s*\/\/.*\d+/, // 주석
  /\/\*.*\d+.*\*\//, // 블록 주석
  /console\.(log|error|warn)\([^)]*\d+/, // console 로그
  /logger\.(info|warn|error)\([^)]*\d+/, // logger 로그
];

// 핵심 모듈 디렉토리
const CORE_DIRECTORIES = [
  'src/domains/search/',
  'src/domains/embedding/',
];

function isCoreModule(filePath: string): boolean {
  return CORE_DIRECTORIES.some(dir => filePath.includes(dir));
}

function isExcluded(line: string, match: RegExpMatchArray): boolean {
  const context = line.substring(Math.max(0, match.index! - 20), match.index! + match[0].length + 20);
  return EXCLUDE_PATTERNS.some(pattern => pattern.test(context));
}

function findMagicNumbers(filePath: string): MagicNumber[] {
  if (!existsSync(filePath)) {
    return [];
  }

  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const numbers: MagicNumber[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const matches = [...line.matchAll(NUMBER_PATTERN)];

    for (const match of matches) {
      // 제외 패턴 확인
      if (isExcluded(line, match)) {
        continue;
      }

      const value = match[0];
      const numValue = parseFloat(value);

      // 0, 1, -1은 제외 (너무 일반적)
      if (numValue === 0 || numValue === 1 || numValue === -1) {
        continue;
      }

      // 타입 결정
      let type: 'integer' | 'float' | 'negative' = 'integer';
      if (value.includes('.')) {
        type = 'float';
      } else if (value.startsWith('-')) {
        type = 'negative';
      }

      numbers.push({
        file: filePath,
        line: lineIndex + 1,
        value,
        context: line.trim().substring(0, 100),
        type
      });
    }
  }

  return numbers;
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

async function countMagicNumbers(directory: string, coreOnly: boolean = false, minPriority: number = 0): Promise<FileResult[]> {
  const allFiles = await getAllTsFiles(directory);
  const results: FileResult[] = [];

  for (const file of allFiles) {
    const filePath = join(directory, file);
    
    if (coreOnly && !isCoreModule(filePath)) {
      continue;
    }

    const numbers = findMagicNumbers(filePath);
    if (numbers.length > 0) {
      // 우선순위 계산: 매직 넘버 수 + 타입별 가중치
      const priority = numbers.length * 10 + 
        numbers.filter(n => n.type === 'float').length * 5;

      if (priority >= minPriority) {
        results.push({
          file: relative(process.cwd(), filePath),
          count: numbers.length,
          numbers,
          priority
        });
      }
    }
  }

  // 우선순위 순으로 정렬
  results.sort((a, b) => b.priority - a.priority);

  return results;
}

function printResultsJSON(results: FileResult[]): void {
  const output = {
    total: results.length,
    totalNumbers: results.reduce((sum, r) => sum + r.count, 0),
    files: results.map(r => ({
      file: r.file,
      count: r.count,
      priority: r.priority,
      numbers: r.numbers.map(n => ({
        line: n.line,
        value: n.value,
        type: n.type,
        context: n.context
      }))
    }))
  };
  console.log(JSON.stringify(output, null, 2));
}

function printResultsCSV(results: FileResult[]): void {
  console.log('file,count,priority,types');
  for (const result of results) {
    const types = [...new Set(result.numbers.map(n => n.type))].join(';');
    console.log(`${result.file},${result.count},${result.priority},${types}`);
  }
}

function printResultsText(results: FileResult[]): void {
  console.log(`매직 넘버 검색 결과 (총 ${results.length}개 파일, ${results.reduce((sum, r) => sum + r.count, 0)}개 매직 넘버)\n`);
  
  for (const result of results) {
    console.log(`${result.file} (${result.count}개, 우선순위: ${result.priority})`);
    const types = [...new Set(result.numbers.map(n => n.type))];
    console.log(`  타입: ${types.join(', ')}`);
    console.log();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const format = args.find(arg => arg.startsWith('--format='))?.split('=')[1] || 'json';
  const outputPath = args.find(arg => arg.startsWith('--output='))?.split('=')[1];
  const coreOnly = args.includes('--core-only');
  const minPriority = parseInt(args.find(arg => arg.startsWith('--min-priority='))?.split('=')[1] || '0', 10);

  const srcDir = join(process.cwd(), 'src');
  const results = await countMagicNumbers(srcDir, coreOnly, minPriority);

  let output: string;
  if (format === 'json') {
    output = JSON.stringify({
      total: results.length,
      totalNumbers: results.reduce((sum, r) => sum + r.count, 0),
      files: results.map(r => ({
        file: r.file,
        count: r.count,
        priority: r.priority,
        numbers: r.numbers.map(n => ({
          line: n.line,
          value: n.value,
          type: n.type,
          context: n.context
        }))
      }))
    }, null, 2);
  } else if (format === 'csv') {
    const lines = ['file,count,priority,types'];
    for (const result of results) {
      const types = [...new Set(result.numbers.map(n => n.type))].join(';');
      lines.push(`${result.file},${result.count},${result.priority},${types}`);
    }
    output = lines.join('\n');
  } else {
    output = `매직 넘버 검색 결과 (총 ${results.length}개 파일, ${results.reduce((sum, r) => sum + r.count, 0)}개 매직 넘버)\n\n`;
    for (const result of results) {
      output += `${result.file} (${result.count}개, 우선순위: ${result.priority})\n`;
      const types = [...new Set(result.numbers.map(n => n.type))];
      output += `  타입: ${types.join(', ')}\n\n`;
    }
  }

  if (outputPath) {
    const { writeFileSync } = await import('fs');
    writeFileSync(outputPath, output, 'utf-8');
    console.log(`결과가 ${outputPath}에 저장되었습니다.`);
  } else {
    console.log(output);
  }
}

main().catch(console.error);

