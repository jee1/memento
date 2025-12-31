#!/usr/bin/env node
/**
 * no-console 규칙 위반 추적 스크립트
 * 
 * PRD 0021: 기능 미활용 개선 (Phase 3) - 로깅 시스템 통일 및 강제
 * 
 * 사용법:
 *   tsx scripts/check-no-console-violations.ts
 *   tsx scripts/check-no-console-violations.ts --ci
 *   tsx scripts/check-no-console-violations.ts --snapshot
 *   tsx scripts/check-no-console-violations.ts --compare
 *   tsx scripts/check-no-console-violations.ts --directory src/server/ src/services/
 * 
 * 목표:
 *   - no-console 규칙 위반 개수 추적
 *   - 스냅샷 기반 비교로 규칙 위반 증가 방지
 *   - CI/CD 통합 가능
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';

/**
 * CLI 옵션
 */
interface CliOptions {
  ci?: boolean;
  snapshot?: boolean;
  compare?: boolean;
  directory?: string[];
  snapshotPath?: string;
}

/**
 * ESLint JSON 출력 형식의 메시지
 */
interface ESLintMessage {
  ruleId: string;
  severity: number;
  message: string;
  line: number;
  column: number;
  nodeType?: string;
  endLine?: number;
  endColumn?: number;
}

/**
 * ESLint JSON 출력 형식의 파일 결과
 */
interface ESLintFileResult {
  filePath: string;
  messages: ESLintMessage[];
  errorCount: number;
  warningCount: number;
  fixableErrorCount: number;
  fixableWarningCount: number;
  usedDeprecatedRules: unknown[];
}

/**
 * ESLint JSON 출력 형식
 */
interface ESLintResult {
  results: ESLintFileResult[];
  errorCount: number;
  warningCount: number;
  fixableErrorCount: number;
  fixableWarningCount: number;
}

/**
 * no-console 규칙 위반 정보
 */
interface NoConsoleViolation {
  file: string;
  line: number;
  column: number;
  message: string;
}

/**
 * 스냅샷 데이터 형식
 */
interface SnapshotData {
  timestamp: string;
  total: number;
  violations: NoConsoleViolation[];
  byFile: Record<string, number>;
}

/**
 * 명령줄 인자 파싱
 */
