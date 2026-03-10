#!/usr/bin/env node

/**
 * npm publish 전 bin 파일 검증 스크립트
 * bin 필드에 지정된 파일들이 존재하고 실행 가능한지 확인
 */

import { existsSync, statSync } from 'fs';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// package.json에서 bin 필드 읽기
const packageJson = JSON.parse(
  readFileSync(join(projectRoot, 'package.json'), 'utf-8')
);

const bin = packageJson.bin;

if (!bin) {
  console.error('❌ package.json에 bin 필드가 없습니다.');
  process.exit(1);
}

let hasErrors = false;

// bin 필드의 각 파일 검증
for (const [name, path] of Object.entries(bin)) {
  // npm 공개 패키지는 workspace 내부 경로를 bin으로 노출하면 npx 설치 시 의존성 해석이 깨질 수 있음
  if (path.startsWith('./packages/') || path.startsWith('packages/')) {
    console.error(`❌ workspace 내부 bin 경로는 사용할 수 없습니다: ${name} -> ${path}`);
    hasErrors = true;
    continue;
  }

  const fullPath = join(projectRoot, path);
  
  console.log(`\n🔍 검증 중: ${name} -> ${path}`);
  
  // 파일 존재 확인
  if (!existsSync(fullPath)) {
    console.error(`❌ 파일이 존재하지 않습니다: ${fullPath}`);
    hasErrors = true;
    continue;
  }
  
  // 파일 읽기 가능 확인
  try {
    const stats = statSync(fullPath);
    if (!stats.isFile()) {
      console.error(`❌ 파일이 아닙니다: ${fullPath}`);
      hasErrors = true;
      continue;
    }
  } catch (error) {
    console.error(`❌ 파일 접근 실패: ${fullPath}`, error.message);
    hasErrors = true;
    continue;
  }
  
  // shebang 확인 (Node.js 실행 파일인 경우)
  if (path.endsWith('.js')) {
    try {
      const content = readFileSync(fullPath, 'utf-8');
      if (!content.startsWith('#!/usr/bin/env node')) {
        console.warn(`⚠️  shebang이 없습니다: ${fullPath}`);
        console.warn(`   파일은 실행되지만, 직접 실행 시 문제가 될 수 있습니다.`);
      } else {
        console.log(`✅ shebang 확인됨`);
      }
    } catch (error) {
      console.error(`❌ 파일 읽기 실패: ${fullPath}`, error.message);
      hasErrors = true;
      continue;
    }
  }
  
  console.log(`✅ ${name} 검증 완료`);
}

if (hasErrors) {
  console.error('\n❌ bin 파일 검증 실패');
  console.error('npm publish 전에 모든 bin 파일이 올바르게 빌드되었는지 확인하세요.');
  process.exit(1);
} else {
  console.log('\n✅ 모든 bin 파일 검증 완료');
}
