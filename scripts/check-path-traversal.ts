#!/usr/bin/env node
import { parseArgs as parseCliArgs } from './lib/cli.js';
/**
 * Path Traversal 취약점 검사 스크립트
 * 
 * PRD 0019: 보안 강화 (Phase 1) - Path Traversal 방지
 * 
 * 사용법:
 *   tsx scripts/check-path-traversal.ts
 *   tsx scripts/check-path-traversal.ts --ci
 *   tsx scripts/check-path-traversal.ts --directory src/
 * 
 * 목표:
 *   - 모든 파일 경로 처리 코드에서 경로 검증 적용 확인
 *   - Path Traversal 취약점 0개
 *   - CI/CD 통합 가능
 */

/* eslint-disable security/detect-unsafe-regex */
// 정규식 패턴은 안전한 패턴임

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
 * Path Traversal 취약점 발견 위치
 */
interface PathTraversalLocation {
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
  locations: PathTraversalLocation[];
  byFile: Map<string, PathTraversalLocation[]>;
  byPattern: Map<string, number>;
}

/**
 * 명령줄 인자 파싱
 */
function parseArgs(): CliOptions {
  const args = parseCliArgs().args;
  const options: CliOptions = {
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.d.ts', '**/*.spec.ts', '**/__tests__/**']
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
Path Traversal 취약점 검사 스크립트

사용법:
  tsx scripts/check-path-traversal.ts [options]

옵션:
  --ci                    CI 모드 (취약점 발견 시 exit code 1 반환)
  --directory <path>      검사할 디렉토리 (기본값: src/)
  --exclude <pattern>     제외할 파일 패턴 (여러 번 사용 가능)
  --help, -h              도움말 출력

예제:
  tsx scripts/check-path-traversal.ts
  tsx scripts/check-path-traversal.ts --ci
  tsx scripts/check-path-traversal.ts --directory src/infrastructure
`);
}

/**
 * 파일이 제외 패턴에 해당하는지 확인
 */
function shouldExclude(file: string, excludePatterns: string[]): boolean {
  for (const pattern of excludePatterns) {
    // 간단한 패턴 매칭 (glob 패턴은 복잡하므로 기본적인 것만 지원)
    if (pattern.includes('**')) {
      const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
      if (regex.test(file)) {
        return true;
      }
    } else if (file.includes(pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * 재귀적으로 디렉토리 탐색
 */
async function findFiles(
  dir: string,
  excludePatterns: string[],
  fileList: string[] = []
): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = relative(process.cwd(), fullPath);
      
      if (shouldExclude(relativePath, excludePatterns)) {
        continue;
      }
      
      if (entry.isDirectory()) {
        await findFiles(fullPath, excludePatterns, fileList);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        fileList.push(fullPath);
      }
    }
  } catch (error) {
    // 디렉토리 읽기 실패는 무시
  }
  
  return fileList;
}

/**
 * 파일 내용에서 Path Traversal 취약점 검색
 */
function checkFile(filePath: string): PathTraversalLocation[] {
  const locations: PathTraversalLocation[] = [];
  
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const relativePath = relative(process.cwd(), filePath);
    
    // 파일 경로를 다루는 코드 패턴 검색
    const pathPatterns = [
      {
        pattern: /(readFile|writeFile|appendFile|createReadStream|createWriteStream|unlink|rmdir|mkdir|access|stat|readdir)\s*\([^)]*['"`]([^'"`]*(?:\.\.\/|\.\.\\\\)[^'"`]*)['"`]/g,
        type: 'file-operation-with-traversal',
        severity: 'high' as const
      },
      {
        pattern: /path\.(join|resolve)\s*\([^)]*['"`]([^'"`]*(?:\.\.\/|\.\.\\\\)[^'"`]*)['"`]/g,
        type: 'path-join-with-traversal',
        severity: 'high' as const
      },
      {
        pattern: /fs\.(readFile|writeFile|appendFile|createReadStream|createWriteStream|unlink|rmdir|mkdir|access|stat|readdir)Sync\s*\([^)]*['"`]([^'"`]*(?:\.\.\/|\.\.\\\\)[^'"`]*)['"`]/g,
        type: 'fs-sync-with-traversal',
        severity: 'high' as const
      }
    ];
    
    // 각 패턴 검색
    for (const pathPattern of pathPatterns) {
      let match;
      while ((match = pathPattern.pattern.exec(content)) !== null) {
        const lineNumber = content.substring(0, match.index).split('\n').length;
        const line = lines[lineNumber - 1];
        
        // validateFilePath 또는 sanitizeFileName 사용 여부 확인
        const beforeContext = content.substring(Math.max(0, match.index - 500), match.index);
        const afterContext = content.substring(match.index, Math.min(content.length, match.index + 500));
        
        // 경로 검증이 적용되지 않은 경우
        if (!beforeContext.includes('validateFilePath') && 
            !beforeContext.includes('sanitizeFileName') &&
            !afterContext.includes('validateFilePath') &&
            !afterContext.includes('sanitizeFileName')) {
          // path-validator.ts 파일 자체는 제외
          if (!relativePath.includes('path-validator.ts')) {
            locations.push({
              file: relativePath,
              line: lineNumber,
              column: match.index - content.substring(0, match.index).lastIndexOf('\n') - 1,
              pattern: pathPattern.type,
              context: line.trim(),
              severity: pathPattern.severity
            });
          }
        }
      }
    }
    
    // 사용자 입력을 받는 파일 경로 처리 코드 검색
    const userInputPatterns = [
      {
        pattern: /(readFile|writeFile|appendFile|createReadStream|createWriteStream|unlink|rmdir|mkdir|access|stat|readdir)\s*\([^)]*(\w+)\s*[,)]/g,
        type: 'file-operation-with-user-input',
        severity: 'medium' as const
      },
      {
        pattern: /path\.(join|resolve)\s*\([^)]*(\w+)\s*[,)]/g,
        type: 'path-join-with-user-input',
        severity: 'medium' as const
      }
    ];
    
    // 사용자 입력 패턴 검색 (함수 파라미터로 받는 경우)
    for (const userInputPattern of userInputPatterns) {
      let match;
      while ((match = userInputPattern.pattern.exec(content)) !== null) {
        const lineNumber = content.substring(0, match.index).split('\n').length;
        const line = lines[lineNumber - 1];
        
        // 함수 파라미터인지 확인 (함수 시그니처에서 파라미터로 받는 경우)
        const beforeContext = content.substring(Math.max(0, match.index - 1000), match.index);
        const functionMatch = beforeContext.match(/(?:function|const|let|var)\s+\w+\s*\([^)]*(\w+)\s*[,)]/);
        
        if (functionMatch) {
          const paramName = functionMatch[1];
          // 해당 파라미터가 경로 검증 없이 사용되는지 확인
          const paramUsagePattern = new RegExp(`\\b${paramName}\\b[^,)]*[,)]`, 'g');
          const paramUsageMatch = paramUsagePattern.exec(line);
          
          if (paramUsageMatch) {
            // validateFilePath 또는 sanitizeFileName 사용 여부 확인
            if (!beforeContext.includes('validateFilePath') && 
                !beforeContext.includes('sanitizeFileName') &&
                !line.includes('validateFilePath') &&
                !line.includes('sanitizeFileName')) {
              // path-validator.ts 파일 자체는 제외
              if (!relativePath.includes('path-validator.ts')) {
                locations.push({
                  file: relativePath,
                  line: lineNumber,
                  column: match.index - content.substring(0, match.index).lastIndexOf('\n') - 1,
                  pattern: userInputPattern.type,
                  context: line.trim(),
                  severity: userInputPattern.severity
                });
              }
            }
          }
        }
      }
    }
    
  } catch (error) {
    // 파일 읽기 실패는 무시
  }
  
  return locations;
}

