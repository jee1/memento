#!/usr/bin/env node
/**
 * 파일 크기 검증 스크립트
 * 
 * PRD 0017: 코드 품질 개선 - 파일 크기 검증
 * 
 * 사용법:
 *   tsx scripts/check-file-sizes.ts
 *   tsx scripts/check-file-sizes.ts --ci
 *   tsx scripts/check-file-sizes.ts --threshold 500
 *   tsx scripts/check-file-sizes.ts --directory src/
 *   tsx scripts/check-file-sizes.ts --exclude '*.spec.ts'
 * 
 * 목표:
 *   - 핵심 핸들러/서비스 파일이 500줄 이하
 *   - CI/CD 통합 가능
 *   - 경고/에러 출력
 */

import { readFileSync } from 'fs';
import { readdir } from 'fs/promises';
import { join, relative } from 'path';

/**
 * CLI 옵션
 */
interface CliOptions {
  ci?: boolean;
  threshold?: number;
  directory?: string;
  exclude?: string[];
  allowSoftFail?: boolean;
}

/**
 * 파일 크기 검증 결과
 */
interface FileSizeResult {
  file: string;
  lines: number;
  status: 'ok' | 'warning' | 'error';
}

/**
 * 검증 통계
 */
interface ValidationStats {
  total: number;
  ok: number;
  warning: number;
  error: number;
  maxLines: number;
  maxFile: string;
}

/**
 * 명령줄 인자 파싱
 */
