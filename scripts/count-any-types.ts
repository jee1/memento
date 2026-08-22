#!/usr/bin/env node
import { isMain, parseArgs as parseCliArgs } from './lib/cli.js';
/**
 * any 타입 개수 측정 스크립트
 * 
 * PRD 0017: 코드 품질 개선 - 타입 안정성 개선
 * 
 * 사용법:
 *   tsx scripts/count-any-types.ts
 *   tsx scripts/count-any-types.ts --ci
 *   tsx scripts/count-any-types.ts --directory src/
 *   tsx scripts/count-any-types.ts --exclude "<glob-for-spec-files>"
 * 
 * 목표:
 *   - 현재 any 타입 개수 측정
 *   - 목표 대비 출력 (186개 → 50개 이하)
 *   - CI/CD 통합 가능
 */

import { readFileSync } from 'fs';
import { readdir } from 'fs/promises';
import { join, relative } from 'path';

/**
 * CLI 옵션
 */
interface CliOptions {
  ci?: boolean;
  directory?: string;
  exclude?: string[];
  target?: number;
  allowSoftFail?: boolean;
}

/**
 * any 타입 발견 위치
 */
interface AnyTypeLocation {
  file: string;
  line: number;
  column: number;
  context: string;
}

/**
 * 측정 결과
 */
interface CountResult {
  total: number;
  locations: AnyTypeLocation[];
  byFile: Map<string, number>;
}

/**
 * 명령줄 인자 파싱
 */
