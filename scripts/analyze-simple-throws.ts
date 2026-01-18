#!/usr/bin/env node
/**
 * 단순 throw만 하는 에러 발생 지점 분석 스크립트
 * 
 * Given: 일부 코드에서 단순 throw만 하고 구조화된 에러 로깅 미적용
 * When: 단순 throw만 하는 모든 에러 발생 지점을 찾아 분석
 * Then: 에러 발생 지점이 명확히 파악됨
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

interface ThrowAnalysis {
  file: string;
  line: number;
  code: string;
  hasErrorLogging: boolean;
  hasWithErrorHandling: boolean;
  hasTryCatch: boolean;
}

const srcDir = join(process.cwd(), 'src');
const testDirs = ['test', '__tests__', 'spec'];
const excludedDirs = ['node_modules', 'dist', 'coverage', '.git'];

/**
 * 파일이 테스트 파일인지 확인
 */
function isTestFile(filePath: string): boolean {
  return testDirs.some(dir => filePath.includes(dir)) ||
         filePath.endsWith('.spec.ts') ||
         filePath.endsWith('.test.ts');
}

/**
 * 디렉토리가 제외 대상인지 확인
 */
function shouldExcludeDir(dirName: string): boolean {
  return excludedDirs.includes(dirName) || dirName.startsWith('.');
}

/**
 * 파일에서 throw 패턴 찾기
 */
function findThrows(filePath: string): ThrowAnalysis[] {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const results: ThrowAnalysis[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    // throw 패턴 찾기 (단순 throw 제외, new Error 또는 변수 throw 포함)
    if (line.includes('throw ') && !line.trim().startsWith('//')) {
      // 주석이 아닌 경우만
      const trimmedLine = line.trim();
      
      // throw new Error 또는 throw 변수 패턴
      if (trimmedLine.includes('throw new Error') || 
          trimmedLine.includes('throw ') && !trimmedLine.includes('//')) {
        
        // 주변 코드 컨텍스트 확인 (앞 10줄, 뒤 10줄)
        const contextStart = Math.max(0, i - 10);
        const contextEnd = Math.min(lines.length, i + 10);
        const context = lines.slice(contextStart, contextEnd).join('\n');
        
        // ErrorLoggingService 사용 여부 확인
        const hasErrorLogging = 
          context.includes('errorLoggingService') ||
          context.includes('ErrorLoggingService') ||
          context.includes('.logError(');
        
        // withErrorHandling 사용 여부 확인
        const hasWithErrorHandling = 
          context.includes('withErrorHandling') ||
          context.includes('withErrorHandling(');
        
        // try-catch 블록 내부인지 확인
        const hasTryCatch = 
          context.includes('try {') ||
          context.includes('catch (');
        
        results.push({
          file: filePath,
          line: lineNumber,
          code: trimmedLine.substring(0, 100), // 최대 100자
          hasErrorLogging,
          hasWithErrorHandling,
          hasTryCatch
        });
      }
    }
  }

  return results;
}

/**
 * 디렉토리 재귀 탐색
 */
function scanDirectory(dir: string, results: ThrowAnalysis[]): void {
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      if (!shouldExcludeDir(entry)) {
        scanDirectory(fullPath, results);
      }
    } else if (stat.isFile() && entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      // 테스트 파일 제외
      if (!isTestFile(fullPath)) {
        const throws = findThrows(fullPath);
        results.push(...throws);
      }
    }
  }
}

/**
 * 메인 실행
 */
function main(): void {
  console.log('단순 throw만 하는 에러 발생 지점 분석 시작...\n');
  
  const allThrows: ThrowAnalysis[] = [];
  scanDirectory(srcDir, allThrows);

  // 단순 throw만 하는 경우 필터링
  const simpleThrows = allThrows.filter(
    t => !t.hasErrorLogging && !t.hasWithErrorHandling
  );

  // ErrorLoggingService를 사용하는 경우
  const withErrorLogging = allThrows.filter(t => t.hasErrorLogging);
  
  // withErrorHandling을 사용하는 경우
  const withErrorHandling = allThrows.filter(t => t.hasWithErrorHandling);

  // 통계 출력
  console.log('=== 분석 결과 ===\n');
  console.log(`전체 throw 개수: ${allThrows.length}`);
  console.log(`ErrorLoggingService 사용: ${withErrorLogging.length}`);
  console.log(`withErrorHandling 사용: ${withErrorHandling.length}`);
  console.log(`단순 throw만 하는 경우: ${simpleThrows.length}\n`);

  // 단순 throw만 하는 경우 상세 출력
  if (simpleThrows.length > 0) {
    console.log('=== 단순 throw만 하는 에러 발생 지점 ===\n');
    
    // 파일별로 그룹화
    const byFile = new Map<string, ThrowAnalysis[]>();
    for (const t of simpleThrows) {
      const relativePath = t.file.replace(process.cwd() + '/', '');
      if (!byFile.has(relativePath)) {
        byFile.set(relativePath, []);
      }
      byFile.get(relativePath)!.push(t);
    }

    // 파일별로 출력
    for (const [file, throws] of byFile.entries()) {
      console.log(`\n${file} (${throws.length}개):`);
      for (const t of throws) {
        console.log(`  Line ${t.line}: ${t.code}`);
      }
    }
  }

  // JSON 출력 (선택적)
  if (process.argv.includes('--json')) {
    console.log('\n=== JSON 출력 ===');
    console.log(JSON.stringify({
      total: allThrows.length,
      withErrorLogging: withErrorLogging.length,
      withErrorHandling: withErrorHandling.length,
      simpleThrows: simpleThrows.length,
      details: simpleThrows.map(t => ({
        file: t.file.replace(process.cwd() + '/', ''),
        line: t.line,
        code: t.code
      }))
    }, null, 2));
  }
}

main();
