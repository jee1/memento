/**
 * postinstall / auto-setup DB 초기화 (#860).
 *
 * 저장소 전용 `packages/.../init.ts` + `tsx` 경로는 tarball 에 없으므로
 * 설치된 패키지에서는 항상 실패한다. 공개 `@memento/core` API 만 사용한다.
 *
 * @param {{ dbPath?: string, loadCore?: () => Promise<{
 *   initializeDatabase: (path?: string) => Promise<unknown>,
 *   closeDatabase: (db: unknown) => void
 * }> }} [options]
 */
export async function runPostinstallDbInit(options = {}) {
  const loadCore = options.loadCore ?? (() => import('@memento/core'));
  const { initializeDatabase, closeDatabase } = await loadCore();
  const db = await initializeDatabase(options.dbPath);
  closeDatabase(db);
}
