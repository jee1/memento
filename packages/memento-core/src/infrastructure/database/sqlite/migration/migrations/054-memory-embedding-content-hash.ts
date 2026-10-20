import type Database from 'better-sqlite3';
import { hashMemoryContent } from '../../../../../shared/utils/memory-content-hash.js';
import type { Migration } from '../types.js';

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
    item => item.name === column
  );
}

export function ensureMemoryEmbeddingContentHash(db: Database.Database): void {
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

    const pending = db.prepare(
      `SELECT DISTINCT m.id AS id, m.content AS content
       FROM memory_embedding e JOIN memory_item m ON m.id = e.memory_id
       WHERE e.content_hash IS NULL`
    ).all() as Array<{ id: string; content: string }>;
    const backfill = db.prepare(
      'UPDATE memory_embedding SET content_hash = ? WHERE memory_id = ? AND content_hash IS NULL'
    );
    for (const row of pending) {
      backfill.run(hashMemoryContent(row.content), row.id);
    }
  })();
}

export class MemoryEmbeddingContentHashMigration implements Migration {
  version = '54.0';
  name = 'memory-embedding-content-hash';
  description = 'Track source content hashes and invalidate embeddings when memory content changes (#1391)';

  async validateBefore(db: Database.Database): Promise<void> {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_embedding'").get()) {
      throw new Error('Migration 054 requires the memory_embedding table');
    }
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_item'").get()) {
      throw new Error('Migration 054 requires the memory_item table');
    }
  }

  async up(db: Database.Database): Promise<void> {
    ensureMemoryEmbeddingContentHash(db);
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP TRIGGER IF EXISTS memory_item_embedding_content_update');
    if (hasColumn(db, 'memory_embedding', 'content_hash')) {
      db.exec('ALTER TABLE memory_embedding DROP COLUMN content_hash');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!hasColumn(db, 'memory_embedding', 'content_hash')) {
      throw new Error('Migration 054 did not add memory_embedding.content_hash');
    }
    const trigger = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='memory_item_embedding_content_update'"
    ).get();
    if (!trigger) {
      throw new Error('Migration 054 did not install content invalidation trigger');
    }
  }
}

export default MemoryEmbeddingContentHashMigration;
