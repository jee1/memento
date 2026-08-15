/**
 * 레거시 스크립트 제거 후 래퍼 경로 검증 (#750)
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('4.5.1 레거시 스크립트 제거 후 통합 테스트', () => {
  it('래퍼 스크립트가 존재해야 함', () => {
    const wrapperPaths = [
      'scripts/simple-migrate-wrapper.ts',
      'scripts/simple-update-wrapper.ts'
    ];

    for (const path of wrapperPaths) {
      const fullPath = join(process.cwd(), path);
      expect(existsSync(fullPath)).toBe(true);
    }
  });

  it('래퍼 스크립트가 정식 마이그레이션 시스템을 사용해야 함', () => {
    const wrapperContent = readFileSync(
      join(process.cwd(), 'scripts/simple-update-wrapper.ts'),
      'utf-8'
    );

    expect(wrapperContent).toContain('MigrationRunner');
    expect(wrapperContent).toContain('MigrationDetector');
  });

  it('구 root-src 레거시 CLI는 제거되어야 함 (#750)', () => {
    const removed = [
      'scripts/simple-migrate.js',
      'scripts/simple-update.js',
      'scripts/safe-migration.js',
      'scripts/run-migration.js',
      'scripts/fix-migration.js',
      'scripts/check-db-integrity.js',
      'scripts/save-work-memory.ts',
    ];
    for (const path of removed) {
      expect(existsSync(join(process.cwd(), path))).toBe(false);
    }
  });
});
