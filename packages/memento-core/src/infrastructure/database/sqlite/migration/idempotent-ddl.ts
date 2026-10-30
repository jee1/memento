/**
 * 마이그레이션 up() 과 레거시 테스트 부트스트랩 전용 idempotent DDL.
 * 운영 서비스 경로에서는 호출하지 않는다 (#1535).
 */

import type Database from 'better-sqlite3';
import { hashMemoryContent } from '../../../../shared/utils/memory-content-hash.js';

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
    (item) => item.name === column,
  );
}

export function applyWorkRecordColumn(db: Database.Database): void {
  if (!hasColumn(db, 'memory_item', 'work_record')) {
    db.exec('ALTER TABLE memory_item ADD COLUMN work_record TEXT');
  }
}

export function applyMemoryEmbeddingContentHash(db: Database.Database): void {
  db.transaction(() => {
    if (!hasColumn(db, 'memory_embedding', 'content_hash')) {
      db.exec('ALTER TABLE memory_embedding ADD COLUMN content_hash TEXT');
    }
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_item_embedding_content_update
      AFTER UPDATE OF content ON memory_item
      WHEN OLD.content IS NOT NEW.content
      BEGIN
        DELETE FROM memory_embedding WHERE memory_id = NEW.id;
      END;
    `);

    const pending = db
      .prepare(
        `SELECT DISTINCT m.id AS id, m.content AS content
       FROM memory_embedding e JOIN memory_item m ON m.id = e.memory_id
       WHERE e.content_hash IS NULL`,
      )
      .all() as Array<{ id: string; content: string }>;
    const backfill = db.prepare(
      'UPDATE memory_embedding SET content_hash = ? WHERE memory_id = ? AND content_hash IS NULL',
    );
    for (const row of pending) {
      backfill.run(hashMemoryContent(row.content), row.id);
    }
  })();
}
