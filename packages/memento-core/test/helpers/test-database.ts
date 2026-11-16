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
 * recall 통계 수집 시작 시각을 과거로 둔다 (#1751).
 * 망각은 통계가 비어 있으면 「지금 막 수집을 시작했다」로 보고 working 말고는 지우지 않는다.
 * 핀 고정한 기억 하나에 통계 행을 붙인다. 핀 고정 기억은 망각 대상이 아니라 다른 기억의 점수가 바뀌지 않는다.
 */
export function startRecallStatsAt(db: Database.Database, startedAt: Date): void {
  const witness = createTestMemory(db, { content: 'recall stats witness', type: 'semantic', pinned: true });
  const at = startedAt.toISOString();
  DatabaseUtils.run(
    db,
    'INSERT INTO meta_memory_stats (memory_id, recall_count, created_at, updated_at) VALUES (?, 0, ?, ?)',
    [witness, at, at],
  );
  const hasVersionTable = DatabaseUtils.get(db, `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memento_schema_version'`);
  if (hasVersionTable) {
    DatabaseUtils.run(db, `UPDATE memento_schema_version SET applied_at = ? WHERE migration_name = 'recall-use-recording-start'`, [at]);
  }
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
