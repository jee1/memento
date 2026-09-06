#!/usr/bin/env node
import { isMain } from './lib/cli-runtime.js';
import { runPostinstallDbInit } from './lib/postinstall-db-init.js';

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// 색상 코드
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, message) {
  log(`\n${colors.cyan}🚀 ${step}: ${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

async function checkNodeVersion() {
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
  
  if (majorVersion < 20) {
    logError(`Node.js 20 이상이 필요합니다. 현재 버전: ${nodeVersion}`);
    process.exit(1);
  }
  
  logSuccess(`Node.js 버전 확인 완료: ${nodeVersion}`);
}

async function createEnvFile() {
  const envPath = path.join(projectRoot, '.env');
  const envExamplePath = path.join(projectRoot, 'env.example');
  
  if (fs.existsSync(envPath)) {
    logSuccess('.env 파일이 이미 존재합니다.');
    return;
  }
  
  if (!fs.existsSync(envExamplePath)) {
    logError('env.example 파일을 찾을 수 없습니다.');
    return;
  }
  
  try {
    fs.copyFileSync(envExamplePath, envPath);
    logSuccess('.env 파일 생성 완료');
    
    // API 키 설정 안내
    logWarning('API 키를 설정하려면 .env 파일을 편집하세요:');
    log('  - OPENAI_API_KEY: OpenAI API 키 (선택사항)');
    log('  - GEMINI_API_KEY: Gemini API 키 (선택사항)');
    log('  - API 키가 없어도 경량 임베딩으로 동작합니다.');
  } catch (error) {
    logError(`.env 파일 생성 실패: ${error.message}`);
  }
}

async function createDataDirectory() {
  const dataDir = path.join(projectRoot, 'data');
  
  if (!fs.existsSync(dataDir)) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      logSuccess('데이터 디렉토리 생성 완료');
    } catch (error) {
      logError(`데이터 디렉토리 생성 실패: ${error.message}`);
    }
  } else {
    logSuccess('데이터 디렉토리가 이미 존재합니다.');
  }
}

async function initializeDatabase() {
  logStep('데이터베이스 초기화', 'SQLite 데이터베이스 설정 중...');
  // #860: tarball 에 packages/ 가 없으므로 @memento/core 공개 API 사용.
  // 실패를 삼키면 "설치 성공·DB 없음" 위장이 된다 → 호출부로 전파해 비0 종료.
  await runPostinstallDbInit();
  logSuccess('데이터베이스 초기화 완료');
}

/**
 * 네이티브 모듈이 실제로 로드되는지 확인한다 (#876).
 *
 * 디렉터리 존재만 보던 예전 검사는 아무것도 검사하지 않았다. `npm ci --ignore-scripts` 는
 * 패키지 디렉터리를 정상적으로 깔고 컴파일만 건너뛰므로, 디렉터리는 있고
 * `build/Release/better_sqlite3.node` 만 없는 상태를 "확인됨" 으로 통과시켰다.
 * 재빌드는 실행되지 않고, 한참 뒤 DB 초기화 단계에서 "Could not locate the bindings file" 로 터졌다.
 *
 * 두 모듈 모두 바인딩을 **지연 로드**하므로 require 만으로는 부족하다:
 * - better-sqlite3 는 Database 생성자 안에서 addon 을 연다 (lib/database.js:48)
 * - sqlite-vec 는 getLoadablePath() 안에서 플랫폼 패키지를 resolve 한다 (index.cjs)
 * 그래서 실제로 열어 본다. 바인딩 누락과 Node 메이저 변경에 따른 ABI 불일치를 모두 잡는다.
 */
const NATIVE_MODULE_PROBES = {
  'better-sqlite3': (mod) => {
    const db = new mod(':memory:');
    db.close();
  },
  'sqlite-vec': (mod) => {
    mod.getLoadablePath();
  }
};

/** 로드에 성공하면 null, 실패하면 원인 Error 를 돌려준다. */
export function probeNativeModule(name, requireFn) {
  try {
    const load = requireFn ?? createRequire(path.join(projectRoot, 'package.json'));
    const mod = load(name);
    const probe = NATIVE_MODULE_PROBES[name];
    if (probe) probe(mod);
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

/** 로드 확인 → 실패 시 재빌드 → 재확인. 재빌드 후에도 실패하면 성공 로그를 찍지 않는다. */
function ensureNativeModule(name, failureHint, requireFn) {
  if (probeNativeModule(name, requireFn) === null) {
    logSuccess(`${name} 모듈 로드 확인됨`);
    return true;
  }

  logWarning(`${name} 로드 실패 — 재빌드가 필요합니다.`);
  logStep('재빌드', `${name} 재빌드 중...`);
  try {
    execSync(`npm rebuild ${name}`, { cwd: projectRoot, stdio: 'inherit' });
  } catch (rebuildError) {
    logWarning(`${name} 재빌드 실패: ${rebuildError.message}`);
    logWarning(failureHint);
    return false;
  }

  // 재빌드가 성공을 보고해도 다시 확인한다 — 거짓 성공이 바로 이 이슈의 증상이었다.
  const stillFailing = probeNativeModule(name, requireFn);
  if (stillFailing) {
    logWarning(`${name} 재빌드 후에도 로드되지 않습니다: ${stillFailing.message}`);
    logWarning(failureHint);
    return false;
  }

  logSuccess(`${name} 재빌드 완료`);
  return true;
}

async function rebuildNativeModules() {
  try {
    logStep('네이티브 모듈', 'better-sqlite3 및 sqlite-vec 재빌드 시도 중...');

    const nodeModulesPath = path.join(projectRoot, 'node_modules');
    if (!fs.existsSync(nodeModulesPath)) {
      logWarning('node_modules가 없습니다. 먼저 npm install이 실행됩니다.');
      return;
    }

    ensureNativeModule(
      'better-sqlite3',
      '빌드 도구(python3, make, g++)를 설치한 뒤 수동으로 실행하세요: npm rebuild better-sqlite3'
    );
    ensureNativeModule(
      'sqlite-vec',
      'sqlite-vec는 선택적 의존성입니다. 벡터 검색 기능이 제한될 수 있습니다.'
    );
  } catch (error) {
    logWarning(`네이티브 모듈 재빌드 중 오류: ${error.message}`);
    logWarning('수동으로 실행하세요: npm rebuild better-sqlite3 sqlite-vec');
  }
}

async function checkDependencies() {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  const nodeModulesPath = path.join(projectRoot, 'node_modules');
  
  if (!fs.existsSync(nodeModulesPath)) {
    logStep('의존성 설치', 'npm install 실행 중...');
    try {
      execSync('npm install', { 
        cwd: projectRoot, 
        stdio: 'inherit' 
      });
      logSuccess('의존성 설치 완료');
    } catch (error) {
      logError(`의존성 설치 실패: ${error.message}`);
      process.exit(1);
    }
  } else {
    logSuccess('의존성이 이미 설치되어 있습니다.');
  }
}

async function createStartScripts() {
  const startScripts = {
    'start-dev.sh': `#!/bin/bash
echo "🚀 Memento MCP Server 개발 모드 시작..."
npm run dev
`,
    'start-prod.sh': `#!/bin/bash
echo "🚀 Memento MCP Server 프로덕션 모드 시작..."
npm run build
npm run start
`,
    'start-docker.sh': `#!/bin/bash
echo "🐳 Memento MCP Server Docker 모드 시작..."
docker-compose up -d
echo "서버가 http://localhost:8080 에서 실행 중입니다."
`
  };
  
  for (const [filename, content] of Object.entries(startScripts)) {
    const filePath = path.join(projectRoot, filename);
    if (!fs.existsSync(filePath)) {
      try {
        fs.writeFileSync(filePath, content);
        // 실행 권한 부여 (Unix 계열)
        if (process.platform !== 'win32') {
          fs.chmodSync(filePath, '755');
        }
        logSuccess(`${filename} 생성 완료`);
      } catch (error) {
        logWarning(`${filename} 생성 실패: ${error.message}`);
      }
    }
  }
}

async function showUsageInstructions() {
  log('\n' + '='.repeat(60), 'cyan');
  log('🎉 Memento MCP Server 자동 설정 완료!', 'bright');
  log('='.repeat(60), 'cyan');
  
  log('\n📋 사용 방법:', 'yellow');
  log('1. 개발 모드:');
  log('   npm run dev');
  log('   또는: npx memento-mcp-server@latest dev');
  
  log('\n2. 프로덕션 모드:');
  log('   npm run build && npm run start');
  log('   또는: npx memento-mcp-server@latest start');
  
  log('\n3. HTTP/WebSocket 서버:');
  log('   npm run dev:http');
  log('   또는: npx memento-mcp-server@latest dev-http');
  
  log('\n4. Docker 모드:');
  log('   docker-compose up -d');
  log('   또는: ./start-docker.sh');
  
  log('\n5. 원클릭 시작:');
  log('   npm run quick-start');
  
  log('\n📚 자세한 사용법:');
  log('   - README.md 파일 참조');
  log('   - docs/ 폴더의 문서들');
  
  log('\n🔧 문제 해결:');
  log('   - 로그 확인: logs/memento-server.log');
  log('   - DB 경로 확인: DB_PATH (미설정 시 ~/.memento/memory.db)');
  log('   - 의존성 재설치: rm -rf node_modules && npm install');
  
  log('\n' + '='.repeat(60), 'cyan');
}

async function main() {
  try {
    log('🚀 Memento MCP Server 자동 설정을 시작합니다...', 'bright');
    
    // npx를 통해 실행되는 경우 네이티브 모듈 재빌드 먼저 시도
    const isNpx = process.env.npm_config_user_config === undefined || 
                   process.env.npm_execpath?.includes('npx') ||
                   process.env.npm_lifecycle_event === 'postinstall';
    
    if (isNpx) {
      await rebuildNativeModules();
    }
    
    await checkNodeVersion();
    await checkDependencies();
    await createDataDirectory();
    await createEnvFile();
    await initializeDatabase();
    await createStartScripts();
    await showUsageInstructions();
    
    logSuccess('자동 설정이 완료되었습니다!');
    
  } catch (error) {
    logError(`자동 설정 중 오류 발생: ${error.message}`);
    process.exit(1);
  }
}

// 스크립트가 직접 실행된 경우에만 main 함수 호출
if (isMain(import.meta.url)) {
  main();
}

export { main as autoSetup };
