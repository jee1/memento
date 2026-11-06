/**
 * 지운 레거시 CLI 가 되살아나지 않는지 검증 (#750)
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';

describe('레거시 CLI 제거 (#750)', () => {
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
