import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { EmbeddingReindexService } from '../embedding-reindex-service.js';

describe('EmbeddingReindexService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE memory_item (id TEXT PRIMARY KEY, content TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'semantic', owner_id TEXT, is_deleted INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE memory_embedding (
        memory_id TEXT NOT NULL, embedding_provider TEXT NOT NULL, projection_type TEXT NOT NULL,
        embedding TEXT NOT NULL, dim INTEGER NOT NULL, dimensions INTEGER, model TEXT, created_by TEXT, created_at TEXT,
        UNIQUE(memory_id, embedding_provider, projection_type)
      );
    `);
    db.prepare("INSERT INTO memory_item (id, content, owner_id) VALUES ('one', 'first', 'a'), ('two', 'second', 'b')").run();
    db.prepare("INSERT INTO memory_embedding (memory_id, embedding_provider, projection_type, embedding, dim, dimensions) VALUES ('one', 'minilm', 'native', '[]', 512, 512)").run();
  });

  afterEach(() => db.close());

  it('reports missing embeddings, dimension mismatches, and provider drift by owner', () => {
    const service = new EmbeddingReindexService(db, { isAvailable: () => true } as any);
    expect(service.diagnose({ provider: 'minilm', ownerId: 'a' })).toMatchObject({
      memoryCount: 1, providerEmbeddingCount: 1, missingEmbeddingCount: 0, dimensionMismatchCount: 1, providerDriftCount: 0,
    });
    expect(service.diagnose({ provider: 'minilm', ownerId: 'b' })).toMatchObject({
      memoryCount: 1, providerEmbeddingCount: 0, missingEmbeddingCount: 1, providerDriftCount: 0,
    });
  });

  it('dry-runs without generating or storing embeddings', async () => {
    const createAndStoreEmbedding = vi.fn();
    const service = new EmbeddingReindexService(db, { isAvailable: () => true, createAndStoreEmbedding });
    await expect(service.reindex({ provider: 'minilm', ownerId: 'b', dryRun: true, batchSize: 1 })).resolves.toMatchObject({
      dryRun: true, processedCount: 1, storedCount: 0,
    });
    expect(createAndStoreEmbedding).not.toHaveBeenCalled();
  });

  it('stores only embeddings produced by the requested provider and expected dimension', async () => {
    const service = new EmbeddingReindexService(db, {
      isAvailable: () => true,
      createAndStoreEmbedding: vi.fn().mockImplementation(async (_db, memoryId) => {
        db.prepare("INSERT INTO memory_embedding (memory_id, embedding_provider, projection_type, embedding, dim, dimensions) VALUES (?, 'minilm', 'native', '[]', 384, 384)").run(memoryId);
        return { provider: 'minilm', embedding: Array(384).fill(0) };
      }),
    });
    await expect(service.reindex({ provider: 'minilm', ownerId: 'b' })).resolves.toMatchObject({ storedCount: 1, failedCount: 0 });
    expect(db.prepare("SELECT dim FROM memory_embedding WHERE memory_id = 'two' AND embedding_provider = 'minilm'").get()).toEqual({ dim: 384 });
  });
});
