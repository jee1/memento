/**
 * Memory Item Repository (#1094)
 * 기억 항목 기본 CRUD 및 보존 기간 만료/완전 삭제 쿼리
 */

import type Database from 'better-sqlite3';

export interface MemoryItemEntity {
  id: string;
  content: string;
  type: string;
  importance: number;
  pinned: boolean | number;
  is_deleted: boolean | number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  owner_id?: string | null;
  project_id?: string | null;
}

export class MemoryItemRepository {
  findById(db: Database.Database, id: string): MemoryItemEntity | null {
    const row = db
      .prepare('SELECT * FROM memory_item WHERE id = ?')
      .get(id) as MemoryItemEntity | undefined;
    return row ?? null;
  }

  findExpiredSoftDeleted(db: Database.Database, retentionDays: number): string[] {
    if (retentionDays <= 0) {
      const rows = db
        .prepare('SELECT id FROM memory_item WHERE is_deleted = 1')
        .all() as Array<{ id: string }>;
      return rows.map((r) => r.id);
    }

    const rows = db
      .prepare(
        `SELECT id FROM memory_item 
          WHERE is_deleted = 1 
            AND deleted_at IS NOT NULL 
            AND julianday('now') - julianday(deleted_at) >= ?`,
      )
      .all(retentionDays) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  countActive(db: Database.Database): number {
    const row = db
      .prepare('SELECT COUNT(*) as count FROM memory_item WHERE is_deleted = 0')
      .get() as { count: number };
    return row.count;
  }

  countSoftDeleted(db: Database.Database): number {
    const row = db
      .prepare('SELECT COUNT(*) as count FROM memory_item WHERE is_deleted = 1')
      .get() as { count: number };
    return row.count;
  }
}
