#!/usr/bin/env node
/**
 * PII 마스킹 적용 여부 검사 스크립트
 * 
 * PRD 0019: 보안 강화 (Phase 1) - PII 마스킹 강화
 * 
 * 사용법:
 *   tsx scripts/check-pii-masking.ts
 *   tsx scripts/check-pii-masking.ts --ci
 *   tsx scripts/check-pii-masking.ts --directory src/
 * 
 * 목표:
 *   - 모든 로거에서 PII 마스킹 적용 확인
 *   - 미적용 로거 0개
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
 * PII 마스킹 미적용 발견 위치
 */
interface PIIMaskingLocation {
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
  locations: PIIMaskingLocation[];
  byFile: Map<string, PIIMaskingLocation[]>;
  byPattern: Map<string, number>;
}

/**
 * 명령줄 인자 파싱
 */
function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
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
PII 마스킹 적용 여부 검사 스크립트

사용법:
  tsx scripts/check-pii-masking.ts [options]

옵션:
  --ci                    CI 모드 (미적용 로거 발견 시 exit code 1 반환)
  --directory <path>      검사할 디렉토리 (기본값: src/)
  --exclude <pattern>     제외할 파일 패턴 (여러 번 사용 가능)
  --help, -h              도움말 출력

예제:
  tsx scripts/check-pii-masking.ts
  tsx scripts/check-pii-masking.ts --ci
  tsx scripts/check-pii-masking.ts --directory src/domains
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
 * 파일 내용에서 PII 마스킹 미적용 패턴 검색
 */
function checkFile(filePath: string): PIIMaskingLocation[] {
  const locations: PIIMaskingLocation[] = [];
  
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const relativePath = relative(process.cwd(), filePath);
    
    // logger.ts와 logging-helpers.ts는 이미 PII 마스킹이 적용되어 있으므로 제외
    // logger.ts는 PII 마스킹을 자동으로 적용하고, logging-helpers.ts는 logger를 사용함
    if (relativePath.includes('shared/utils/logger.ts') || relativePath.includes('shared/utils/logging-helpers.ts')) {
      return locations;
    }
    
    // logger.ts를 import하는지 확인 (이미 마스킹이 적용되어 있음)
    // 다양한 import 패턴 지원: import { logger } from '...', import logger from '...', import * as logger from '...'
    const usesLoggerUtils = /import\s+.*\blogger\b.*from\s+['"].*shared\/utils\/logger|from\s+['"].*shared\/utils\/logger/.test(content);
    
    // 로거 파일인지 확인 (logger, file-logger, error-logging-service 등)
    const isLoggerFile = /logger|log|error-logging/i.test(relativePath);
    
    // logger.error, logger.warn, logger.info, logger.debug 호출 확인
    // logger.ts를 import하는 경우는 이미 마스킹이 적용되어 있으므로 제외
    if (!usesLoggerUtils) {
      const loggerMethodPattern = /logger\.(error|warn|info|debug|log)\s*\(/g;
      let match;
      
      while ((match = loggerMethodPattern.exec(content)) !== null) {
        const lineNumber = content.substring(0, match.index).split('\n').length;
        const line = lines[lineNumber - 1];
        
        // PIIMasker를 사용하지 않는 logger 호출 확인
        // 해당 메서드 호출 전후로 PIIMasker 사용 여부 확인
        const beforeContext = content.substring(Math.max(0, match.index - 500), match.index);
        const afterContext = content.substring(match.index, Math.min(content.length, match.index + 500));
        
        // PIIMasker.mask가 사용되지 않은 경우
        if (!beforeContext.includes('PIIMasker.mask') && !afterContext.includes('PIIMasker.mask')) {
          locations.push({
            file: relativePath,
            line: lineNumber,
            column: match.index - content.substring(0, match.index).lastIndexOf('\n') - 1,
            pattern: 'logger-method-without-masking',
            context: line.trim(),
            severity: isLoggerFile ? 'high' : 'medium'
          });
        }
      }
    }
    
    // console.error에서 error.message 또는 error.stack 직접 사용 확인
    const consoleErrorPattern = /console\.(error|warn|log|info|debug)\s*\([^)]*(error\.(message|stack)|error\))/g;
    let consoleMatch;
    
    while ((consoleMatch = consoleErrorPattern.exec(content)) !== null) {
      const lineNumber = content.substring(0, consoleMatch.index).split('\n').length;
      const line = lines[lineNumber - 1];
      
      // PIIMasker를 사용하지 않는 console.error 호출 확인
      const beforeContext = content.substring(Math.max(0, consoleMatch.index - 500), consoleMatch.index);
      const afterContext = content.substring(consoleMatch.index, Math.min(content.length, consoleMatch.index + 500));
      
      if (!beforeContext.includes('PIIMasker.mask') && !afterContext.includes('PIIMasker.mask')) {
        // catch 블록 내부인지 확인
        const beforeCatch = content.substring(Math.max(0, consoleMatch.index - 1000), consoleMatch.index);
        if (beforeCatch.includes('catch') || line.includes('catch')) {
          locations.push({
            file: relativePath,
            line: lineNumber,
            column: consoleMatch.index - content.substring(0, consoleMatch.index).lastIndexOf('\n') - 1,
            pattern: 'console-error-without-masking',
            context: line.trim(),
            severity: 'high'
          });
        }
      }
    }
    
    // logger.error에서 error 객체를 직접 전달하는 경우 확인
    // logger.ts를 import하는 경우는 이미 마스킹이 적용되어 있으므로 제외
    if (!usesLoggerUtils) {
      const loggerErrorPattern = /logger\.(error|warn|info|debug)\s*\([^,)]*,\s*\{[^}]*error[^}]*\}/g;
      let loggerErrorMatch;
      
      while ((loggerErrorMatch = loggerErrorPattern.exec(content)) !== null) {
        const lineNumber = content.substring(0, loggerErrorMatch.index).split('\n').length;
        const line = lines[lineNumber - 1];
        
        // error 객체가 마스킹되지 않은 상태로 전달되는지 확인
        const beforeContext = content.substring(Math.max(0, loggerErrorMatch.index - 500), loggerErrorMatch.index);
        
        if (!beforeContext.includes('PIIMasker.mask') && !line.includes('PIIMasker.mask')) {
          locations.push({
            file: relativePath,
            line: lineNumber,
            column: loggerErrorMatch.index - content.substring(0, loggerErrorMatch.index).lastIndexOf('\n') - 1,
            pattern: 'logger-error-object-without-masking',
            context: line.trim(),
            severity: 'medium'
          });
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
  const locations: PIIMaskingLocation[] = [];
  const byFile = new Map<string, PIIMaskingLocation[]>();
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
  console.log('\n⚠️  발견된 PII 마스킹 미적용:', result.total, '개');
  
  if (result.total === 0) {
    console.log('✅ 모든 로거에서 PII 마스킹이 적용되어 있습니다.');
    return;
  }
  
  console.log('📁 파일별 미적용 목록:');
  
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
  
  console.log('🔍 PII 마스킹 적용 여부 검사 시작...\n');
  
  const result = await checkAllFiles(options);
  printResults(result);
  
  if (options.ci && result.total > 0) {
    console.error('\n❌ CI 실패: PII 마스킹 미적용 로거가 발견되었습니다.');
    process.exit(1);
  }
  
  if (result.total === 0) {
    console.log('\n✅ 검사 완료: 모든 로거에서 PII 마스킹이 적용되어 있습니다.');
  }
}

// 스크립트 실행
main().catch(error => {
  console.error('❌ 스크립트 실행 실패:', error);
  process.exit(1);
});

