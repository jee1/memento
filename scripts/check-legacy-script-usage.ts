#!/usr/bin/env node
import { isMain, parseArgs as parseCliArgs } from './lib/cli.js';

/**
 * 레거시 스크립트 사용 여부 확인 스크립트
 * 
 * 4.1.1: 레거시 스크립트 사용 여부 확인 스크립트 생성
 * 
 * 사용법:
 *   npx tsx scripts/check-legacy-script-usage.ts
 *   npx tsx scripts/check-legacy-script-usage.ts --json
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface UsageCheckResult {
  script: string;
  inGitHistory: boolean;
  inDocumentation: boolean;
  inCode: boolean;
  inPackageJson: boolean;
  isUsed: boolean;
  details: {
    gitHistory?: string[];
    documentation?: string[];
    code?: string[];
    packageJson?: string;
  };
}

interface CheckResult {
  scripts: UsageCheckResult[];
  summary: {
    total: number;
    used: number;
    unused: number;
  };
}

const LEGACY_SCRIPTS = ['simple-migrate.js', 'simple-update.js'];
const GIT_HISTORY_DAYS = 180; // 6개월

/**
 * Git 히스토리에서 스크립트 사용 여부 확인
 */
function checkGitHistory(scriptName: string): { found: boolean; details: string[] } {
  try {
    const scriptPath = `scripts/${scriptName}`;
    const command = `git log --all --full-history --since="${GIT_HISTORY_DAYS} days ago" --format="%h %s" -- ${scriptPath}`;
    const output = execSync(command, { encoding: 'utf-8', stdio: 'pipe' }).trim();
    
    if (output) {
      const commits = output.split('\n').filter(Boolean);
      return { found: true, details: commits };
    }
    return { found: false, details: [] };
  } catch (error) {
    // Git 명령어 실패 시 (예: Git 저장소가 아닌 경우)
    return { found: false, details: [] };
  }
}

/**
 * 문서에서 스크립트 참조 확인
 */
function checkDocumentation(scriptName: string): { found: boolean; details: string[] } {
  const matches: string[] = [];
  const searchPattern = scriptName.replace('.js', '').replace(/-/g, '[-_]?');
  const regex = new RegExp(searchPattern, 'i');
  
  // 문서 디렉토리 검색
  const docDirs = ['docs', '.'];
  const docFiles = ['README.md', 'README.en.md', 'INSTALL.md', 'INSTALL.en.md'];
  
  for (const dir of docDirs) {
    try {
      const files = execSync(`find ${dir} -name "*.md" -type f 2>/dev/null || true`, { encoding: 'utf-8' })
        .trim()
        .split('\n')
        .filter(Boolean);
      
      for (const file of files) {
        if (!existsSync(file)) continue;
        
        try {
          const content = readFileSync(file, 'utf-8');
          if (regex.test(content)) {
            matches.push(file);
          }
        } catch {
          // 파일 읽기 실패 시 무시
        }
      }
    } catch {
      // find 명령어 실패 시 무시
    }
  }
  
  // 루트 디렉토리의 문서 파일 확인
  for (const file of docFiles) {
    if (existsSync(file)) {
      try {
        const content = readFileSync(file, 'utf-8');
        if (regex.test(content)) {
          matches.push(file);
        }
      } catch {
        // 파일 읽기 실패 시 무시
      }
    }
  }
  
  return { found: matches.length > 0, details: matches };
}

/**
 * 코드에서 스크립트 참조 확인
 */
function checkCode(scriptName: string): { found: boolean; details: string[] } {
  const matches: string[] = [];
  const searchPattern = scriptName.replace('.js', '').replace(/-/g, '[-_]?');
  const regex = new RegExp(searchPattern, 'i');
  
  // src/ 및 scripts/ 디렉토리 검색
  const searchDirs = ['src', 'scripts'];
  
  for (const dir of searchDirs) {
    try {
      const files = execSync(`find ${dir} -type f \\( -name "*.ts" -o -name "*.js" \\) 2>/dev/null || true`, { encoding: 'utf-8' })
        .trim()
        .split('\n')
        .filter(Boolean);
      
      for (const file of files) {
        if (!existsSync(file)) continue;
        if (file.includes(scriptName)) continue; // 자기 자신은 제외
        
        try {
          const content = readFileSync(file, 'utf-8');
          if (regex.test(content)) {
            matches.push(file);
          }
        } catch {
          // 파일 읽기 실패 시 무시
        }
      }
    } catch {
      // find 명령어 실패 시 무시
    }
  }
  
  return { found: matches.length > 0, details: matches };
}

/**
 * package.json에서 스크립트 참조 확인
 */
