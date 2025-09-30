#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
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
  try {
    logStep('데이터베이스 초기화', 'SQLite 데이터베이스 설정 중...');
    
    // TypeScript 파일을 직접 실행
    execSync('npx tsx src/database/init.ts', { 
      cwd: projectRoot, 
      stdio: 'inherit' 
    });
    
    logSuccess('데이터베이스 초기화 완료');
  } catch (error) {
    logError(`데이터베이스 초기화 실패: ${error.message}`);
    logWarning('수동으로 실행하세요: npm run db:init');
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
  log('   - 데이터베이스 재초기화: npm run db:init');
  log('   - 의존성 재설치: rm -rf node_modules && npm install');
  
  log('\n' + '='.repeat(60), 'cyan');
}

async function main() {
  try {
    log('🚀 Memento MCP Server 자동 설정을 시작합니다...', 'bright');
    
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
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main as autoSetup };
