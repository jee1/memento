#!/usr/bin/env node
import { isMain, parseArgs as parseCliArgs } from './lib/cli.js';
/**
 * SQL Injection 취약점 검사 스크립트
 * 
 * PRD 0019: 보안 강화 (Phase 1) - SQL Injection 방지
 * 
 * 사용법:
 *   tsx scripts/check-sql-injection.ts
 *   tsx scripts/check-sql-injection.ts --ci
 *   tsx scripts/check-sql-injection.ts --directory src/
 * 
 * 목표:
 *   - 모든 동적 쿼리가 파라미터 바인딩으로 전환됨
 *   - SQL Injection 취약점 0개
 *   - CI/CD 통합 가능
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { readdir } from 'fs/promises';
import { join, relative } from 'path';

/**
 * CLI 옵션
 */
interface CliOptions {
  ci?: boolean;
  directory?: string;
  exclude?: string[];
  updateBaseline?: boolean;
}

/**
 * 검토를 마친 기존 탐지 목록. 이 검사는 줄 단위 휴리스틱이라 `?`·`@param` 조각이나
 * 고정 테이블명을 보간하는 안전한 코드도 잡는다. 기준선에 없는 새 탐지만 CI 를 깨뜨린다.
 */
const BASELINE_PATH = 'scripts/sql-injection-baseline.json';

/**
 * SQL Injection 취약점 발견 위치
 */
export interface SqlInjectionLocation {
  file: string;
  line: number;
  column: number;
  pattern: string; // 발견된 패턴 종류
  context: string; // 해당 라인 내용
  severity: 'high' | 'medium' | 'low'; // 심각도
}

/**
 * 검사 결과
 */
interface CheckResult {
  total: number;
  locations: SqlInjectionLocation[];
  byFile: Map<string, SqlInjectionLocation[]>;
  byPattern: Map<string, number>;
}

/**
 * 명령줄 인자 파싱
 */
