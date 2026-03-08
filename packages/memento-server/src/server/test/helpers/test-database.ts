/**
 * 서버 패키지 테스트용 DB 헬퍼. @memento/core로 초기화·종료.
 */

import {
  createMementoCore,
  closeDatabase,
  type MementoCoreInstance
} from '@memento/core';

export interface TestDatabaseContext {
  db: MementoCoreInstance['db'];
  services: MementoCoreInstance['services'];
}

/**
 * :memory: DB로 core 인스턴스 생성. 테스트에서 db, services 사용 후 cleanupTestDatabase 호출.
 */
export async function setupTestDatabase(): Promise<TestDatabaseContext> {
  const core = await createMementoCore({ dbPath: ':memory:' });
  return { db: core.db, services: core.services };
}

/**
 * 테스트 DB 및 스케줄러 정리.
 */
export async function cleanupTestDatabase(ctx: TestDatabaseContext | null): Promise<void> {
  if (!ctx) return;
  try {
    const scheduler = ctx.services.batchScheduler as { stop(): Promise<void> } | undefined;
    if (scheduler?.stop) {
      await scheduler.stop();
    }
  } catch (e) {
    // ignore
  }
  try {
    closeDatabase(ctx.db);
  } catch (e) {
    // ignore
  }
}