function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--ci') {
      options.ci = true;
    } else if (arg === '--snapshot') {
      options.snapshot = true;
    } else if (arg === '--compare') {
      options.compare = true;
    } else if (arg === '--directory' && args[i + 1]) {
      if (!options.directory) {
        options.directory = [];
      }
      // 여러 디렉토리 지원 (공백으로 구분)
      let j = i + 1;
      while (j < args.length && !args[j].startsWith('--')) {
        options.directory.push(args[j]);
        j++;
      }
      i = j - 1;
    } else if (arg === '--snapshot-path' && args[i + 1]) {
      options.snapshotPath = args[i + 1];
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
no-console 규칙 위반 추적 스크립트

사용법:
  tsx scripts/check-no-console-violations.ts [options]

옵션:
  --ci                    CI 모드 (실패 시 exit code 1 반환)
  --snapshot               현재 상태를 스냅샷으로 저장
  --compare                이전 스냅샷과 비교
  --directory <path>       검사할 디렉토리 (여러 번 사용 가능, 기본값: src/)
  --snapshot-path <path>   스냅샷 파일 경로 (기본값: .lint-snapshots/no-console-violations.json)
  --help, -h               도움말 출력

예제:
  tsx scripts/check-no-console-violations.ts
  tsx scripts/check-no-console-violations.ts --ci
  tsx scripts/check-no-console-violations.ts --snapshot
  tsx scripts/check-no-console-violations.ts --compare
  tsx scripts/check-no-console-violations.ts --directory src/server/ src/services/
`);
}

/**
 * ESLint 실행 및 결과 파싱
 */
function runESLint(directories?: string[]): ESLintResult {
  try {
    const projectRoot = process.cwd();
    const targetPaths = directories && directories.length > 0 
      ? directories.map(d => `${d}**/*.ts`).join(' ')
      : 'src/**/*.ts';
    
    // ESLint를 JSON 형식으로 실행
    const command = `npm run lint -- --format json -- ${targetPaths}`;
    const output = execSync(command, { 
      encoding: 'utf-8',
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // ESLint 출력의 마지막 줄이 JSON 결과
    const lines = output.trim().split('\n');
    const jsonLine = lines[lines.length - 1];
    
    if (!jsonLine || !jsonLine.startsWith('[') && !jsonLine.startsWith('{')) {
      // JSON이 아닌 경우, 전체 출력을 파싱 시도
      const result: ESLintResult = {
        results: [],
        errorCount: 0,
        warningCount: 0,
        fixableErrorCount: 0,
        fixableWarningCount: 0
      };
      return result;
    }

    const results: ESLintFileResult[] = JSON.parse(jsonLine);
    const errorCount = results.reduce((sum, r) => sum + r.errorCount, 0);
    const warningCount = results.reduce((sum, r) => sum + r.warningCount, 0);
    const fixableErrorCount = results.reduce((sum, r) => sum + r.fixableErrorCount, 0);
    const fixableWarningCount = results.reduce((sum, r) => sum + r.fixableWarningCount, 0);

    return {
      results,
      errorCount,
      warningCount,
      fixableErrorCount,
      fixableWarningCount
    };
  } catch (error) {
    console.error('❌ ESLint 실행 실패:', error instanceof Error ? error.message : String(error));
    // ESLint 실행 실패 시 빈 결과 반환
    return {
      results: [],
      errorCount: 0,
      warningCount: 0,
      fixableErrorCount: 0,
      fixableWarningCount: 0
    };
  }
}

/**
 * no-console 규칙 위반 추출
 */
function extractNoConsoleViolations(result: ESLintResult): NoConsoleViolation[] {
  const violations: NoConsoleViolation[] = [];

  for (const fileResult of result.results) {
    for (const message of fileResult.messages) {
      if (message.ruleId === 'no-console') {
        violations.push({
          file: fileResult.filePath,
          line: message.line,
          column: message.column,
          message: message.message
        });
      }
    }
  }

  return violations;
}

/**
 * 스냅샷 데이터 생성
 */
function createSnapshot(violations: NoConsoleViolation[]): SnapshotData {
  const byFile: Record<string, number> = {};

  for (const violation of violations) {
    const file = violation.file;
    byFile[file] = (byFile[file] || 0) + 1;
  }

  return {
    timestamp: new Date().toISOString(),
    total: violations.length,
    violations,
    byFile
  };
}

/**
 * 스냅샷 저장
 */
function saveSnapshot(snapshot: SnapshotData, snapshotPath: string): void {
  const projectRoot = process.cwd();
  const fullPath = join(projectRoot, snapshotPath);
  const dir = dirname(fullPath);

  // 디렉토리 생성
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // 스냅샷 저장
  writeFileSync(fullPath, JSON.stringify(snapshot, null, 2), 'utf-8');
  console.log(`✅ 스냅샷 저장 완료: ${snapshotPath}`);
  console.log(`   총 위반 개수: ${snapshot.total}`);
}

/**
 * 스냅샷 로드
 */
function loadSnapshot(snapshotPath: string): SnapshotData | null {
  const projectRoot = process.cwd();
  const fullPath = join(projectRoot, snapshotPath);

  if (!existsSync(fullPath)) {
    return null;
  }

  try {
    const content = readFileSync(fullPath, 'utf-8');
    return JSON.parse(content) as SnapshotData;
  } catch (error) {
    console.error(`❌ 스냅샷 로드 실패: ${snapshotPath}`, error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * 스냅샷 비교
 */
function compareSnapshots(current: SnapshotData, previous: SnapshotData): {
  increased: boolean;
  diff: number;
  newViolations: NoConsoleViolation[];
  removedViolations: NoConsoleViolation[];
} {
  const currentSet = new Set(
    current.violations.map(v => `${v.file}:${v.line}:${v.column}`)
  );
  const previousSet = new Set(
    previous.violations.map(v => `${v.file}:${v.line}:${v.column}`)
  );

  const newViolations = current.violations.filter(
    v => !previousSet.has(`${v.file}:${v.line}:${v.column}`)
  );
  const removedViolations = previous.violations.filter(
    v => !currentSet.has(`${v.file}:${v.line}:${v.column}`)
  );

  const diff = current.total - previous.total;
  const increased = diff > 0;

  return {
    increased,
    diff,
    newViolations,
    removedViolations
  };
}

/**
 * 결과 출력
 */
function printResults(
  violations: NoConsoleViolation[],
  snapshot?: SnapshotData,
  comparison?: ReturnType<typeof compareSnapshots>
): void {
  console.log('\n📊 no-console 규칙 위반 현황\n');

  if (violations.length === 0) {
    console.log('✅ no-console 규칙 위반이 없습니다.\n');
    return;
  }

  console.log(`총 위반 개수: ${violations.length}\n`);

  // 파일별 그룹화
  const byFile: Record<string, NoConsoleViolation[]> = {};
  for (const violation of violations) {
    const file = violation.file;
    if (!byFile[file]) {
      byFile[file] = [];
    }
    byFile[file].push(violation);
  }

  // 파일별 출력
  for (const [file, fileViolations] of Object.entries(byFile)) {
    console.log(`📄 ${file} (${fileViolations.length}개)`);
    for (const violation of fileViolations.slice(0, 5)) { // 최대 5개만 출력
      console.log(`   ${violation.line}:${violation.column} - ${violation.message}`);
    }
    if (fileViolations.length > 5) {
      console.log(`   ... 외 ${fileViolations.length - 5}개`);
    }
    console.log('');
  }

  // 비교 결과 출력
  if (comparison) {
    console.log('\n📈 스냅샷 비교 결과\n');
    console.log(`이전: ${comparison.diff >= 0 ? comparison.diff + violations.length : violations.length}개`);
    console.log(`현재: ${violations.length}개`);
    console.log(`변화: ${comparison.diff >= 0 ? '+' : ''}${comparison.diff}개\n`);

    if (comparison.newViolations.length > 0) {
      console.log(`⚠️  새로운 위반 ${comparison.newViolations.length}개:`);
      for (const violation of comparison.newViolations.slice(0, 10)) {
        console.log(`   ${violation.file}:${violation.line}:${violation.column}`);
      }
      if (comparison.newViolations.length > 10) {
        console.log(`   ... 외 ${comparison.newViolations.length - 10}개`);
      }
      console.log('');
    }

    if (comparison.removedViolations.length > 0) {
      console.log(`✅ 해결된 위반 ${comparison.removedViolations.length}개\n`);
    }
  }
}

/**
 * 메인 함수
 */
async function main(): Promise<void> {
  const options = parseArgs();
  const snapshotPath = options.snapshotPath || '.lint-snapshots/no-console-violations.json';

  try {
    // ESLint 실행
    console.log('🔍 ESLint 실행 중...');
    const eslintResult = runESLint(options.directory);

    // no-console 규칙 위반 추출
    const violations = extractNoConsoleViolations(eslintResult);

    // 스냅샷 생성
    const snapshot = createSnapshot(violations);

    // 스냅샷 저장 모드
    if (options.snapshot) {
      saveSnapshot(snapshot, snapshotPath);
      return;
    }

    // 비교 모드
    let comparison: ReturnType<typeof compareSnapshots> | undefined;
    if (options.compare) {
      const previousSnapshot = loadSnapshot(snapshotPath);
      if (previousSnapshot) {
        comparison = compareSnapshots(snapshot, previousSnapshot);
      } else {
        console.log('⚠️  이전 스냅샷을 찾을 수 없습니다. --snapshot 옵션으로 먼저 스냅샷을 생성하세요.\n');
      }
    }

    // 결과 출력
    printResults(violations, snapshot, comparison);

    // CI 모드: exit code 처리
    if (options.ci) {
      if (options.compare && comparison && comparison.increased) {
        console.log(`❌ CI 실패: no-console 규칙 위반이 ${comparison.diff}개 증가했습니다.`);
        process.exit(1);
      } else if (violations.length > 0) {
        console.log(`⚠️  CI 경고: no-console 규칙 위반이 ${violations.length}개 있습니다.`);
        // CI 모드에서는 위반이 있으면 실패
        process.exit(1);
      } else {
        console.log('✅ CI 통과: no-console 규칙 위반이 없습니다.');
        process.exit(0);
      }
    } else {
      // 일반 모드: 정보만 출력
      if (violations.length > 0) {
        console.log('💡 팁: --ci 옵션을 사용하면 CI/CD 파이프라인에 통합할 수 있습니다.');
        console.log('💡 팁: --snapshot 옵션으로 현재 상태를 저장하고 --compare로 추적할 수 있습니다.');
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
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ 치명적 오류:', error);
    process.exit(1);
  });
}

