/**
 * Migration: 068 — 삭제 시각 없는 소프트 삭제 행 보정 (#1752)
 * Version: 68.0
 *
 * 테이블과 컬럼을 바꾸지 않는다. migration 048 이 `is_deleted = 1` 만 쓰고 `deleted_at` 을 비운 행이 있다.
 * 유예 뒤 정리는 `deleted_at` 이 있는 행만 보므로 이 행은 영원히 지워지지 않았다. 지금을 삭제 시각으로 채운다.
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

export class BackfillDeletedAtMigration implements Migration {
  version = '68.0';
  name = 'backfill-deleted-at';
  description = 'Data only: set deleted_at on soft-deleted memory_item rows that lack it (#1752)';

  async validateBefore(_db: Database.Database): Promise<void> {}

  async up(db: Database.Database): Promise<void> {
    db.prepare(
      `UPDATE memory_item SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE COALESCE(is_deleted, 0) = 1 AND (deleted_at IS NULL OR deleted_at = '')`,
    ).run();
  }

  async down(db: Database.Database): Promise<void> {
    const ver = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memento_schema_version'`)
      .get();
    if (ver) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run(this.version);
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    const left = db
      .prepare(`SELECT COUNT(*) AS n FROM memory_item WHERE COALESCE(is_deleted, 0) = 1 AND (deleted_at IS NULL OR deleted_at = '')`)
      .get() as { n: number };
    if (left.n > 0) {
      throw new Error(`Migration 068 left ${left.n} soft-deleted rows without deleted_at`);
    }
  }
}