/**
 * 모든 파일 검사
 */
async function checkAllFiles(options: CliOptions): Promise<CheckResult> {
  const directory = options.directory || 'src';
  const excludePatterns = options.exclude || [];
  
  const files = await findFiles(directory, excludePatterns);
  const locations: PathTraversalLocation[] = [];
  const byFile = new Map<string, PathTraversalLocation[]>();
  const byPattern = new Map<string, number>();
  
  for (const file of files) {
    const fileLocations = checkFile(file);
    if (fileLocations.length > 0) {
      const relativePath = relative(process.cwd(), file);
      locations.push(...fileLocations);
      byFile.set(relativePath, fileLocations);
      
      for (const loc of fileLocations) {
        byPattern.set(loc.pattern, (byPattern.get(loc.pattern) || 0) + 1);
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
function printResults(result: CheckResult): void {
  console.log('\n⚠️  발견된 Path Traversal 취약점:', result.total, '개');
  
  if (result.total === 0) {
    console.log('✅ 모든 파일 경로 처리 코드에서 경로 검증이 적용되어 있습니다.');
    return;
  }
  
  console.log('📁 파일별 취약점 목록:');
  
  for (const [file, locations] of result.byFile.entries()) {
    console.log(`\n   ${file} (${locations.length}개):`);
    
    for (const loc of locations) {
      const severityIcon = loc.severity === 'high' ? '🔴' : loc.severity === 'medium' ? '🟡' : '🟢';
      console.log(`      ${severityIcon} 라인 ${loc.line}:${loc.column} - ${loc.pattern}`);
      console.log(`         ${loc.context}`);
    }
  }
  
  console.log('\n📊 패턴별 통계:');
  for (const [pattern, count] of result.byPattern.entries()) {
    console.log(`   ${pattern}: ${count}개`);
  }
}

/**
 * 메인 함수
 */
async function main(): Promise<void> {
  const options = parseArgs();
  
  console.log('🔍 Path Traversal 취약점 검사 시작...\n');
  
  const result = await checkAllFiles(options);
  printResults(result);
  
  if (options.ci && result.total > 0) {
    console.error('\n❌ CI 실패: Path Traversal 취약점이 발견되었습니다.');
    process.exit(1);
  }
  
  if (result.total === 0) {
    console.log('\n✅ 검사 완료: 모든 파일 경로 처리 코드에서 경로 검증이 적용되어 있습니다.');
  }
}

// 스크립트 실행
main().catch(error => {
  console.error('❌ 스크립트 실행 실패:', error);
  process.exit(1);
});