function checkPackageJson(scriptName: string): { found: boolean; details: string } {
  const packageJsonPath = join(process.cwd(), 'package.json');
  
  if (!existsSync(packageJsonPath)) {
    return { found: false, details: '' };
  }
  
  try {
    const content = readFileSync(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content);
    
    if (packageJson.scripts) {
      for (const [key, value] of Object.entries(packageJson.scripts)) {
        if (typeof value === 'string' && value.includes(scriptName)) {
          return { found: true, details: `${key}: ${value}` };
        }
      }
    }
    
    return { found: false, details: '' };
  } catch {
    return { found: false, details: '' };
  }
}

/**
 * 레거시 스크립트 사용 여부 확인
 */
function checkLegacyScriptUsage(): CheckResult {
  const results: UsageCheckResult[] = [];
  
  for (const script of LEGACY_SCRIPTS) {
    const gitHistory = checkGitHistory(script);
    const documentation = checkDocumentation(script);
    const code = checkCode(script);
    const packageJson = checkPackageJson(script);
    
    const isUsed = gitHistory.found || documentation.found || code.found || packageJson.found;
    
    results.push({
      script,
      inGitHistory: gitHistory.found,
      inDocumentation: documentation.found,
      inCode: code.found,
      inPackageJson: packageJson.found,
      isUsed,
      details: {
        gitHistory: gitHistory.details,
        documentation: documentation.details,
        code: code.details,
        packageJson: packageJson.details || undefined
      }
    });
  }
  
  const used = results.filter(r => r.isUsed).length;
  const unused = results.filter(r => !r.isUsed).length;
  
  return {
    scripts: results,
    summary: {
      total: results.length,
      used,
      unused
    }
  };
}

/**
 * 결과를 JSON 형식으로 출력
 */
function printJSON(result: CheckResult): void {
  console.log(JSON.stringify(result, null, 2));
}

/**
 * 결과를 텍스트 형식으로 출력
 */
function printText(result: CheckResult): void {
  console.log('='.repeat(80));
  console.log('레거시 스크립트 사용 여부 확인 결과');
  console.log('='.repeat(80));
  console.log();
  
  for (const script of result.scripts) {
    console.log(`📄 ${script.script}`);
    console.log(`   사용 여부: ${script.isUsed ? '✅ 사용 중' : '❌ 미사용'}`);
    console.log(`   - Git 히스토리 (최근 ${GIT_HISTORY_DAYS}일): ${script.inGitHistory ? '✅' : '❌'}`);
    if (script.details.gitHistory && script.details.gitHistory.length > 0) {
      console.log(`     ${script.details.gitHistory.slice(0, 3).join(', ')}${script.details.gitHistory.length > 3 ? '...' : ''}`);
    }
    console.log(`   - 문서 참조: ${script.inDocumentation ? '✅' : '❌'}`);
    if (script.details.documentation && script.details.documentation.length > 0) {
      console.log(`     ${script.details.documentation.slice(0, 3).join(', ')}${script.details.documentation.length > 3 ? '...' : ''}`);
    }
    console.log(`   - 코드 참조: ${script.inCode ? '✅' : '❌'}`);
    if (script.details.code && script.details.code.length > 0) {
      console.log(`     ${script.details.code.slice(0, 3).join(', ')}${script.details.code.length > 3 ? '...' : ''}`);
    }
    console.log(`   - package.json: ${script.inPackageJson ? '✅' : '❌'}`);
    if (script.details.packageJson) {
      console.log(`     ${script.details.packageJson}`);
    }
    console.log();
  }
  
  console.log('='.repeat(80));
  console.log('요약');
  console.log('='.repeat(80));
  console.log(`총 스크립트 수: ${result.summary.total}`);
  console.log(`사용 중: ${result.summary.used}`);
  console.log(`미사용: ${result.summary.unused}`);
  console.log();
  
  if (result.summary.unused > 0) {
    console.log('⚠️  미사용 스크립트는 제거 후보입니다.');
    console.log('   다음 스크립트를 검토하세요:');
    result.scripts
      .filter(s => !s.isUsed)
      .forEach(s => console.log(`   - ${s.script}`));
  }
}

// 메인 실행
if (isMain(import.meta.url)) {
  const useJSON = parseCliArgs().args.includes('--json');
  const result = checkLegacyScriptUsage();
  
  if (useJSON) {
    printJSON(result);
  } else {
    printText(result);
  }
  
  // CI 모드: 미사용 스크립트가 있으면 exit code 1
  if (parseCliArgs().args.includes('--ci') && result.summary.unused > 0) {
    process.exit(1);
  }
}

export { checkLegacyScriptUsage, type CheckResult, type UsageCheckResult };

