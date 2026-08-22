/**
 * memory_item 트리플 추출 컬럼 보정 (마이그레이션 030과 동일 DDL, idempotent).
 * init 경로 외에서 DB를 쓰는 코드·오래된 dist에서도 컬럼 누락을 방지하기 위해 배치 등에서 재사용한다.
 */

import Database from 'better-sqlite3';

function addMissingColumn(
  db: Database.Database,
  tableName: string,
  columnName: string,
  definition: string,
  postUpdateSql?: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  const hasColumn = columns.some(column => column.name === columnName);

  if (!hasColumn) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    if (postUpdateSql) {
      db.exec(postUpdateSql);
    }
  }
}

export function ensureMemoryItemTripleExtractionColumns(db: Database.Database): void {
  const hasTable = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_item' LIMIT 1`)
    .get();
  if (!hasTable) {
    return;
  }
  addMissingColumn(db, 'memory_item', 'triple_extracted', 'BOOLEAN DEFAULT FALSE NOT NULL');
  addMissingColumn(db, 'memory_item', 'triple_extracted_status', 'TEXT');
  addMissingColumn(db, 'memory_item', 'triple_extraction_metadata', 'TEXT');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memory_item_triple_extracted_episodic
      ON memory_item(triple_extracted)
      WHERE type = 'episodic';
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memory_item_triple_extracted_status_episodic
      ON memory_item(triple_extracted_status)
      WHERE type = 'episodic';
  `);
}
