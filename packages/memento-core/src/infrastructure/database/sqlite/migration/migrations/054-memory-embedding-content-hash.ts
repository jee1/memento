import type Database from 'better-sqlite3';
import { ensureMemoryEmbeddingContentHash } from '../../../../../shared/utils/ensure-memory-embedding-content-hash.js';
import type { Migration } from '../types.js';

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
    item => item.name === column
  );
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
