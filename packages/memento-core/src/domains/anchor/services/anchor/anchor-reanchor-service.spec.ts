import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { setupTestDatabase } from '../../../../test/helpers/test-database.js';
import { AnchorCacheService } from './anchor-cache-service.js';
import { AnchorReanchorService } from './anchor-reanchor-service.js';
import { NHopSearchService } from './n-hop-search-service.js';
import type { VectorSearchEngine } from '../../../search/algorithms/vector-search-engine.js';

describe('AnchorReanchorService candidate scope', () => {
  let db: Database.Database;
  let reanchor: AnchorReanchorService;
  let vectorSearch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    db = await setupTestDatabase();
    db.exec(`INSERT INTO memory_item (id, type, content, owner_id, project_id) VALUES
      ('anchor', 'semantic', 'anchor', 'a', 'p'),
      ('same-scope', 'semantic', 'same scope', 'a', 'p'),
      ('other-owner', 'semantic', 'other owner', 'b', 'p'),
      ('other-project', 'semantic', 'other project', 'a', 'q');
      INSERT INTO memory_link (source_id, target_id, relation_type) VALUES
      ('anchor', 'same-scope', 'cause_of'), ('anchor', 'other-owner', 'cause_of'), ('anchor', 'other-project', 'cause_of');`);
    const cache = new AnchorCacheService();
    cache.setDatabase(db);
    const nHop = new NHopSearchService(cache);
    nHop.setDatabase(db);
    vectorSearch = vi.fn().mockResolvedValue([]);
    nHop.setVectorSearchEngine({ initialize: vi.fn(), search: vectorSearch } as unknown as VectorSearchEngine);
    reanchor = new AnchorReanchorService(cache, nHop, () => db, () => null, () => ({ hop_limit: 1, vector_threshold: 0.5 }));
    vi.spyOn(reanchor, 'calculateReanchorScore').mockResolvedValue(0.9);
  });
  afterEach(() => db.close());

  it('재앵커 후보는 호출자 owner/project 범위 안의 기억뿐이다', async () => {
    const scope = { owner_id: 'a', project_id: 'p' };
    const candidates = await reanchor.analyzeAnchorUsage('a', 'A', 'anchor', { embedding: [1, 0, 0], provider: 'tfidf' }, scope);
    expect(candidates.map(c => c.memory_id)).toEqual(['same-scope']);
    expect(vectorSearch).toHaveBeenCalledWith([1, 0, 0], expect.objectContaining(scope), 'tfidf');
  });
});
