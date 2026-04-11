/**
 * Core 패키지 테스트용 DB 헬퍼.
 * createMementoCore로 초기화하고, cleanup 시 스케줄러 정리·DB 종료.
 */

import Database from 'better-sqlite3';
import { initializeDatabase, closeDatabase as closeDb } from '../../infrastructure/database/database/init.js';
import { initializeServices } from '../../bootstrap.js';
import { DatabaseUtils } from '../../shared/utils/database.js';
import { resetBatchScheduler } from '../../infrastructure/scheduler/batch-scheduler.js';

interface MementoCoreInstance {
  db: Database.Database;
  services: Awaited<ReturnType<typeof initializeServices>>;
}

const coreByDb = new WeakMap<Database.Database, MementoCoreInstance>();

/**
 * :memory: DB만 생성 (스키마 적용, 서비스 미기동).
 * BatchScheduler 등 서비스 중복 기동을 피할 때 사용.
 */
export async function createTestDatabaseWithoutServices(): Promise<Database.Database> {
  return initializeDatabase(':memory:');
}

/**
 * :memory: DB로 core 초기화. 반환된 db를 테스트에서 사용 후 cleanupTestDatabase(db) 호출.
 */
export async function setupTestDatabase(): Promise<Database.Database> {
  const db = await initializeDatabase(':memory:');
  const services = await initializeServices(db);
  const core: MementoCoreInstance = { db, services };
  coreByDb.set(db, core);
  return db;
}

/**
 * 테스트 DB 및 BatchScheduler 정리. 반드시 await 호출.
 */
export async function cleanupTestDatabase(db: Database.Database | null | undefined): Promise<void> {
  if (!db) return;
  const core = coreByDb.get(db);
  if (core) {
    try {
      const scheduler = core.services.batchScheduler as { stop?: () => Promise<void> } | undefined;
      if (typeof scheduler?.stop === 'function') {
        await scheduler.stop();
      }
    } catch (_e) {
      // ignore
    } finally {
      resetBatchScheduler();
    }
    try {
      closeDb(core.db);
    } catch (_e) {
      // ignore
    }
    coreByDb.delete(db);
  } else {
    try {
      db.close();
    } catch (_e) {
      // ignore
    }
  }
}

/**
 * 테스트용 메모리 한 건 삽입.
 */
export function createTestMemory(
  db: Database.Database,
  options: {
    id?: string;
    type?: 'working' | 'episodic' | 'semantic' | 'procedural';
    content: string;
    importance?: number;
    privacy_scope?: 'private' | 'team' | 'public';
    pinned?: boolean;
    tags?: string[];
    source?: string;
    reflection_notes?: string | null;
    workflow_name?: string | null;
    skill_name?: string | null;
    steps?: string | null;
    trigger_conditions?: string | null;
    task_goal?: string | null;
    edit_count?: number;
  }
): string {
  const memoryId = options.id ?? `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const type = options.type ?? 'episodic';
  const importance = options.importance ?? 0.5;
  const privacy_scope = options.privacy_scope ?? 'private';
  const pinned = options.pinned ?? false;
  const tags = options.tags != null ? JSON.stringify(options.tags) : null;
  const reflection_notes = options.reflection_notes !== undefined ? options.reflection_notes : null;

  DatabaseUtils.run(db, `
    INSERT INTO memory_item (id, type, content, importance, privacy_scope, pinned, tags, source, reflection_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    memoryId,
    type,
    options.content,
    importance,
    privacy_scope,
    pinned ? 1 : 0,
    tags,
    options.source ?? null,
    reflection_notes
  ]);

  return memoryId;
}
