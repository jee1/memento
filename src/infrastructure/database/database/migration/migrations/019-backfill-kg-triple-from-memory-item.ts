/**
 * Migration: 019 - Backfill kg_triple from memory_item (Issue #90)
 * Description: 기존 semantic memory_item 중 subject,predicate,object 있는 행을 kg_triple에 채움
 * Version: 19.0
 * Date: 2026-02-08
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

/**
 * Backfill kg_triple from existing memory_item (Issue #90)
 *
 * type='semantic'이고 subject, predicate, object가 모두 NOT NULL인 행을 스캔하여
 * (subject, predicate, object)당 한 행만 kg_triple에 INSERT. 동일 (s,p,o) 여러 개면
 * created_at 기준 가장 이른 하나를 representative로 사용.
 */
export class BackfillKgTripleFromMemoryItemMigration implements Migration {
  version = '19.0';
  name = 'backfill-kg-triple-from-memory-item';
  description = 'Backfill kg_triple from existing semantic memory_item (Issue #90)';

  private tableExists(db: Database.Database, tableName: string): boolean {
    const result = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
    ).get(tableName);
    return !!result;
  }

  async validateBefore(db: Database.Database): Promise<void> {
    if (!this.tableExists(db, 'memory_item')) {
      throw new Error('memory_item table does not exist.');
    }
    if (!this.tableExists(db, 'kg_triple')) {
      throw new Error('kg_triple table does not exist. Run migration 018 first.');
    }
    if (this.tableExists(db, 'memento_schema_version')) {
      const row = db.prepare(
        `SELECT version FROM memento_schema_version WHERE version = ?`
      ).get('19.0') as { version: string } | undefined;
      if (row) {
        throw new Error('Migration 019 has already been applied.');
      }
    }
  }

  async up(db: Database.Database): Promise<void> {
    const rows = db.prepare(`
      SELECT id, subject, predicate, object, owner_id, process_id, session_id, created_at
      FROM memory_item
      WHERE type = 'semantic'
        AND subject IS NOT NULL AND subject != ''
        AND predicate IS NOT NULL AND predicate != ''
        AND object IS NOT NULL AND object != ''
      ORDER BY created_at ASC
    `).all() as Array<{
      id: string;
      subject: string;
      predicate: string;
      object: string;
      owner_id: string | null;
      process_id: string | null;
      session_id: string | null;
      created_at: string | null;
    }>;

    const seen = new Set<string>();
    const insert = db.prepare(`
      INSERT OR IGNORE INTO kg_triple (id, subject, predicate, object, owner_id, process_id, session_id, representative_memory_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const row of rows) {
      const key = `${row.subject}\t${row.predicate}\t${row.object}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const kgId = `triple_backfill_${row.id}`;
      insert.run(
        kgId,
        row.subject,
        row.predicate,
        row.object,
        row.owner_id ?? null,
        row.process_id ?? null,
        row.session_id ?? null,
        row.id,
        row.created_at ?? null
      );
    }

    if (this.tableExists(db, 'memento_schema_version')) {
      try {
        db.prepare(
          `INSERT INTO memento_schema_version (version, migration_name, description) VALUES (?, ?, ?)`
        ).run('19.0', this.name, this.description);
      } catch {
        db.prepare(
          `INSERT INTO memento_schema_version (version, migration_name) VALUES (?, ?)`
        ).run('19.0', this.name);
      }
    }
  }

  async down(db: Database.Database): Promise<void> {
    // Backfill은 비가역. down은 no-op (제거 시 신규 추출 triple과 구분 불가).
    if (this.tableExists(db, 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('19.0');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    // 최소한 kg_triple이 존재하고 019가 적용된 상태
    if (this.tableExists(db, 'memento_schema_version')) {
      const row = db.prepare(
        `SELECT version FROM memento_schema_version WHERE version = ?`
      ).get('19.0') as { version: string } | undefined;
      if (!row) {
        throw new Error('Migration 019 version was not recorded');
      }
    }
  }
}
