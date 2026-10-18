import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { hashMemoryContent } from '../../../shared/utils/memory-content-hash.js';
import { MemoryEmbeddingContentHashMigration } from '../../database/sqlite/migration/migrations/054-memory-embedding-content-hash.js';
import { EmbeddingReconciliationBatchJob } from './embedding-reconciliation-batch-job.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE memory_item (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      type TEXT NOT NULL,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE memory_embedding (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      embedding_provider TEXT NOT NULL,
      projection_type TEXT NOT NULL DEFAULT 'native',
      content_hash TEXT,
      UNIQUE(memory_id, embedding_provider, projection_type)
    );
  `);
  return db;
}

function insertEmbedding(db: Database.Database, memoryId: string, contentHash: string): void {
  db.prepare(
    `INSERT INTO memory_embedding (memory_id, embedding_provider, projection_type, content_hash)
     VALUES (?, 'tfidf', 'native', ?)`
  ).run(memoryId, contentHash);
}

describe('EmbeddingReconciliationBatchJob', () => {
  it('reconciles all active memories in one cycle and excludes deleted memories', async () => {
    const db = createDb();
    try {
      const migration = new MemoryEmbeddingContentHashMigration();
      await migration.up(db);
      db.prepare("INSERT INTO memory_item (id, content, type) VALUES ('one', 'one', 'semantic'), ('two', 'two', 'procedural'), ('gone', 'gone', 'semantic')").run();
      db.prepare("UPDATE memory_item SET is_deleted = 1 WHERE id = 'gone'").run();

      const createAndStoreEmbedding = vi.fn(async (_db, memoryId: string, content: string) => {
        insertEmbedding(db, memoryId, hashMemoryContent(content));
        return { provider: 'tfidf' };
      });
      const job = new EmbeddingReconciliationBatchJob(db, { createAndStoreEmbedding } as never);

      const result = await job.run();

      expect(result.success).toBe(true);
      expect(result.processed).toBe(2);
      expect(createAndStoreEmbedding).toHaveBeenCalledTimes(2);
      expect(db.prepare('SELECT COUNT(*) AS n FROM memory_embedding').get()).toEqual({ n: 2 });
    } finally {
      db.close();
    }
  });

  it('retries a failed re-embedding in the next cycle after content changes', async () => {
    const db = createDb();
    try {
      const migration = new MemoryEmbeddingContentHashMigration();
      await migration.up(db);
      db.prepare("INSERT INTO memory_item (id, content, type) VALUES ('memory', 'old content', 'procedural')").run();
      insertEmbedding(db, 'memory', hashMemoryContent('old content'));

      db.prepare("UPDATE memory_item SET content = 'new content' WHERE id = 'memory'").run();
      expect(db.prepare('SELECT COUNT(*) AS n FROM memory_embedding').get()).toEqual({ n: 0 });

      const createAndStoreEmbedding = vi.fn()
        .mockResolvedValueOnce(null)
        .mockImplementationOnce(async (_db, memoryId: string, content: string) => {
          insertEmbedding(db, memoryId, hashMemoryContent(content));
          return { provider: 'tfidf' };
        });
      const job = new EmbeddingReconciliationBatchJob(db, { createAndStoreEmbedding } as never);

      const failedCycle = await job.run();
      expect(failedCycle.success).toBe(false);
      expect(failedCycle.details).toEqual({ candidates: 1, remaining: 1 });
      expect(db.prepare('SELECT COUNT(*) AS n FROM memory_embedding').get()).toEqual({ n: 0 });

      const retryCycle = await job.run();
      expect(retryCycle.success).toBe(true);
      expect(retryCycle.details).toEqual({ candidates: 1, remaining: 0 });
      expect(db.prepare('SELECT content_hash FROM memory_embedding').get()).toEqual({
        content_hash: hashMemoryContent('new content'),
      });
      expect(createAndStoreEmbedding).toHaveBeenCalledTimes(2);
    } finally {
      db.close();
    }
  });
});
