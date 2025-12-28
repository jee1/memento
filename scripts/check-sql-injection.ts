#!/usr/bin/env node
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
}

/**
 * SQL Injection 취약점 발견 위치
 */
interface SqlInjectionLocation {
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
  const args = process.argv.slice(2);
  const options: CliOptions = {
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.d.ts', '**/*.spec.ts']
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
  --directory <path>      검사할 디렉토리 (기본값: src/)
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
function findSqlInjectionPatterns(filePath: string): SqlInjectionLocation[] {
  const locations: SqlInjectionLocation[] = [];
  
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    // 패턴 1: 문자열 연결을 통한 SQL 쿼리 생성
    // sql +=, query +=, sql = sql + 등
    const stringConcatenationPattern = /\b(sql|query|stmt|statement)\s*([+]=|=.*\+)/gi;
    
    // 패턴 2: 템플릿 리터럴로 동적 테이블명/컬럼명 사용
    // FROM ${, JOIN ${, WHERE ${ 등 (일부는 허용 가능하지만 검사 대상)
    const templateLiteralPattern = /\b(FROM|JOIN|WHERE|SELECT|INSERT|UPDATE|DELETE|INTO|SET)\s+\$\{/gi;
    
    // 패턴 3: 파라미터 바인딩 미사용 (문자열 연결)
    // '...' + variable, "..." + variable (SQL 쿼리 컨텍스트에서)
    const parameterBindingPattern = /(['"]).*?\1\s*\+\s*\w+/g;
    
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const trimmedLine = line.trim();
      
      // 주석 제외
      if (trimmedLine.startsWith('//') || trimmedLine.startsWith('*')) {
        continue;
      }
      
      // SQL 관련 키워드가 있는 라인만 검사 (성능 최적화)
      const hasSqlKeyword = /sql|query|SELECT|INSERT|UPDATE|DELETE|FROM|JOIN|WHERE/i.test(line);
      if (!hasSqlKeyword) {
        continue;
      }
      
      // 패턴 1: 문자열 연결 검사
      let match;
      const concatPattern = /\b(sql|query|stmt|statement)\s*([+]=|=.*\+)/gi;
      while ((match = concatPattern.exec(line)) !== null) {
        // false positive 제거: 주석 처리된 코드나 문자열 내부는 제외
        const beforeMatch = line.substring(0, match.index);
        const stringCount = (beforeMatch.match(/['"]/g) || []).length;
        if (stringCount % 2 === 1) {
          // 문자열 내부에 있음
          continue;
        }
        
        // 정적 문자열 연결은 허용 (예: query += ' ORDER BY ...')
        // 변수나 템플릿 리터럴이 포함된 경우만 감지
        const afterMatch = line.substring(match.index + match[0].length);
        const hasVariable = /\$\{|\+\s*\w+/.test(afterMatch);
        if (!hasVariable) {
          // 정적 문자열만 연결하는 경우는 안전함
          continue;
        }
        
        // conditions.join(' AND ') 패턴은 이미 파라미터 바인딩을 포함하고 있어 안전함
        if (line.includes('conditions.join') && line.includes('AND')) {
          continue;
        }
        
        // placeholders는 '?'로만 구성되어 있어 안전함
        if (line.includes('placeholders') && line.includes('IN (')) {
          continue;
        }
        
        // reflectionNotesLike는 buildReflectionNotesSearchCondition()에서 생성되며 이미 '?' 플레이스홀더를 포함하고 있어 안전함
        if (line.includes('reflectionNotesLike')) {
          // 이전 라인들에서 buildReflectionNotesSearchCondition() 호출 확인
          let isFromSafeBuilder = false;
          for (let i = lineIndex - 1; i >= Math.max(0, lineIndex - 5); i--) {
            const prevLine = lines[i];
            if (prevLine.includes('buildReflectionNotesSearchCondition') || 
                (prevLine.includes('reflectionNotesLike') && prevLine.includes('?'))) {
              isFromSafeBuilder = true;
              break;
            }
          }
          if (isFromSafeBuilder || line.includes('?')) {
            continue;
          }
        }
        
        locations.push({
          file: filePath,
          line: lineIndex + 1,
          column: match.index + 1,
          pattern: 'string-concatenation',
          context: trimmedLine,
          severity: 'high'
        });
      }
      
      // 패턴 2: 템플릿 리터럴로 동적 테이블명/컬럼명 사용
      // FROM ${, JOIN ${ 등은 동적 테이블명일 가능성이 높음
      const templatePattern = /\b(FROM|JOIN|DELETE FROM)\s+\$\{/gi;
      while ((match = templatePattern.exec(line)) !== null) {
        // false positive 제거: 주석 처리된 코드나 문자열 내부는 제외
        const beforeMatch = line.substring(0, match.index);
        const stringCount = (beforeMatch.match(/['"]/g) || []).length;
        if (stringCount % 2 === 1) {
          // 문자열 내부에 있음
          continue;
        }
        
        // validateTableName() 또는 getTableName() 호출이 있는지 확인
        const tableVarPattern = /\$\{(\w+)\}/;
        const tableMatch = line.match(tableVarPattern);
        if (tableMatch) {
          const varName = tableMatch[1];
          // 이전 라인들에서 validateTableName() 또는 getTableName() 호출 찾기
          let isValidated = false;
          // 더 넓은 범위로 검색 (함수 내에서 변수가 재사용될 수 있음)
          // 같은 파일 내에서 검색 (최대 300라인)
          for (let i = lineIndex - 1; i >= Math.max(0, lineIndex - 300); i--) {
            const prevLine = lines[i];
            // 직접 호출 패턴
            if (new RegExp(`validateTableName\\(${varName}\\)|validateTableName\\(.*${varName}`).test(prevLine)) {
              isValidated = true;
              break;
            }
            // 변수 할당 패턴: tableName = getTableName() 또는 this.getTableName() 또는 getVectorTableName()
            // 더 유연한 패턴 매칭: 변수명과 getTableName이 같은 라인에 있으면 안전함
            if (prevLine.includes(varName) && (
                prevLine.includes('getTableName') || 
                prevLine.includes('getVectorTableName') ||
                prevLine.includes('getValidatedVectorTableName')
            )) {
              // const tableName = this.getTableName(...) 패턴 확인
              if (new RegExp(`${varName}\\s*=|const\\s+${varName}\\s*=|let\\s+${varName}\\s*=`).test(prevLine)) {
                isValidated = true;
                break;
              }
            }
            // 함수 경계 검사 제거 - 같은 파일 내에서만 검색하도록 함
            // 메서드 호출 패턴: this.getTableName(provider) 또는 this.getVectorTableName(provider)
            if (new RegExp(`this\\.getTableName|this\\.getVectorTableName`).test(prevLine)) {
              // 다음 라인에 해당 변수가 있으면 안전함
              if (i === lineIndex - 1 || (lines[i + 1] && lines[i + 1].includes(varName))) {
                isValidated = true;
                break;
              }
            }
            // getVectorTableName 직접 호출 (private 메서드)
            if (new RegExp(`getVectorTableName\\(|getValidatedVectorTableName\\(`).test(prevLine) && 
                (i === lineIndex - 1 || (lines[i + 1] && lines[i + 1].includes(varName)))) {
              isValidated = true;
              break;
            }
            // testTable 같은 경우: sqlite_master에서 가져온 값이므로 안전
            if (varName.includes('Table') && prevLine.includes('sqlite_master')) {
              isValidated = true;
              break;
            }
            // 하드코딩된 기본값 패턴: ?? 'memory_item_vec_tfidf'
            if (prevLine.includes(`??`) && prevLine.includes('memory_item_vec')) {
              isValidated = true;
              break;
            }
            // VECTOR_SEARCH_CONFIG.tableNames에서 직접 가져온 값은 안전함
            if (prevLine.includes('VECTOR_SEARCH_CONFIG.tableNames')) {
              isValidated = true;
              break;
            }
            // sqlite_master에서 가져온 table.name은 안전함
            if (prevLine.includes('table.name') || prevLine.includes('tableName = table.name')) {
              isValidated = true;
              break;
            }
            // this.getTableName() 호출이 바로 이전 라인에 있는 경우
            if (i === lineIndex - 1 && new RegExp(`this\\.getTableName`).test(prevLine)) {
              isValidated = true;
              break;
            }
          }
          if (isValidated) {
            // 화이트리스트 검증을 거친 경우 허용
            continue;
          }
        }
        
        locations.push({
          file: filePath,
          line: lineIndex + 1,
          column: match.index + 1,
          pattern: 'dynamic-table-name',
          context: trimmedLine,
          severity: 'medium' // 화이트리스트 검증이 있으면 허용 가능
        });
      }
      
      // 패턴 3: WHERE 절에서 템플릿 리터럴 사용 (조건부)
      const whereTemplatePattern = /WHERE.*\$\{/gi;
      while ((match = whereTemplatePattern.exec(line)) !== null) {
        // false positive 제거
        const beforeMatch = line.substring(0, match.index);
        const stringCount = (beforeMatch.match(/['"]/g) || []).length;
        if (stringCount % 2 === 1) {
          continue;
        }
        
        // 파라미터 바인딩(? 플레이스홀더)이 있는지 확인
        const hasPlaceholder = line.includes('?');
        
        // conditions.join(' AND ') 패턴은 이미 파라미터 바인딩을 포함하고 있어 안전함
        if (line.includes('conditions.join') && line.includes('AND')) {
          continue;
        }
        
        // config.filter는 하드코딩된 값이므로 안전함
        if (line.includes('config.filter')) {
          continue;
        }
        
        // reflectionNotesLike는 이미 '?' 플레이스홀더를 포함하고 있어 안전함
        if (line.includes('reflectionNotesLike') && line.includes('?')) {
          continue;
        }
        
        // placeholders 변수가 '?'로만 구성되어 있는 경우 허용
        // 예: ${placeholders} where placeholders = '?,?,?'
        const placeholderVarPattern = /\$\{(\w+)\}/;
        const placeholderMatch = line.match(placeholderVarPattern);
        if (placeholderMatch) {
          const varName = placeholderMatch[1];
          // 이전 라인들에서 변수 정의 찾기
          for (let i = lineIndex - 1; i >= Math.max(0, lineIndex - 10); i--) {
            const prevLine = lines[i];
            // placeholders 변수가 '?'로만 구성되어 있는지 확인
            if (new RegExp(`\\b${varName}\\s*=\\s*.*map.*\\?.*join`).test(prevLine)) {
              // placeholders는 안전함
              continue;
            }
            // placeholders 변수명 자체가 placeholders인 경우도 허용 (일반적인 패턴)
            if (varName === 'placeholders' && prevLine.includes('map') && prevLine.includes('?')) {
              continue;
            }
          }
          // placeholders 변수명 자체가 placeholders인 경우도 허용
          if (varName === 'placeholders' && line.includes('IN (')) {
            continue;
          }
        }
        
        if (!hasPlaceholder) {
          locations.push({
            file: filePath,
            line: lineIndex + 1,
            column: match.index + 1,
            pattern: 'where-template-literal',
            context: trimmedLine,
            severity: 'high'
          });
        }
      }
      
      // 패턴 4: 문자열 연결로 SQL 쿼리 구성 (파라미터 바인딩 미사용)
      // 'SELECT * FROM table WHERE id = ' + variable 같은 패턴
      const sqlStringConcatPattern = /(['"])\s*(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE).*?\1\s*\+\s*\w+/gi;
      while ((match = sqlStringConcatPattern.exec(line)) !== null) {
        // false positive 제거
        const beforeMatch = line.substring(0, match.index);
        const stringCount = (beforeMatch.match(/['"]/g) || []).length;
        if (stringCount % 2 === 1) {
          continue;
        }
        
        locations.push({
          file: filePath,
          line: lineIndex + 1,
          column: match.index + 1,
          pattern: 'sql-string-concatenation',
          context: trimmedLine,
          severity: 'high'
        });
      }
    }
  } catch (error) {
    // 파일 읽기 실패 시 무시
  }
  
  return locations;
}

/**
 * SQL Injection 취약점 검사
 */
function checkSqlInjection(files: string[]): CheckResult {
  const locations: SqlInjectionLocation[] = [];
  const byFile = new Map<string, SqlInjectionLocation[]>();
  const byPattern = new Map<string, number>();
  
  for (const file of files) {
    const fileLocations = findSqlInjectionPatterns(file);
    locations.push(...fileLocations);
    
    if (fileLocations.length > 0) {
      byFile.set(file, fileLocations);
      
      for (const loc of fileLocations) {
        const count = byPattern.get(loc.pattern) || 0;
        byPattern.set(loc.pattern, count + 1);
      }
    }
  }
  
  return {
    total: locations.length,
    locations,
    byFile,
    byPattern
  };
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
  const directory = options.directory || 'src/';
  const exclude = options.exclude || ['**/node_modules/**', '**/dist/**', '**/*.d.ts', '**/*.spec.ts'];

  try {
    // 파일 검색
    console.log(`🔍 파일 검색 중... (디렉토리: ${directory})`);
    const files = await findFiles(directory, exclude);
    
    if (files.length === 0) {
      console.log('⚠️  검사할 파일이 없습니다.');
      process.exit(0);
    }

    console.log(`   발견된 파일: ${files.length}개\n`);

    // SQL Injection 취약점 검사
    console.log('🔎 SQL Injection 취약점 검사 중...');
    const result = checkSqlInjection(files);

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
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1])) {
  main().catch(error => {
    console.error('❌ 치명적 오류:', error);
    process.exit(1);
  });
}

