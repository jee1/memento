#!/usr/bin/env node
/**
 * console.log 개수 측정 스크립트
 * 
 * PRD 0017: 코드 품질 개선 - 로깅 일원화
 * 
 * 사용법:
 *   tsx scripts/count-console-logs.ts
 *   tsx scripts/count-console-logs.ts --ci
 *   tsx scripts/count-console-logs.ts --core-only
 *   tsx scripts/count-console-logs.ts --directory src/
 * 
 * 목표:
 *   - 핵심 모듈 console.log 0개
 *   - 전체 console.log 단계적 감소
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
  coreOnly?: boolean;
  directory?: string;
  exclude?: string[];
  target?: number;
  allowSoftFail?: boolean;
  format?: 'json' | 'csv' | 'text';
}

/**
 * console.* 발견 위치
 */
interface ConsoleLogLocation {
  file: string;
  line: number;
  column: number;
  method: string; // log, error, warn, info, debug
  context: string;
}

/**
 * 파일별 결과
 */
interface FileResult {
  file: string;
  count: number;
  priority: number;
  isCore: boolean;
  methods: Record<string, number>;
}

/**
 * 측정 결과
 */
interface CountResult {
  total: number;
  coreTotal: number;
  locations: ConsoleLogLocation[];
  byFile: Map<string, number>;
  byMethod: Map<string, number>;
  files: FileResult[];
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
    } else if (arg === '--core-only') {
      options.coreOnly = true;
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
    } else if (arg === '--format' && args[i + 1]) {
      const format = args[i + 1].toLowerCase();
      if (format === 'json' || format === 'csv' || format === 'text') {
        options.format = format as 'json' | 'csv' | 'text';
      }
      i++;
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
console.log 개수 측정 스크립트

사용법:
  tsx scripts/count-console-logs.ts [options]

옵션:
  --ci                    CI 모드 (실패 시 exit code 1 반환)
  --core-only             핵심 모듈만 검사 (src/server/, src/services/, src/domains/)
  --directory <path>      검사할 디렉토리 (기본값: src/)
  --exclude <pattern>     제외할 파일 패턴 (여러 번 사용 가능)
  --target <number>       목표 개수 (기본값: 핵심 모듈 0개, 전체 200개)
  --format <format>       출력 형식: json, csv, text (기본값: text)
  --allow-soft-fail       CI 모드에서 경고만 출력하고 통과
  --help, -h              도움말 출력

예제:
  tsx scripts/count-console-logs.ts
  tsx scripts/count-console-logs.ts --ci
  tsx scripts/count-console-logs.ts --core-only
  tsx scripts/count-console-logs.ts --directory src/ --exclude "**/*.spec.ts"
`);
}

/**
 * 핵심 모듈인지 확인
 * src/server/, src/services/, src/domains/ 디렉토리 포함
 */
function isCoreModule(filePath: string): boolean {
  return filePath.includes('src/server/') || 
         filePath.includes('src/services/') || 
         filePath.includes('src/domains/');
}

/**
 * 테스트 파일인지 확인
 */
function isTestFile(filePath: string): boolean {
  return filePath.endsWith('.spec.ts') || 
         filePath.includes('test-') || 
         filePath.includes('/test/') ||
         filePath.includes('/__tests__/');
}

/**
 * CLI 스크립트인지 확인
 */
function isCliScript(filePath: string): boolean {
  return filePath.includes('scripts/');
}

/**
 * 패턴 매칭
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
 * 파일에서 console.* 찾기
 */
function findConsoleLogs(filePath: string): ConsoleLogLocation[] {
  const locations: ConsoleLogLocation[] = [];
  
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    // console.log, console.error, console.warn, console.info, console.debug 패턴
    const consolePattern = /console\.(log|error|warn|info|debug)\s*\(/g;
    
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      
      // 주석 제외
      if (line.trim().startsWith('//')) {
        continue;
      }
      
      // 문자열 내부 제외 (간단한 휴리스틱)
      const inString = (line.match(/['"]/g) || []).length % 2 === 1;
      if (inString) {
        continue;
      }
      
      // console.* 패턴 검색
      let match;
      while ((match = consolePattern.exec(line)) !== null) {
        locations.push({
          file: filePath,
          line: lineIndex + 1,
          column: match.index + 1,
          method: match[1],
          context: line.trim()
        });
      }
    }
  } catch (error) {
    // 파일 읽기 실패 시 무시
  }
  
  return locations;
}

/**
 * console.log 개수 측정
 */
function countConsoleLogs(files: string[], coreOnly: boolean): CountResult {
  const locations: ConsoleLogLocation[] = [];
  const byFile = new Map<string, number>();
  const byMethod = new Map<string, number>();
  const fileMethods = new Map<string, Map<string, number>>();
  
  for (const file of files) {
    // 테스트 파일과 CLI 스크립트는 제외
    if (isTestFile(file) || isCliScript(file)) {
      continue;
    }
    
    // 핵심 모듈만 검사하는 경우
    if (coreOnly && !isCoreModule(file)) {
      continue;
    }
    
    const fileLocations = findConsoleLogs(file);
    locations.push(...fileLocations);
    
    if (fileLocations.length > 0) {
      byFile.set(file, fileLocations.length);
      
      const methods = new Map<string, number>();
      for (const loc of fileLocations) {
        const count = byMethod.get(loc.method) || 0;
        byMethod.set(loc.method, count + 1);
        
        const fileMethodCount = methods.get(loc.method) || 0;
        methods.set(loc.method, fileMethodCount + 1);
      }
      fileMethods.set(file, methods);
    }
  }
  
  // 핵심 모듈 개수 계산
  const coreLocations = locations.filter(loc => isCoreModule(loc.file));
  
  // 파일별 결과 생성 (우선순위 산출)
  const fileResults: FileResult[] = Array.from(byFile.entries())
    .map(([file, count]) => {
      const methods = fileMethods.get(file) || new Map<string, number>();
      const methodsObj: Record<string, number> = {};
      methods.forEach((value, key) => {
        methodsObj[key] = value;
      });
      
      return {
        file,
        count,
        priority: count, // 우선순위는 개수와 동일 (많을수록 높은 우선순위)
        isCore: isCoreModule(file),
        methods: methodsObj
      };
    })
    .sort((a, b) => b.priority - a.priority); // 우선순위 내림차순 정렬
  
  return {
    total: locations.length,
    coreTotal: coreLocations.length,
    locations,
    byFile,
    byMethod,
    files: fileResults
  };
}

/**
 * JSON 형식으로 결과 출력
 */
function printResultsJSON(result: CountResult, projectRoot: string): void {
  const output = {
    total: result.total,
    coreTotal: result.coreTotal,
    files: result.files.map(f => ({
      file: relative(projectRoot, f.file),
      count: f.count,
      priority: f.priority,
      isCore: f.isCore,
      methods: f.methods
    })),
    byMethod: Object.fromEntries(result.byMethod),
    timestamp: new Date().toISOString()
  };
  
  console.log(JSON.stringify(output, null, 2));
}

/**
 * CSV 형식으로 결과 출력
 */
function printResultsCSV(result: CountResult, projectRoot: string): void {
  // CSV 헤더
  console.log('file,count,priority,isCore,methods');
  
  // 파일별 데이터
  for (const file of result.files) {
    const relativePath = relative(projectRoot, file.file);
    const methodsStr = Object.entries(file.methods)
      .map(([method, count]) => `${method}:${count}`)
      .join(';');
    console.log(`${relativePath},${file.count},${file.priority},${file.isCore},"${methodsStr}"`);
  }
}

/**
 * 텍스트 형식으로 결과 출력
 */
function printResultsText(
  result: CountResult,
  target: number,
  coreTarget: number,
  projectRoot: string,
  coreOnly: boolean
): void {
  console.log('\n📊 console.log 개수 측정 결과\n');
  
  if (coreOnly) {
    console.log(`핵심 모듈 console.* 개수: ${result.coreTotal}개`);
    console.log(`목표 개수: ${coreTarget}개 이하`);
    
    if (result.coreTotal > coreTarget) {
      console.log(`⚠️  목표 대비: ${result.coreTotal - coreTarget}개 초과\n`);
    } else {
      console.log(`✅ 목표 달성\n`);
    }
  } else {
    console.log(`전체 console.* 개수: ${result.total}개`);
    console.log(`핵심 모듈 console.* 개수: ${result.coreTotal}개`);
    console.log(`목표 개수: 전체 ${target}개 이하, 핵심 모듈 ${coreTarget}개 이하\n`);
    
    if (result.coreTotal > coreTarget) {
      console.log(`⚠️  핵심 모듈 목표 대비: ${result.coreTotal - coreTarget}개 초과`);
    }
    if (result.total > target) {
      console.log(`⚠️  전체 목표 대비: ${result.total - target}개 초과`);
    }
    console.log('');
  }
  
  // 메서드별 통계
  if (result.byMethod.size > 0) {
    console.log('📈 메서드별 통계:');
    const sortedMethods = Array.from(result.byMethod.entries())
      .sort((a, b) => b[1] - a[1]);
    
    for (const [method, count] of sortedMethods) {
      console.log(`   console.${method}: ${count}개`);
    }
    console.log('');
  }
  
  // 파일별 통계 (상위 10개)
  if (result.byFile.size > 0) {
    console.log('📁 파일별 console.* 개수 (상위 10개):');
    const sortedFiles = Array.from(result.byFile.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    for (const [file, count] of sortedFiles) {
      const relativePath = relative(projectRoot, file);
      const isCore = isCoreModule(file);
      const marker = isCore ? '🔴' : '  ';
      console.log(`   ${marker} ${relativePath}: ${count}개`);
    }
    console.log('');
  }
  
  // 핵심 모듈 파일 목록
  if (!coreOnly && result.coreTotal > 0) {
    const coreFiles = Array.from(result.byFile.entries())
      .filter(([file]) => isCoreModule(file))
      .sort((a, b) => b[1] - a[1]);
    
    if (coreFiles.length > 0) {
      console.log('🔴 핵심 모듈 파일 목록:');
      for (const [file, count] of coreFiles) {
        const relativePath = relative(projectRoot, file);
        console.log(`   ${relativePath}: ${count}개`);
      }
      console.log('');
    }
  }
}

/**
 * 결과 출력 (형식에 따라 분기)
 */
function printResults(
  result: CountResult,
  target: number,
  coreTarget: number,
  projectRoot: string,
  coreOnly: boolean,
  format: 'json' | 'csv' | 'text' = 'text'
): void {
  if (format === 'json') {
    printResultsJSON(result, projectRoot);
  } else if (format === 'csv') {
    printResultsCSV(result, projectRoot);
  } else {
    printResultsText(result, target, coreTarget, projectRoot, coreOnly);
  }
}

/**
 * 메인 함수
 */
async function main(): Promise<void> {
  const options = parseArgs();
  const projectRoot = process.cwd();
  const directory = options.directory || 'src/';
  const exclude = options.exclude || ['**/node_modules/**', '**/dist/**', '**/*.d.ts'];
  const coreTarget = 0; // 핵심 모듈은 항상 0개 목표
  const target = options.target || (options.coreOnly ? 0 : 200);

  try {
    // 파일 검색
    const searchDir = options.coreOnly ? 'src/' : directory;
    console.log(`🔍 파일 검색 중... (디렉토리: ${searchDir}${options.coreOnly ? ', 핵심 모듈만' : ''})`);
    const files = await findFiles(searchDir, exclude);
    
    if (files.length === 0) {
      console.log('⚠️  검사할 파일이 없습니다.');
      process.exit(0);
    }

    console.log(`   발견된 파일: ${files.length}개\n`);

    // console.log 개수 측정
    console.log('🔎 console.* 검색 중...');
    const result = countConsoleLogs(files, options.coreOnly || false);

    // 결과 출력
    const format = options.format || 'text';
    printResults(result, target, coreTarget, projectRoot, options.coreOnly || false, format);

    // CI 모드: exit code 처리
    if (options.ci) {
      const failed = options.coreOnly 
        ? result.coreTotal > coreTarget
        : result.coreTotal > coreTarget || result.total > target;
      
      if (failed) {
        if (options.coreOnly) {
          console.log(`❌ CI 실패: 핵심 모듈 console.*가 ${result.coreTotal}개로 목표(${coreTarget}개)를 초과했습니다.`);
        } else {
          console.log(`❌ CI 실패: 전체 ${result.total}개, 핵심 모듈 ${result.coreTotal}개로 목표를 초과했습니다.`);
        }
        process.exit(1);
      } else {
        console.log(`✅ CI 통과: 목표를 달성했습니다.`);
        process.exit(0);
      }
    } else {
      // 일반 모드: 정보만 출력
      if (result.coreTotal > coreTarget || result.total > target) {
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

