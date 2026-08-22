/**
 * 테스트용 데이터베이스 헬퍼 유틸리티
 * 표준화된 테스트 DB 초기화 및 관리
 */

import Database from 'better-sqlite3';
import { applySchema } from '../../src/infrastructure/database/sqlite/apply-schema.js';
import { configureSqliteSession } from '../../src/infrastructure/database/sqlite/init-sqlite-session.js';
import { populateVecTables } from '../../src/infrastructure/database/sqlite/init-legacy-schema.js';
import { DatabaseUtils } from '../../src/shared/utils/database.js';

/**
 * 표준화된 테스트 데이터베이스 초기화
 *
 * @returns 초기화된 SQLite 데이터베이스 인스턴스
 */
export async function setupTestDatabase(): Promise<Database.Database> {
  const db = new Database(':memory:');
  try {
    await configureSqliteSession(db);
    applySchema(db);
    populateVecTables(db, []);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/**
 * 서비스를 초기화하지 않고 데이터베이스만 준비 (setupTestDatabase와 동일한 역할의 별칭)
 */
export async function createTestDatabaseWithoutServices(): Promise<Database.Database> {
  return await setupTestDatabase();
}

/**
 * 표준화된 테스트 메모리 생성 헬퍼
 *
 * @param db 데이터베이스 인스턴스
 * @param options 메모리 생성 옵션
 * @returns 생성된 메모리 ID
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
    project_id?: string | null;
  }
): string {
  const memoryId = options.id || `mem_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const type = options.type || 'episodic';
  const importance = options.importance ?? 0.5;
  const privacy_scope = options.privacy_scope || 'private';
  const pinned = options.pinned ?? false;
  const tags = options.tags ? JSON.stringify(options.tags) : null;
  const reflection_notes = options.reflection_notes !== undefined ? options.reflection_notes : null;
  const project_id = options.project_id || null;

  DatabaseUtils.run(db, `
    INSERT INTO memory_item (id, type, content, importance, privacy_scope, pinned, tags, source, reflection_notes, project_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    memoryId,
    type,
    options.content,
    importance,
    privacy_scope,
    pinned ? 1 : 0,
    tags,
    options.source || null,
    reflection_notes,
    project_id
  ]);

  return memoryId;
}

/**
 * 테스트 데이터베이스 정리
 *
 * @param db 데이터베이스 인스턴스
 */
export function cleanupTestDatabase(db: Database.Database): void {
  try {
    db.close();
  } catch (error) {
    // 이미 닫혀있거나 오류가 발생해도 무시
  }
}