function parseArgs(): CliOptions {
  const args = parseCliArgs().args;
  const options: CliOptions = {
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.d.ts']
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--ci') {
      options.ci = true;
    } else if (arg === '--directory' && args[i + 1]) {
      options.directory = args[i + 1];
      i++;
    } else if (arg === '--exclude' && args[i + 1]) {
      if (!options.exclude) {
        options.exclude = [];
      }
      options.exclude.push(args[i + 1]);
      i++;
    } else if (arg === '--target' && args[i + 1]) {
      options.target = parseInt(args[i + 1], 10);
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
any 타입 개수 측정 스크립트

사용법:
  tsx scripts/count-any-types.ts [options]

옵션:
  --ci                    CI 모드 (실패 시 exit code 1 반환)
  --directory <path>      검사할 디렉토리 (기본값: src/)
  --exclude <pattern>     제외할 파일 패턴 (여러 번 사용 가능)
  --target <number>       목표 개수 (기본값: 50개)
  --allow-soft-fail       CI 모드에서 경고만 출력하고 통과
  --help, -h              도움말 출력

예제:
  tsx scripts/count-any-types.ts
  tsx scripts/count-any-types.ts --ci
  tsx scripts/count-any-types.ts --target 50
  tsx scripts/count-any-types.ts --directory src/ --exclude "**/*.spec.ts"
`);
}

/**
 * 패턴 매칭 (간단한 glob 패턴 지원)
 */
function matchesPattern(path: string, pattern: string): boolean {
  if (pattern.includes('**/node_modules/**')) {
    return path.includes('node_modules');
  }
  if (pattern.includes('**/dist/**')) {
    return path.includes('dist');
  }
  if (pattern.includes('**/*.spec.ts')) {
    return path.endsWith('.spec.ts');
  }
  if (pattern.includes('**/*.d.ts')) {
    return path.endsWith('.d.ts');
  }
  return false;
}

/**
 * 파일이 제외 패턴에 해당하는지 확인
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
 */
async function findFiles(directory: string, exclude: string[]): Promise<string[]> {
  const files: string[] = [];
  const absoluteDir = join(process.cwd(), directory);

  async function walkDir(dir: string): Promise<void> {
    try {
      const { readdir } = await import('fs/promises');
      const entries = await readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        
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
      // 디렉토리 읽기 실패 시 무시
    }
  }

  await walkDir(absoluteDir);
  return files;
}

/**
 * 파일에서 any 타입 찾기
 * 
 * @param filePath - 파일 경로
 * @returns any 타입 위치 배열
 */
function findAnyTypes(filePath: string): AnyTypeLocation[] {
  const locations: AnyTypeLocation[] = [];
  
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    // 정규식: \bany\b (단어 경계를 사용하여 정확히 "any"만 매칭)
    // 주석이나 문자열 내부는 제외하기 위해 간단한 휴리스틱 사용
    const anyPattern = /\bany\b/g;
    
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      
      // 주석 제외 (// 또는 /* */)
      if (line.trim().startsWith('//')) {
        continue;
      }
      
      // 문자열 내부 제외 (간단한 휴리스틱)
      const inString = (line.match(/['"]/g) || []).length % 2 === 1;
      if (inString) {
        continue;
      }
      
      // any 패턴 검색
      let match;
      while ((match = anyPattern.exec(line)) !== null) {
        // 타입 정의나 타입 단언 컨텍스트인지 확인
        const beforeMatch = line.substring(0, match.index);
        const afterMatch = line.substring(match.index + match[0].length);
        
        // : any, as any, <any, any>, any[] 등의 패턴만 카운트
        const isTypeContext = 
          /:\s*$/.test(beforeMatch) ||           // : any
          /\bas\s+$/.test(beforeMatch) ||        // as any
          /<\s*$/.test(beforeMatch) ||           // <any
          /,\s*$/.test(beforeMatch) ||           // , any
          /\(\s*$/.test(beforeMatch) ||          // (any
          /\s+$/.test(beforeMatch) && [',', '[', ']', ')', '>'].includes(afterMatch[0] ?? '') || // any, any], any>
          /^\[\]/.test(afterMatch);              // any[]
        
        if (isTypeContext) {
          locations.push({
            file: filePath,
            line: lineIndex + 1,
            column: match.index + 1,
            context: line.trim()
          });
        }
      }
    }
  } catch (error) {
    // 파일 읽기 실패 시 무시
  }
  
  return locations;
}

/**
 * any 타입 개수 측정
 * 
 * @param files - 검사할 파일 경로 배열
 * @returns 측정 결과
 */
function countAnyTypes(files: string[]): CountResult {
  const locations: AnyTypeLocation[] = [];
  const byFile = new Map<string, number>();
  
  for (const file of files) {
    const fileLocations = findAnyTypes(file);
    locations.push(...fileLocations);
    
    if (fileLocations.length > 0) {
      byFile.set(file, fileLocations.length);
    }
  }
  
  return {
    total: locations.length,
    locations,
    byFile
  };
}

/**
 * 결과 출력
 * 
 * @param result - 측정 결과
 * @param target - 목표 개수
 * @param projectRoot - 프로젝트 루트 경로
 */
function printResults(
  result: CountResult,
  target: number,
  projectRoot: string
): void {
  console.log('\n📊 any 타입 개수 측정 결과\n');
  console.log(`현재 개수: ${result.total}개`);
  console.log(`목표 개수: ${target}개 이하`);
  
  const diff = result.total - target;
  if (diff > 0) {
    console.log(`⚠️  목표 대비: ${diff}개 초과\n`);
  } else {
    console.log(`✅ 목표 달성: ${Math.abs(diff)}개 여유\n`);
  }
  
  // 파일별 통계
  if (result.byFile.size > 0) {
    console.log('📁 파일별 any 타입 개수 (상위 10개):');
    const sortedFiles = Array.from(result.byFile.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    for (const [file, count] of sortedFiles) {
      const relativePath = relative(projectRoot, file);
      console.log(`   ${relativePath}: ${count}개`);
    }
    console.log('');
  }
  
  // 통계
  console.log('📈 통계:');
  console.log(`   검사된 파일 수: ${result.locations.length > 0 ? result.byFile.size : 0}개`);
  console.log(`   총 any 타입 개수: ${result.total}개`);
  console.log('');
}

/**
 * 메인 함수
 */
async function main(): Promise<void> {
  const options = parseArgs();
  const projectRoot = process.cwd();
  const directory = options.directory || 'src/';
  const exclude = options.exclude || ['**/node_modules/**', '**/dist/**', '**/*.d.ts'];
  const target = options.target || 50;

  try {
    // 파일 검색
    console.log(`🔍 파일 검색 중... (디렉토리: ${directory})`);
    const files = await findFiles(directory, exclude);
    
    if (files.length === 0) {
      console.log('⚠️  검사할 파일이 없습니다.');
      process.exit(0);
    }

    console.log(`   발견된 파일: ${files.length}개\n`);

    // any 타입 개수 측정
    console.log('🔎 any 타입 검색 중...');
    const result = countAnyTypes(files);

    // 결과 출력
    printResults(result, target, projectRoot);

    // CI 모드: exit code 처리
    if (options.ci) {
      if (result.total > target) {
        console.log(`❌ CI 실패: any 타입이 ${result.total}개로 목표(${target}개)를 초과했습니다.`);
        process.exit(1);
      } else {
        console.log(`✅ CI 통과: any 타입이 ${result.total}개로 목표(${target}개) 이하입니다.`);
        process.exit(0);
      }
    } else {
      // 일반 모드: 정보만 출력
      if (result.total > target) {
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
if (isMain(import.meta.url)) {
  main().catch(error => {
    console.error('❌ 치명적 오류:', error);
    process.exit(1);
  });
}