function parseArgs(): CliOptions {
  const args = parseCliArgs().args;
  const options: CliOptions = {
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.d.ts', '**/*.spec.ts']
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--ci') {
      options.ci = true;
    } else if (arg === '--update-baseline') {
      options.updateBaseline = true;
    } else if (arg === '--directory' && args[i + 1]) {
      options.directory = args[i + 1];
      i++;
    } else if (arg === '--exclude' && args[i + 1]) {
      if (!options.exclude) {
        options.exclude = [];
      }
      options.exclude.push(args[i + 1]);
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
SQL Injection 취약점 검사 스크립트

사용법:
  tsx scripts/check-sql-injection.ts [options]

옵션:
  --ci                    CI 모드 (취약점 발견 시 exit code 1 반환)
  --directory <path>      검사할 디렉토리 (기본값: packages)
  --update-baseline       현재 탐지를 검토 완료로 ${BASELINE_PATH} 에 기록
  --exclude <pattern>     제외할 파일 패턴 (여러 번 사용 가능)
  --help, -h              도움말 출력

예제:
  tsx scripts/check-sql-injection.ts
  tsx scripts/check-sql-injection.ts --ci
  tsx scripts/check-sql-injection.ts --directory src/
`);
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
      const entries = await readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        
        if (shouldExclude(fullPath, exclude)) {
          continue;
        }
        
        if (entry.isDirectory()) {
          await walkDir(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
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
 * SQL Injection 취약점 패턴 검색
 * 
 * 검색하는 패턴:
 * 1. 문자열 연결을 통한 SQL 쿼리 생성: sql +=, query +=, sql = sql +
 * 2. 템플릿 리터럴로 동적 테이블명/컬럼명: FROM ${, JOIN ${, WHERE ${ (일부는 허용 가능)
 * 3. 파라미터 바인딩 미사용: '...' + variable, "..." + variable
 */
export function findSqlInjectionPatterns(filePath: string): SqlInjectionLocation[] {
  let lines: string[];
  try {
    lines = readFileSync(filePath, 'utf-8').split('\n');
  } catch {
    return []; // 파일 읽기 실패 시 무시
  }

  const locations: SqlInjectionLocation[] = [];
  lines.forEach((line, lineIndex) => {
    const trimmedLine = line.trim();
    // 주석 제외
    if (trimmedLine.startsWith('//') || trimmedLine.startsWith('*')) return;
    // SQL 관련 키워드가 있는 라인만 검사 (성능 최적화)
    if (!/sql|query|SELECT|INSERT|UPDATE|DELETE|FROM|JOIN|WHERE/i.test(line)) return;

    const scan: LineScan = { line, lineIndex, lines };
    const found = [
      ...findStringConcatenation(scan),
      ...findDynamicTableName(scan),
      ...findWhereTemplateLiteral(scan),
      ...findSqlStringConcatenation(scan),
    ];
    for (const { column, pattern, severity } of found) {
      locations.push({ file: filePath, line: lineIndex + 1, column, pattern, context: trimmedLine, severity });
    }
  });
  return locations;
}

interface LineScan {
  line: string;
  lineIndex: number;
  lines: string[];
}

type Finding = Pick<SqlInjectionLocation, 'column' | 'pattern' | 'severity'>;

/** 매치 앞의 따옴표 수가 홀수면 문자열 안이다 (false positive 제거). */
function isInsideString(line: string, index: number): boolean {
  return (line.substring(0, index).match(/['"]/g) || []).length % 2 === 1;
}

/** 문자열 밖에 있는 매치만 돌려준다. */
function codeMatches(line: string, pattern: RegExp): RegExpMatchArray[] {
  return [...line.matchAll(pattern)].filter(match => !isInsideString(line, match.index!));
}

/** `lineIndex` 바로 위부터 `distance` 줄 위까지 (가까운 줄부터) */
function linesAbove(lineIndex: number, distance: number): number[] {
  const indexes: number[] = [];
  for (let i = lineIndex - 1; i >= Math.max(0, lineIndex - distance); i--) indexes.push(i);
  return indexes;
}

/** 첫 번째 `${name}` 의 name */
const firstInterpolatedVar = (line: string) => line.match(/\$\{(\w+)\}/)?.[1];

/** 패턴 1: 문자열 연결로 SQL 생성 (sql +=, query = ... +) */
function findStringConcatenation({ line, lineIndex, lines }: LineScan): Finding[] {
  return codeMatches(line, /\b(sql|query|stmt|statement)\s*([+]=|=.*\+)/gi)
    .filter(match => {
      // 정적 문자열 연결은 허용 (예: query += ' ORDER BY ...'). 변수나 템플릿 리터럴이 있을 때만 감지
      const afterMatch = line.substring(match.index! + match[0].length);
      if (!/\$\{|\+\s*\w+/.test(afterMatch)) return false;
      // conditions.join(' AND ') 은 이미 파라미터 바인딩을 포함한다
      if (line.includes('conditions.join') && line.includes('AND')) return false;
      // placeholders 는 '?' 로만 구성된다
      if (line.includes('placeholders') && line.includes('IN (')) return false;
      // reflectionNotesLike 는 buildReflectionNotesSearchCondition() 이 '?' 와 함께 만든다
      return !(line.includes('reflectionNotesLike') && isSafeReflectionNotesLike(line, lineIndex, lines));
    })
    .map(match => ({ column: match.index! + 1, pattern: 'string-concatenation', severity: 'high' }));
}

function isSafeReflectionNotesLike(line: string, lineIndex: number, lines: string[]): boolean {
  if (line.includes('?')) return true;
  return linesAbove(lineIndex, 5).some(i =>
    lines[i].includes('buildReflectionNotesSearchCondition') ||
    (lines[i].includes('reflectionNotesLike') && lines[i].includes('?'))
  );
}

/** 패턴 2: FROM ${ / JOIN ${ — 동적 테이블명 */
function findDynamicTableName({ line, lineIndex, lines }: LineScan): Finding[] {
  const varName = firstInterpolatedVar(line);
  return codeMatches(line, /\b(FROM|JOIN|DELETE FROM)\s+\$\{/gi)
    .filter(() => !(varName && isValidatedTableVar(lines, lineIndex, varName)))
    .map(match => ({ column: match.index! + 1, pattern: 'dynamic-table-name', severity: 'medium' }));
}

/**
 * 같은 파일에서 최대 300줄 위까지 테이블명 변수가 화이트리스트 검증을 거쳤는지 찾는다.
 * 규칙 하나라도 맞으면 허용한다.
 */
function isValidatedTableVar(lines: string[], lineIndex: number, varName: string): boolean {
  const validateCall = new RegExp(`validateTableName\\(${varName}\\)|validateTableName\\(.*${varName}`);
  const assignment = new RegExp(`${varName}\\s*=|const\\s+${varName}\\s*=|let\\s+${varName}\\s*=`);
  return linesAbove(lineIndex, 300).some(i => {
    const prevLine = lines[i];
    // 바로 위 줄이거나, 다음 줄에 변수가 쓰인다
    const feedsVar = i === lineIndex - 1 || lines[i + 1].includes(varName);
    return (
      validateCall.test(prevLine) ||
      // const tableName = this.getTableName(...) 등
      (prevLine.includes(varName) &&
        /getTableName|getVectorTableName|getValidatedVectorTableName/.test(prevLine) &&
        assignment.test(prevLine)) ||
      (/this\.getTableName|this\.getVectorTableName/.test(prevLine) && feedsVar) ||
      (/getVectorTableName\(|getValidatedVectorTableName\(/.test(prevLine) && feedsVar) ||
      // sqlite_master 에서 가져온 값
      (varName.includes('Table') && prevLine.includes('sqlite_master')) ||
      // 하드코딩된 기본값: ?? 'memory_item_vec_tfidf'
      (prevLine.includes('??') && prevLine.includes('memory_item_vec')) ||
      prevLine.includes('VECTOR_SEARCH_CONFIG.tableNames') ||
      // sqlite_master 에서 가져온 table.name
      prevLine.includes('table.name')
    );
  });
}

/** 패턴 3: WHERE 절의 템플릿 리터럴. 같은 줄에 '?' 플레이스홀더가 있으면 허용 */
function findWhereTemplateLiteral({ line }: LineScan): Finding[] {
  if (line.includes('?')) return [];
  // conditions.join(' AND ') 은 파라미터 바인딩을 포함하고, config.filter 는 하드코딩 값이다
  if (line.includes('conditions.join') && line.includes('AND')) return [];
  if (line.includes('config.filter')) return [];
  // ${placeholders} 는 '?,?,?' 로만 구성된다
  if (firstInterpolatedVar(line) === 'placeholders' && line.includes('IN (')) return [];
  return codeMatches(line, /WHERE.*\$\{/gi)
    .map(match => ({ column: match.index! + 1, pattern: 'where-template-literal', severity: 'high' }));
}

/** 패턴 4: 'SELECT ... ' + variable */
function findSqlStringConcatenation({ line }: LineScan): Finding[] {
  return codeMatches(line, /(['"])\s*(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE).*?\1\s*\+\s*\w+/gi)
    .map(match => ({ column: match.index! + 1, pattern: 'sql-string-concatenation', severity: 'high' }));
}

/**
 * SQL Injection 취약점 검사
 */
function checkSqlInjection(files: string[]): CheckResult {
  return summarize(files.flatMap(findSqlInjectionPatterns));
}

function summarize(locations: SqlInjectionLocation[]): CheckResult {
  const byFile = new Map<string, SqlInjectionLocation[]>();
  const byPattern = new Map<string, number>();

  for (const loc of locations) {
    byFile.set(loc.file, [...(byFile.get(loc.file) ?? []), loc]);
    byPattern.set(loc.pattern, (byPattern.get(loc.pattern) ?? 0) + 1);
  }

  return {
    total: locations.length,
    locations,
    byFile,
    byPattern
  };
}

/** 줄 번호가 밀려도 같은 탐지로 보도록 파일·패턴·코드 줄로 식별한다. */
function baselineKey(loc: SqlInjectionLocation, projectRoot: string): string {
  return `${relative(projectRoot, loc.file)}|${loc.pattern}|${loc.context}`;
}

function readBaseline(): string[] {
  return existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as string[] : [];
}

/** 기준선에 있는 탐지를 뺀다. 같은 줄이 여러 번 나오면 기록된 횟수만큼만 뺀다. */
export function withoutBaseline(
  locations: SqlInjectionLocation[],
  projectRoot: string,
  baseline: readonly string[],
): SqlInjectionLocation[] {
  const remaining = new Map<string, number>();
  for (const key of baseline) {
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  return locations.filter((loc) => {
    const key = baselineKey(loc, projectRoot);
    const left = remaining.get(key) ?? 0;
    if (left === 0) return true;
    remaining.set(key, left - 1);
    return false;
  });
}

/**
 * 결과 출력
 */
function printResults(
  result: CheckResult,
  projectRoot: string
): void {
  console.log('\n🔍 SQL Injection 취약점 검사 결과\n');
  
  if (result.total === 0) {
    console.log('✅ SQL Injection 취약점이 발견되지 않았습니다.\n');
    return;
  }
  
  console.log(`⚠️  발견된 취약점: ${result.total}개\n`);
  
  // 패턴별 통계
  if (result.byPattern.size > 0) {
    console.log('📈 패턴별 통계:');
    const sortedPatterns = Array.from(result.byPattern.entries())
      .sort((a, b) => b[1] - a[1]);
    
    const patternNames: Record<string, string> = {
      'string-concatenation': '문자열 연결을 통한 쿼리 생성',
      'dynamic-table-name': '동적 테이블명 사용 (템플릿 리터럴)',
      'where-template-literal': 'WHERE 절 템플릿 리터럴 (파라미터 바인딩 없음)',
      'sql-string-concatenation': 'SQL 문자열 연결 (파라미터 바인딩 미사용)'
    };
    
    for (const [pattern, count] of sortedPatterns) {
      const name = patternNames[pattern] || pattern;
      console.log(`   ${name}: ${count}개`);
    }
    console.log('');
  }
  
  // 파일별 상세 정보
  console.log('📁 파일별 취약점 목록:\n');
  const sortedFiles = Array.from(result.byFile.entries())
    .sort((a, b) => b[1].length - a[1].length);
  
  for (const [file, locations] of sortedFiles) {
    const relativePath = relative(projectRoot, file);
    console.log(`   ${relativePath} (${locations.length}개):`);
    
    for (const loc of locations) {
      const severityIcon = loc.severity === 'high' ? '🔴' : loc.severity === 'medium' ? '🟡' : '🟢';
      console.log(`      ${severityIcon} 라인 ${loc.line}:${loc.column} - ${loc.pattern}`);
      console.log(`         ${loc.context.substring(0, 80)}${loc.context.length > 80 ? '...' : ''}`);
    }
    console.log('');
  }
  
  console.log('💡 권장 사항:');
  console.log('   - 모든 사용자 입력값은 파라미터 바인딩(?) 사용');
  console.log('   - 동적 테이블명은 화이트리스트 검증 후 사용');
  console.log('   - 문자열 연결 대신 템플릿 리터럴 + 파라미터 바인딩 사용\n');
}

/**
 * 메인 함수
 */
async function main(): Promise<void> {
  const options = parseArgs();
  const projectRoot = process.cwd();
  const directory = options.directory || 'packages';
  const exclude = options.exclude || ['**/node_modules/**', '**/dist/**', '**/*.d.ts', '**/*.spec.ts'];

  try {
    // 파일 검색
    console.log(`🔍 파일 검색 중... (디렉토리: ${directory})`);
    const files = await findFiles(directory, exclude);
    
    if (files.length === 0) {
      // 빈 검사가 통과로 보이지 않게 CI 에서는 실패시킨다 (코드가 옮겨지면 여기서 드러난다).
      console.log('⚠️  검사할 파일이 없습니다.');
      process.exit(options.ci ? 1 : 0);
    }

    console.log(`   발견된 파일: ${files.length}개\n`);

    // SQL Injection 취약점 검사
    console.log('🔎 SQL Injection 취약점 검사 중...');
    const all = checkSqlInjection(files);
    if (options.updateBaseline) {
      const keys = all.locations.map((loc) => baselineKey(loc, projectRoot)).sort();
      writeFileSync(BASELINE_PATH, `${JSON.stringify(keys, null, 2)}\n`);
      console.log(`📝 기준선 갱신: ${keys.length}건 → ${BASELINE_PATH}`);
      return;
    }
    const result = summarize(withoutBaseline(all.locations, projectRoot, readBaseline()));
    if (all.total > result.total) {
      console.log(`   기준선(검토 완료) 제외: ${all.total - result.total}건`);
    }

    // 결과 출력
    printResults(result, projectRoot);

    // CI 모드: exit code 처리
    if (options.ci) {
      if (result.total > 0) {
        console.log(`❌ CI 실패: SQL Injection 취약점 ${result.total}개가 발견되었습니다.`);
        process.exit(1);
      } else {
        console.log(`✅ CI 통과: SQL Injection 취약점이 없습니다.`);
        process.exit(0);
      }
    } else {
      // 일반 모드: 정보만 출력
      if (result.total > 0) {
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

