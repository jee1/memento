import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ConsolidationRepository } from './consolidation-repository.js';
import { applyConsolidationTestSchema } from '../__tests__/consolidation-test-schema.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { encodeFloat32Embedding } from '../../../shared/utils/embedding-serialization.js';

function insertEmbedding(
  db: Database.Database,
  memoryId: string,
  vec: number[],
  provider: string,
  model: string
): void {
  DatabaseUtils.run(
    db,
    `INSERT INTO memory_embedding (memory_id, embedding_provider, projection_type, embedding, dim, dimensions, model)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [memoryId, provider, 'native', encodeFloat32Embedding(vec), vec.length, vec.length, model]
  );
}

describe('ConsolidationRepository', () => {
  let db: Database.Database;
  let repo: ConsolidationRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    applyConsolidationTestSchema(db);
    repo = new ConsolidationRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('findEpisodicCandidates excludes consolidated and pinned', () => {
    DatabaseUtils.run(db, `INSERT INTO memory_item (id, type, content, pinned, is_consolidated, created_at) VALUES ('e1', 'episodic', 'a', 0, 0, datetime('now', '-1 day'))`);
    DatabaseUtils.run(db, `INSERT INTO memory_item (id, type, content, pinned, is_consolidated, created_at) VALUES ('e2', 'episodic', 'b', 1, 0, datetime('now', '-1 day'))`);
    DatabaseUtils.run(db, `INSERT INTO memory_item (id, type, content, pinned, is_consolidated, created_at) VALUES ('e3', 'episodic', 'c', 0, 1, datetime('now', '-1 day'))`);
    const rows = repo.findEpisodicCandidates(null, 30);
    expect(rows.map(r => r.id)).toEqual(['e1']);
  });

  it('findEpisodicCandidates filters by ownerIdFilter', () => {
    DatabaseUtils.run(db, `INSERT INTO memory_item (id, type, content, owner_id, created_at) VALUES ('a', 'episodic', 'x', 'o1', datetime('now', '-1 day'))`);
    DatabaseUtils.run(db, `INSERT INTO memory_item (id, type, content, owner_id, created_at) VALUES ('b', 'episodic', 'y', 'o2', datetime('now', '-1 day'))`);
    const rows = repo.findEpisodicCandidates('o1', 30);
    expect(rows.map(r => r.id)).toEqual(['a']);
  });

  it('findSemanticsByOwner는 요청한 model로 만든 벡터만 붙인다', () => {
    // 같은 기억에 provider가 다른 벡터가 공존할 수 있다. 차원이 다른 벡터를 집으면
    // cosineSimilarity가 0을 돌려주어 병합 후보가 조용히 사라진다 (#889, #917).
    DatabaseUtils.run(db, `INSERT INTO memory_item (id, type, content, created_at) VALUES ('s1', 'semantic', 'a', datetime('now', '-2 day'))`);
    DatabaseUtils.run(db, `INSERT INTO memory_item (id, type, content, created_at) VALUES ('s2', 'semantic', 'b', datetime('now', '-1 day'))`);
    insertEmbedding(db, 's1', [1, 0, 0, 0], 'minilm', 'model-new');
    insertEmbedding(db, 's1', [9, 9, 9, 9, 9], 'tfidf', 'lightweight-hybrid');
    insertEmbedding(db, 's2', [9, 9, 9, 9, 9], 'tfidf', 'lightweight-hybrid');

    const rows = repo.findSemanticsByOwner(null, { provider: 'minilm', model: 'model-new' });

    expect(rows.map(r => r.id)).toEqual(['s1', 's2']);
    expect(rows[0]!.embedding).toEqual([1, 0, 0, 0]);
    // 조건에 맞는 벡터가 없는 후보는 행 자체는 남고 embedding만 비어야 한다.
    expect(rows[1]!.embedding).toBeUndefined();
  });

  it('findSemanticsByOwner는 owner로 거르고 삭제된 기억을 뺀다', () => {
    DatabaseUtils.run(db, `INSERT INTO memory_item (id, type, content, owner_id, created_at) VALUES ('s1', 'semantic', 'a', 'o1', datetime('now'))`);
    DatabaseUtils.run(db, `INSERT INTO memory_item (id, type, content, owner_id, created_at) VALUES ('s2', 'semantic', 'b', 'o2', datetime('now'))`);
    DatabaseUtils.run(db, `INSERT INTO memory_item (id, type, content, owner_id, is_deleted, created_at) VALUES ('s3', 'semantic', 'c', 'o1', 1, datetime('now'))`);

    const rows = repo.findSemanticsByOwner('o1', { provider: 'minilm', model: 'model-new' });

    expect(rows.map(r => r.id)).toEqual(['s1']);
  });

  it('markEpisodicsConsolidated sets flag and caps importance', () => {
    DatabaseUtils.run(db, `INSERT INTO memory_item (id, type, content, importance, created_at) VALUES ('e1', 'episodic', 'x', 0.9, datetime('now'))`);
    repo.markEpisodicsConsolidated(['e1'], 0.1);
    const row = DatabaseUtils.get(db, 'SELECT is_consolidated, importance FROM memory_item WHERE id = ?', [
      'e1'
    ]) as { is_consolidated: number; importance: number };
    expect(Boolean(row.is_consolidated)).toBe(true);
    expect(row.importance).toBeLessThanOrEqual(0.1);
  });
});
