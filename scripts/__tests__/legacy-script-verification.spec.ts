/**
 * 레거시 스크립트 정리 검증 테스트
 *
 * 래퍼(simple-*-wrapper)가 정식 마이그레이션 경로를 제공하는지 확인.
 * 구 root-src 레거시 CLI(simple-migrate.js / simple-update.js)는 #750에서 제거됨.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('4.6.1 레거시 스크립트 정리 검증', () => {
  it('래퍼 스크립트가 정상적으로 import 가능해야 함', async () => {
    await expect(
      import('../../scripts/simple-migrate-wrapper.js')
    ).resolves.toBeDefined();

    await expect(
      import('../../scripts/simple-update-wrapper.js')
    ).resolves.toBeDefined();
  });

  it('래퍼 스크립트가 필요한 의존성을 가지고 있어야 함', async () => {
    const module = await import('../../scripts/simple-update-wrapper.js');
    expect(module).toHaveProperty('runUpdateMigration');
    expect(typeof module.runUpdateMigration).toBe('function');
  });

  it('구 root-src 레거시 CLI는 제거되어야 함 (#750)', () => {
    const removed = [
      'scripts/simple-migrate.js',
      'scripts/simple-update.js',
    ];
    for (const script of removed) {
      expect(existsSync(join(process.cwd(), script))).toBe(false);
    }
  });

  it('래퍼 스크립트가 logger를 사용해야 함', () => {
    const content = readFileSync(
      join(process.cwd(), 'scripts/simple-migrate-wrapper.ts'),
      'utf-8'
    );
    expect(content).toContain('logger');
    expect(content).toContain('from');
  });
});
