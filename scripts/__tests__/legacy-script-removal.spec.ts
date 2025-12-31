/**
 * 레거시 스크립트 제거 전 통합 테스트
 * 
 * 4.5.1: 사용되지 않는 스크립트 제거 전 통합 테스트 작성
 * 
 * 이 테스트는 레거시 스크립트가 제거된 후에도 시스템이 정상 작동하는지 확인합니다.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';

describe('4.5.1 레거시 스크립트 제거 전 통합 테스트', () => {
  it('래퍼 스크립트가 존재해야 함', () => {
    // Given: 래퍼 스크립트 경로
    const wrapperPaths = [
      'scripts/simple-migrate-wrapper.ts',
      'scripts/simple-update-wrapper.ts'
    ];
    
    // When: 파일 존재 확인
    // Then: 모든 래퍼 스크립트가 존재해야 함
    for (const path of wrapperPaths) {
      const fullPath = join(process.cwd(), path);
      expect(existsSync(fullPath)).toBe(true);
    }
  });

  it('래퍼 스크립트가 정식 마이그레이션 시스템을 사용해야 함', () => {
    // Given: 래퍼 스크립트 내용 확인
    const { readFileSync } = require('fs');
    
    // When: simple-update-wrapper.ts 내용 확인
    const wrapperContent = readFileSync(
      join(process.cwd(), 'scripts/simple-update-wrapper.ts'),
      'utf-8'
    );
    
    // Then: MigrationRunner와 MigrationDetector를 사용해야 함
    expect(wrapperContent).toContain('MigrationRunner');
    expect(wrapperContent).toContain('MigrationDetector');
  });

  it('레거시 스크립트가 @deprecated 표시를 포함해야 함', () => {
    // Given: 레거시 스크립트 경로
    const legacyPaths = [
      'scripts/simple-migrate.js',
      'scripts/simple-update.js'
    ];
    
    // When: 파일 내용 확인
    const { readFileSync } = require('fs');
    
    // Then: @deprecated 표시가 있어야 함
    for (const path of legacyPaths) {
      const fullPath = join(process.cwd(), path);
      if (existsSync(fullPath)) {
        const content = readFileSync(fullPath, 'utf-8');
        expect(content).toContain('@deprecated');
        expect(content).toContain('래퍼');
      }
    }
  });
});

