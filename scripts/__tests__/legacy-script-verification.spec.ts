/**
 * 레거시 스크립트 정리 검증 테스트
 * 
 * 4.6.1: 모든 스크립트가 정상 동작하는지 통합 테스트 작성
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';

describe('4.6.1 레거시 스크립트 정리 검증', () => {
  it('래퍼 스크립트가 정상적으로 import 가능해야 함', async () => {
    // Given: 래퍼 스크립트 모듈
    // When: 모듈 import
    // Then: 에러가 발생하지 않아야 함
    await expect(
      import('../../scripts/simple-migrate-wrapper.js')
    ).resolves.toBeDefined();
    
    await expect(
      import('../../scripts/simple-update-wrapper.js')
    ).resolves.toBeDefined();
  });

  it('래퍼 스크립트가 필요한 의존성을 가지고 있어야 함', async () => {
    // Given: simple-update-wrapper 모듈
    const module = await import('../../scripts/simple-update-wrapper.js');
    
    // When: export 확인
    // Then: runUpdateMigration 함수가 export되어야 함
    expect(module).toHaveProperty('runUpdateMigration');
    expect(typeof module.runUpdateMigration).toBe('function');
  });

  it('레거시 스크립트가 존재하는 경우 @deprecated 표시가 있어야 함', () => {
    // Given: 레거시 스크립트 경로
    const legacyScripts = [
      'scripts/simple-migrate.js',
      'scripts/simple-update.js'
    ];
    
    // When: 파일 존재 및 내용 확인
    const { readFileSync } = require('fs');
    
    for (const script of legacyScripts) {
      const fullPath = join(process.cwd(), script);
      if (existsSync(fullPath)) {
        const content = readFileSync(fullPath, 'utf-8');
        
        // Then: @deprecated 표시와 래퍼 안내가 있어야 함
        expect(content).toContain('@deprecated');
        expect(content).toContain('래퍼');
      }
    }
  });

  it('래퍼 스크립트가 logger를 사용해야 함', async () => {
    // Given: simple-migrate-wrapper 모듈
    const { readFileSync } = require('fs');
    const content = readFileSync(
      join(process.cwd(), 'scripts/simple-migrate-wrapper.ts'),
      'utf-8'
    );
    
    // When: logger 사용 확인
    // Then: logger를 import하고 사용해야 함
    expect(content).toContain('logger');
    expect(content).toContain('from');
  });
});

