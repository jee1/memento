/**
 * postinstall / auto-setup DB 초기화 (#860).
 *
 * - 설치 패키지(tarball): `packages/` 없음 → `@memento/core` 공개 API. 실패 시 throw(비0).
 * - 모노레포 체크아웃: `packages/.../init.ts` 존재 → `tsx`로 소스 초기화.
 *   (`npm ci` 직후엔 `@memento/core` dist 가 아직 없어 import 가 깨진다.)
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const REPO_INIT_TS =
  'packages/memento-core/src/infrastructure/database/sqlite/init.ts';

/** @param {string} projectRoot */
export function isMonorepoCheckout(projectRoot) {
  return existsSync(join(projectRoot, REPO_INIT_TS));
}

function defaultProjectRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

/**
 * @param {{
 *   dbPath?: string,
 *   projectRoot?: string,
 *   loadCore?: () => Promise<{
 *     initializeDatabase: (path?: string) => Promise<unknown>,
 *     closeDatabase: (db: unknown) => void
 *   }>,
 *   runMonorepoInit?: (projectRoot: string) => void,
 * }} [options]
 */
export async function runPostinstallDbInit(options = {}) {
  const projectRoot = options.projectRoot ?? defaultProjectRoot();

  // Injectable loadCore always means published-style path (unit tests).
  if (options.loadCore) {
    const { initializeDatabase, closeDatabase } = await options.loadCore();
    const db = await initializeDatabase(options.dbPath);
    closeDatabase(db);
    return;
  }

  if (isMonorepoCheckout(projectRoot)) {
    const run =
      options.runMonorepoInit ??
      ((root) => {
        execSync(`npx tsx ${REPO_INIT_TS}`, {
          cwd: root,
          stdio: 'inherit',
        });
      });
    run(projectRoot);
    return;
  }

  const loadCore = () => import('@memento/core');
  const { initializeDatabase, closeDatabase } = await loadCore();
  const db = await initializeDatabase(options.dbPath);
  closeDatabase(db);
}
