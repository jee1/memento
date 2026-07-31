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
      CREATE TABLE memory_relation (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, target_id TEXT NOT NULL, relation_type TEXT NOT NULL
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

  describe('#710: backfillSemanticRelationEndpoints', () => {
    beforeEach(() => {
      // 'one'은 이미 임베딩이 있음. 'two'는 semantic이 아니므로 대상에서 제외되어야 함(기본 type='semantic')
      db.prepare("UPDATE memory_item SET type = 'episodic' WHERE id = 'two'").run();
      db.prepare("INSERT INTO memory_item (id, content, type, owner_id) VALUES ('three', 'third', 'semantic', 'a')").run();
      db.prepare("INSERT INTO memory_item (id, content, type, owner_id) VALUES ('orphan-semantic', 'orphan', 'semantic', 'a')").run();
      // 'three'는 memory_relation의 endpoint (target)
      db.prepare("INSERT INTO memory_relation (source_id, target_id, relation_type) VALUES ('two', 'three', 'extracted_from')").run();
    });

    it('semantic이면서 relation endpoint이고 임베딩이 없는 메모리만 대상으로 삼아야 함', () => {
      const service = new EmbeddingReindexService(db, { isAvailable: () => true } as any);
      const candidates = service.findSemanticRelationEndpointsMissingEmbedding('minilm', 100);

      // 'orphan-semantic'은 relation endpoint가 아니므로 제외
      expect(candidates.map(c => c.id)).toEqual(['three']);
    });

    it('limit 파라미터로 제한된 개수만 반환해야 함', () => {
      db.prepare("INSERT INTO memory_item (id, content, type, owner_id) VALUES ('four', 'fourth', 'semantic', 'a')").run();
      db.prepare("INSERT INTO memory_relation (source_id, target_id, relation_type) VALUES ('two', 'four', 'extracted_from')").run();

      const service = new EmbeddingReindexService(db, { isAvailable: () => true } as any);
      const candidates = service.findSemanticRelationEndpointsMissingEmbedding('minilm', 1);

      expect(candidates.length).toBe(1);
    });

    it('dry-run이면 임베딩을 생성하지 않고 후보 수만 반환해야 함', async () => {
      const createAndStoreEmbedding = vi.fn();
      const service = new EmbeddingReindexService(db, { isAvailable: () => true, createAndStoreEmbedding });

      const result = await service.backfillSemanticRelationEndpoints({ provider: 'minilm', limit: 100, dryRun: true });

      expect(result).toMatchObject({ candidateCount: 1, dryRun: true, processedCount: 1, storedCount: 0, failedCount: 0 });
      expect(createAndStoreEmbedding).not.toHaveBeenCalled();
    });

    it('임베딩을 생성하고 저장해야 함', async () => {
      const service = new EmbeddingReindexService(db, {
        isAvailable: () => true,
        createAndStoreEmbedding: vi.fn().mockImplementation(async (_db, memoryId) => {
          db.prepare("INSERT INTO memory_embedding (memory_id, embedding_provider, projection_type, embedding, dim, dimensions) VALUES (?, 'minilm', 'native', '[]', 384, 384)").run(memoryId);
          return { provider: 'minilm', embedding: Array(384).fill(0) };
        })
      });

      const result = await service.backfillSemanticRelationEndpoints({ provider: 'minilm', limit: 100 });

      expect(result).toMatchObject({ candidateCount: 1, dryRun: false, processedCount: 1, storedCount: 1, failedCount: 0 });
      expect(db.prepare("SELECT dim FROM memory_embedding WHERE memory_id = 'three'").get()).toEqual({ dim: 384 });
    });

    it('임베딩 서비스가 사용 불가능하면 에러를 던져야 함', async () => {
      const service = new EmbeddingReindexService(db, { isAvailable: () => false } as any);
      await expect(service.backfillSemanticRelationEndpoints({ provider: 'minilm' })).rejects.toThrow('embedding service is unavailable');
    });

    it('limit이 범위를 벗어나면 에러를 던져야 함', async () => {
      const service = new EmbeddingReindexService(db, { isAvailable: () => true } as any);
      await expect(service.backfillSemanticRelationEndpoints({ provider: 'minilm', limit: 0 })).rejects.toThrow();
      await expect(service.backfillSemanticRelationEndpoints({ provider: 'minilm', limit: 5000 })).rejects.toThrow();
    });
  });
});
