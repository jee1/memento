/**
 * Migration: 045 — vec 인덱스 고아 행 정리
 * Version: 45.0
 *
 * `INSERT OR REPLACE INTO memory_embedding`이 DELETE 트리거를 건너뛰는 바람에
 * 재임베딩할 때마다 vec0 테이블에 아무도 참조하지 않는 행이 남았다. 쓰기 경로는
 * `memory-embedding-write.ts`에서 고쳤고, 이 마이그레이션은 이미 쌓인 행을 치운다.
 *
 * 고아 행은 결과로 나오지 않지만 KNN의 LIMIT 예산을 먼저 소진한다. 실측: 8213행이어야
 * 할 memory_item_vec_minilm이 16417행이었고, 그중 8204행이 고아였다.
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

const VEC_TABLES = [
  'memory_item_vec',
  'memory_item_vec_tfidf',
  'memory_item_vec_minilm',
  'memory_item_vec_openai',
  'memory_item_vec_gemini',
];

/**
 * vec0 가상 테이블은 sqlite-vec 확장이 로드돼 있어야 열린다. 확장 없이 뜬 DB에서는
 * 정리할 인덱스 자체가 없으므로 조용히 건너뛴다.
 */
function isQueryable(db: Database.Database, table: string): boolean {
  try {
    db.prepare(`SELECT rowid FROM ${table} LIMIT 1`).get();
    return true;
  } catch {
    return false;
  }
}

export function deleteOrphanVecRows(db: Database.Database): number {
  let deleted = 0;
  for (const table of VEC_TABLES) {
    if (!isQueryable(db, table)) continue;
    deleted += db
      .prepare(`DELETE FROM ${table} WHERE rowid NOT IN (SELECT id FROM memory_embedding)`)
      .run().changes;
  }
  return deleted;
}

export class VecOrphanCleanupMigration implements Migration {
  version = '45.0';
  name = 'vec-orphan-cleanup';
  description = 'Delete vec0 index rows left behind by INSERT OR REPLACE on memory_embedding';

  async validateBefore(db: Database.Database): Promise<void> {
    const exists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_embedding'")
      .get();
    if (!exists) throw new Error('Migration 045 requires the memory_embedding table');
  }

  async up(db: Database.Database): Promise<void> {
    deleteOrphanVecRows(db);
  }

  /** 삭제한 행은 재생성할 수 없다. 되돌릴 것이 없으므로 no-op이다. */
  async down(_db: Database.Database): Promise<void> {
    // no-op
  }

  async validateAfter(db: Database.Database): Promise<void> {
    for (const table of VEC_TABLES) {
      if (!isQueryable(db, table)) continue;
      const row = db
        .prepare(
          `SELECT COUNT(*) AS c FROM ${table} WHERE rowid NOT IN (SELECT id FROM memory_embedding)`
        )
        .get() as { c: number };
      if (row.c > 0) throw new Error(`Migration 045 left ${row.c} orphan rows in ${table}`);
    }
  }
}

export default VecOrphanCleanupMigration;
