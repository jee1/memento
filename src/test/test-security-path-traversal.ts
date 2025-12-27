/**
 * Path Traversal 취약점 E2E 테스트
 * 
 * PRD 0019: 보안 강화 (Phase 1) - Path Traversal 방지
 * 
 * 사용법:
 *   tsx src/test/test-security-path-traversal.ts
 * 
 * 목표:
 *   - Path Traversal 공격 패턴이 안전하게 차단되는지 확인
 *   - 파일 시스템 접근이 허용된 디렉토리 내에서만 이루어지는지 확인
 *   - 임시 디렉토리를 사용하여 파일 시스템 격리
 */

/* eslint-disable security/detect-non-literal-fs-filename */
// 경로 검증이 적용된 테스트 환경이므로 안전함
import { mkdirSync, writeFileSync, unlinkSync, rmdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { validateFilePath, sanitizeFileName } from '../shared/utils/path-validator.js';

/**
 * 메인 테스트 함수
 */
async function testPathTraversalE2E(): Promise<void> {
  console.log('🧪 Path Traversal 취약점 E2E 테스트 시작\n');
  console.log('다음 공격 패턴을 테스트합니다:\n');
  console.log('1. 상대 경로 패턴: `../../etc/passwd`\n');
  console.log('2. Windows 스타일: `..\\..\\windows\\system32`\n');
  console.log('3. 절대 경로 우회: `/etc/passwd`\n');
  console.log('4. 특수문자 포함 파일명: `file<script>alert("xss")</script>.txt`\n');
  console.log('5. 경로 조작: `data/../../etc/passwd`\n\n');

  let testPassed = 0;
  let testFailed = 0;
  let testTempDir: string | null = null;

  try {
    // Given: 임시 디렉토리 생성 (파일 시스템 격리)
    console.log('1️⃣ 임시 디렉토리 생성 (파일 시스템 격리)...');
    testTempDir = join(tmpdir(), `memento-path-traversal-test-${Date.now()}`);
    mkdirSync(testTempDir, { recursive: true });
    
    // 허용된 디렉토리 생성
    const allowedDataDir = join(testTempDir, 'data');
    const allowedLogsDir = join(testTempDir, 'logs');
    const allowedBackupDir = join(testTempDir, 'backup');
    mkdirSync(allowedDataDir, { recursive: true });
    mkdirSync(allowedLogsDir, { recursive: true });
    mkdirSync(allowedBackupDir, { recursive: true });
    
    // 테스트 파일 생성
    const testFile = join(allowedDataDir, 'test.txt');
    writeFileSync(testFile, 'test content');
    console.log(`✅ 임시 디렉토리 생성 완료: ${testTempDir}\n`);

    // 테스트 1: 상대 경로 패턴 `../../etc/passwd` 차단
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('테스트 1: 상대 경로 패턴 `../../etc/passwd` 차단');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    try {
      // Given: Path Traversal 공격 패턴이 주어졌을 때
      const maliciousPath = '../../etc/passwd';
      console.log(`Given: Path Traversal 공격 패턴: "${maliciousPath}"`);

      // When: validateFilePath()를 호출하면
      console.log('When: validateFilePath() 호출...');
      const result = validateFilePath(maliciousPath);
      console.log(`✅ validateFilePath() 호출 완료 (결과: ${result})`);

      // Then: false를 반환해야 함 (차단)
      console.log('Then: 경로가 차단되었는지 확인...');
      if (!result) {
        console.log('✅ 경로가 차단되었습니다 (예상대로 동작)');
        testPassed++;
      } else {
        console.log('❌ 경로가 허용되었습니다 (보안 취약점!)');
        testFailed++;
      }
    } catch (error) {
      console.log(`✅ 예외 발생 (예상된 동작): ${error instanceof Error ? error.message : String(error)}`);
      testPassed++;
    }
    console.log('');

    // 테스트 2: Windows 스타일 `..\\..\\windows\\system32` 차단
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('테스트 2: Windows 스타일 `..\\..\\windows\\system32` 차단');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    try {
      // Given: Windows 스타일 Path Traversal 공격 패턴이 주어졌을 때
      const maliciousPath = '..\\..\\windows\\system32';
      console.log(`Given: Windows 스타일 Path Traversal 공격 패턴: "${maliciousPath}"`);

      // When: validateFilePath()를 호출하면
      console.log('When: validateFilePath() 호출...');
      const result = validateFilePath(maliciousPath);
      console.log(`✅ validateFilePath() 호출 완료 (결과: ${result})`);

      // Then: false를 반환해야 함 (차단)
      console.log('Then: 경로가 차단되었는지 확인...');
      if (!result) {
        console.log('✅ 경로가 차단되었습니다 (예상대로 동작)');
        testPassed++;
      } else {
        console.log('❌ 경로가 허용되었습니다 (보안 취약점!)');
        testFailed++;
      }
    } catch (error) {
      console.log(`✅ 예외 발생 (예상된 동작): ${error instanceof Error ? error.message : String(error)}`);
      testPassed++;
    }
    console.log('');

    // 테스트 3: 절대 경로 `/etc/passwd` 차단
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('테스트 3: 절대 경로 `/etc/passwd` 차단');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    try {
      // Given: 절대 경로가 주어졌을 때
      const absolutePath = '/etc/passwd';
      console.log(`Given: 절대 경로: "${absolutePath}"`);

      // When: validateFilePath()를 호출하면
      console.log('When: validateFilePath() 호출...');
      const result = validateFilePath(absolutePath);
      console.log(`✅ validateFilePath() 호출 완료 (결과: ${result})`);

      // Then: false를 반환해야 함 (차단)
      console.log('Then: 경로가 차단되었는지 확인...');
      if (!result) {
        console.log('✅ 경로가 차단되었습니다 (예상대로 동작)');
        testPassed++;
      } else {
        console.log('❌ 경로가 허용되었습니다 (보안 취약점!)');
        testFailed++;
      }
    } catch (error) {
      console.log(`✅ 예외 발생 (예상된 동작): ${error instanceof Error ? error.message : String(error)}`);
      testPassed++;
    }
    console.log('');

    // 테스트 4: 특수문자 포함 파일명 정제
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('테스트 4: 특수문자 포함 파일명 정제');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    try {
      // Given: 특수문자가 포함된 파일명이 주어졌을 때
      const unsafeFileName = 'file<script>alert("xss")</script>.txt';
      console.log(`Given: 특수문자 포함 파일명: "${unsafeFileName}"`);

      // When: sanitizeFileName()을 호출하면
      console.log('When: sanitizeFileName() 호출...');
      const sanitized = sanitizeFileName(unsafeFileName);
      console.log(`✅ sanitizeFileName() 호출 완료 (결과: "${sanitized}")`);

      // Then: 특수문자가 제거되어야 함
      console.log('Then: 특수문자가 제거되었는지 확인...');
      const hasSpecialChars = /[<>"()]/.test(sanitized);
      if (!hasSpecialChars && sanitized.match(/^[a-zA-Z0-9._-]+$/)) {
        console.log('✅ 특수문자가 제거되었습니다 (예상대로 동작)');
        testPassed++;
      } else {
        console.log(`❌ 특수문자가 남아있습니다: "${sanitized}"`);
        testFailed++;
      }
    } catch (error) {
      console.log(`❌ 예외 발생: ${error instanceof Error ? error.message : String(error)}`);
      testFailed++;
    }
    console.log('');

    // 테스트 5: 경로 조작 `data/../../etc/passwd` 차단
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('테스트 5: 경로 조작 `data/../../etc/passwd` 차단');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    try {
      // Given: 허용된 디렉토리를 우회하는 경로 조작 패턴이 주어졌을 때
      const maliciousPath = 'data/../../etc/passwd';
      console.log(`Given: 경로 조작 패턴: "${maliciousPath}"`);

      // When: validateFilePath()를 호출하면
      console.log('When: validateFilePath() 호출...');
      const result = validateFilePath(maliciousPath);
      console.log(`✅ validateFilePath() 호출 완료 (결과: ${result})`);

      // Then: false를 반환해야 함 (차단)
      console.log('Then: 경로가 차단되었는지 확인...');
      if (!result) {
        console.log('✅ 경로가 차단되었습니다 (예상대로 동작)');
        testPassed++;
      } else {
        console.log('❌ 경로가 허용되었습니다 (보안 취약점!)');
        testFailed++;
      }
    } catch (error) {
      console.log(`✅ 예외 발생 (예상된 동작): ${error instanceof Error ? error.message : String(error)}`);
      testPassed++;
    }
    console.log('');

    // 테스트 6: 허용된 디렉토리 내 경로는 허용
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('테스트 6: 허용된 디렉토리 내 경로는 허용');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    try {
      // Given: 허용된 디렉토리(data/) 내 경로가 주어졌을 때
      const safePath = 'data/test.txt';
      console.log(`Given: 허용된 디렉토리 내 경로: "${safePath}"`);

      // When: validateFilePath()를 호출하면
      console.log('When: validateFilePath() 호출...');
      const result = validateFilePath(safePath);
      console.log(`✅ validateFilePath() 호출 완료 (결과: ${result})`);

      // Then: true를 반환해야 함 (허용)
      console.log('Then: 경로가 허용되었는지 확인...');
      if (result) {
        console.log('✅ 경로가 허용되었습니다 (예상대로 동작)');
        testPassed++;
      } else {
        console.log('❌ 경로가 차단되었습니다 (정상 경로가 차단됨)');
        testFailed++;
      }
    } catch (error) {
      console.log(`❌ 예외 발생: ${error instanceof Error ? error.message : String(error)}`);
      testFailed++;
    }
    console.log('');

    // 테스트 7: sanitizeFileName() 빈 문자열 처리
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('테스트 7: sanitizeFileName() 빈 문자열 처리');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    try {
      // Given: 빈 문자열이 주어졌을 때
      const emptyFileName = '';
      console.log(`Given: 빈 문자열: "${emptyFileName}"`);

      // When: sanitizeFileName()을 호출하면
      console.log('When: sanitizeFileName() 호출...');
      const sanitized = sanitizeFileName(emptyFileName);
      console.log(`✅ sanitizeFileName() 호출 완료 (결과: "${sanitized}")`);

      // Then: 기본 파일명을 반환해야 함
      console.log('Then: 기본 파일명이 반환되었는지 확인...');
      if (sanitized === 'file') {
        console.log('✅ 기본 파일명이 반환되었습니다 (예상대로 동작)');
        testPassed++;
      } else {
        console.log(`❌ 기본 파일명이 반환되지 않았습니다: "${sanitized}"`);
        testFailed++;
      }
    } catch (error) {
      console.log(`❌ 예외 발생: ${error instanceof Error ? error.message : String(error)}`);
      testFailed++;
    }
    console.log('');

    // 테스트 결과 요약
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('테스트 결과 요약');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`✅ 통과: ${testPassed}개`);
    console.log(`❌ 실패: ${testFailed}개`);
    console.log(`📊 총계: ${testPassed + testFailed}개\n`);

    if (testFailed === 0) {
      console.log('🎉 모든 테스트가 통과했습니다! Path Traversal 방지가 정상적으로 작동합니다.\n');
      process.exit(0);
    } else {
      console.log('⚠️  일부 테스트가 실패했습니다. 보안 취약점이 있을 수 있습니다.\n');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ 테스트 실행 중 오류 발생:', error);
    process.exit(1);
  } finally {
    // 파일 시스템 정리
    if (testTempDir && existsSync(testTempDir)) {
      try {
        // 테스트 파일 삭제
        const testFile = join(testTempDir, 'data', 'test.txt');
        if (existsSync(testFile)) {
          unlinkSync(testFile);
        }
        // 디렉토리 삭제
        rmdirSync(join(testTempDir, 'data'));
        rmdirSync(join(testTempDir, 'logs'));
        rmdirSync(join(testTempDir, 'backup'));
        rmdirSync(testTempDir);
        console.log(`✅ 임시 디렉토리 정리 완료: ${testTempDir}`);
      } catch (cleanupError) {
        console.warn(`⚠️  임시 디렉토리 정리 실패: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
      }
    }
  }
}

// 스크립트 직접 실행 시 테스트 실행
if (import.meta.url === `file://${process.argv[1]}`) {
  testPathTraversalE2E().catch(error => {
    console.error('❌ 테스트 실행 실패:', error);
    process.exit(1);
  });
}

export { testPathTraversalE2E };