function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.d.ts']
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--ci') {
      options.ci = true;
    } else if (arg === '--threshold' && args[i + 1]) {
      options.threshold = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--directory' && args[i + 1]) {
      options.directory = args[i + 1];
      i++;
    } else if (arg === '--exclude' && args[i + 1]) {
      if (!options.exclude) {
        options.exclude = [];
      }
      options.exclude.push(args[i + 1]);
      i++;
    } else if (arg === '--allow-soft-fail') {
      options.allowSoftFail = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

/**
 * 도움말 출력
 */
function printHelp(): void {
  console.log(`
파일 크기 검증 스크립트

사용법:
  tsx scripts/check-file-sizes.ts [options]

옵션:
  --ci                    CI 모드 (실패 시 exit code 1 반환)
  --threshold <number>    임계값 (기본값: 500줄)
  --directory <path>      검사할 디렉토리 (기본값: src/)
  --exclude <pattern>     제외할 파일 패턴 (여러 번 사용 가능)
  --allow-soft-fail       CI 모드에서 경고만 출력하고 통과
  --help, -h              도움말 출력

예제:
  tsx scripts/check-file-sizes.ts
  tsx scripts/check-file-sizes.ts --ci
  tsx scripts/check-file-sizes.ts --threshold 500
  tsx scripts/check-file-sizes.ts --directory src/ --exclude '*.spec.ts'
`);
}

/**
 * 파일의 줄 수 계산
 * 
 * @param filePath - 파일 경로
 * @returns 줄 수
 */
function countLines(filePath: string): number {
  try {
    const content = readFileSync(filePath, 'utf-8');
    // 빈 파일은 0줄
    if (content.trim().length === 0) {
      return 0;
    }
    // 줄 수 계산 (마지막 줄이 개행으로 끝나지 않아도 카운트)
    const lines = content.split('\n');
    return lines.length;
  } catch (error) {
    console.error(`❌ 파일 읽기 실패: ${filePath}`, error instanceof Error ? error.message : String(error));
    return 0;
  }
}

/**
 * 파일 크기 검증
 * 
 * @param filePath - 파일 경로
 * @param threshold - 임계값 (줄 수)
 * @returns 검증 결과
 */
function validateFileSize(filePath: string, threshold: number): FileSizeResult {
  const lines = countLines(filePath);
  
  let status: 'ok' | 'warning' | 'error' = 'ok';
  if (lines > threshold) {
    // 500줄 초과 시 에러, 500줄 이하이지만 임계값 초과 시 경고
    status = lines > 500 ? 'error' : 'warning';
  }

  return {
    file: filePath,
    lines,
    status
  };
}

/**
 * 패턴 매칭 (간단한 glob 패턴 지원)
 * 
 * @param path - 파일 경로
 * @param pattern - 패턴 (예: node_modules, *.spec.ts)
 * @returns 매칭 여부
 */
function matchesPattern(path: string, pattern: string): boolean {
  // **/node_modules/** -> node_modules 포함 여부
  if (pattern.includes('**/node_modules/**')) {
    return path.includes('node_modules');
  }
  // **/dist/** -> dist 포함 여부
  if (pattern.includes('**/dist/**')) {
    return path.includes('dist');
  }
  // **/*.spec.ts -> .spec.ts로 끝나는지
  if (pattern.includes('**/*.spec.ts')) {
    return path.endsWith('.spec.ts');
  }
  // **/*.d.ts -> .d.ts로 끝나는지
  if (pattern.includes('**/*.d.ts')) {
    return path.endsWith('.d.ts');
  }
  return false;
}

/**
 * 파일이 제외 패턴에 해당하는지 확인
 * 
 * @param filePath - 파일 경로
 * @param exclude - 제외 패턴 배열
 * @returns 제외 여부
 */
function shouldExclude(filePath: string, exclude: string[]): boolean {
  for (const pattern of exclude) {
    if (matchesPattern(filePath, pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * 파일 검색 (재귀적)
 * 
 * @param directory - 검색 디렉토리
 * @param exclude - 제외 패턴
 * @returns 파일 경로 배열
 */
async function findFiles(directory: string, exclude: string[]): Promise<string[]> {
  const files: string[] = [];
  const absoluteDir = join(process.cwd(), directory);

  /**
   * 재귀적으로 디렉토리 탐색
   */
  async function walkDir(dir: string): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        
        // 제외 패턴 확인
        if (shouldExclude(fullPath, exclude)) {
          continue;
        }
        
        if (entry.isDirectory()) {
          await walkDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // 디렉토리 읽기 실패 시 무시 (권한 문제 등)
      // console.warn(`디렉토리 읽기 실패: ${dir}`, error);
    }
  }

  await walkDir(absoluteDir);
  return files;
}

/**
 * 검증 통계 계산
 * 
 * @param results - 검증 결과 배열
 * @returns 통계
 */
function calculateStats(results: FileSizeResult[]): ValidationStats {
  const stats: ValidationStats = {
    total: results.length,
    ok: 0,
    warning: 0,
    error: 0,
    maxLines: 0,
    maxFile: ''
  };

  for (const result of results) {
    if (result.status === 'ok') {
      stats.ok++;
    } else if (result.status === 'warning') {
      stats.warning++;
    } else {
      stats.error++;
    }

    if (result.lines > stats.maxLines) {
      stats.maxLines = result.lines;
      stats.maxFile = result.file;
    }
  }

  return stats;
}

/**
 * 결과 출력
 * 
 * @param results - 검증 결과 배열
 * @param stats - 통계
 * @param threshold - 임계값
 * @param projectRoot - 프로젝트 루트 경로
 */
function printResults(
  results: FileSizeResult[],
  stats: ValidationStats,
  threshold: number,
  projectRoot: string
): void {
  console.log('\n📊 파일 크기 검증 결과\n');
  console.log(`임계값: ${threshold}줄`);
  console.log(`검사된 파일 수: ${stats.total}개\n`);

  // 에러 파일 출력
  const errorFiles = results.filter(r => r.status === 'error');
  if (errorFiles.length > 0) {
    console.log('❌ 500줄 초과 파일 (에러):');
    for (const result of errorFiles.sort((a, b) => b.lines - a.lines)) {
      const relativePath = relative(projectRoot, result.file);
      console.log(`   ${relativePath}: ${result.lines}줄`);
    }
    console.log('');
  }

  // 경고 파일 출력
  const warningFiles = results.filter(r => r.status === 'warning');
  if (warningFiles.length > 0) {
    console.log('⚠️  임계값 초과 파일 (경고):');
    for (const result of warningFiles.sort((a, b) => b.lines - a.lines)) {
      const relativePath = relative(projectRoot, result.file);
      console.log(`   ${relativePath}: ${result.lines}줄`);
    }
    console.log('');
  }

  // 통계 출력
  console.log('📈 통계:');
  console.log(`   ✅ 통과: ${stats.ok}개`);
  if (stats.warning > 0) {
    console.log(`   ⚠️  경고: ${stats.warning}개`);
  }
  if (stats.error > 0) {
    console.log(`   ❌ 에러: ${stats.error}개`);
  }
  console.log(`   📏 최대 파일: ${relative(projectRoot, stats.maxFile)} (${stats.maxLines}줄)`);
  console.log('');
}

/**
 * 메인 함수
 */
async function main(): Promise<void> {
  const options = parseArgs();
  const projectRoot = process.cwd();
  const threshold = options.threshold || 500;
  const directory = options.directory || 'src/';
  const exclude = options.exclude || ['**/node_modules/**', '**/dist/**', '**/*.d.ts'];

  try {
    // 파일 검색
    console.log(`🔍 파일 검색 중... (디렉토리: ${directory})`);
    const files = await findFiles(directory, exclude);
    
    if (files.length === 0) {
      console.log('⚠️  검사할 파일이 없습니다.');
      process.exit(0);
    }

    console.log(`   발견된 파일: ${files.length}개\n`);

    // 파일 크기 검증
    console.log('📏 파일 크기 검증 중...');
    const results: FileSizeResult[] = [];
    for (const file of files) {
      const result = validateFileSize(file, threshold);
      results.push(result);
    }

    // 통계 계산
    const stats = calculateStats(results);

    // 결과 출력
    printResults(results, stats, threshold, projectRoot);

    // CI 모드: exit code 처리
    if (options.ci) {
      if (stats.error > 0) {
        console.log('❌ CI 실패: 500줄 초과 파일이 있습니다.');
        process.exit(1);
      } else if (stats.warning > 0 && !options.allowSoftFail) {
        console.log('⚠️  CI 경고: 임계값 초과 파일이 있습니다.');
        process.exit(1);
      } else {
        console.log('✅ CI 통과: 모든 파일이 임계값 이하입니다.');
        process.exit(0);
      }
    } else {
      // 일반 모드: 정보만 출력
      if (stats.error > 0 || stats.warning > 0) {
        console.log('💡 팁: --ci 옵션을 사용하면 CI/CD 파이프라인에 통합할 수 있습니다.');
      }
    }
  } catch (error) {
    console.error('❌ 오류 발생:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// 스크립트 직접 실행 시
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1])) {
  main().catch(error => {
    console.error('❌ 치명적 오류:', error);
    process.exit(1);
  });
}

