import { SearchEngine } from '../domains/search/algorithms/search-engine.js';
import type { HybridSearchEngine } from '../domains/search/algorithms/hybrid-search-engine.js';
import { HybridSearchFactory } from '../domains/search/factories/hybrid-search.factory.js';
import { MemoryEmbeddingService } from '../domains/memory/services/memory-embedding-service.js';
import { ForgettingPolicyService } from '../domains/forgetting/services/forgetting-policy-service.js';
import { DatabaseOptimizer } from '../infrastructure/database/database-optimizer.js';

export function createSearchEmbeddingAndOptimizerServices(db: import('better-sqlite3').Database): {
  searchEngine: SearchEngine;
  embeddingService: MemoryEmbeddingService;
  queryEmbeddingService: MemoryEmbeddingService;
  hybridSearchEngine: HybridSearchEngine;
  forgettingPolicyService: ForgettingPolicyService;
  databaseOptimizer: DatabaseOptimizer;
} {
  const searchEngine = new SearchEngine();
  const embeddingService = new MemoryEmbeddingService();
  // 검색 경로는 별도 인스턴스를 사용해 remember 경로와 provider 상태를 공유하지 않도록 분리한다.
  const queryEmbeddingService = new MemoryEmbeddingService();
  const hybridSearchEngine = HybridSearchFactory.createDefaultEngine(db, queryEmbeddingService);
  const forgettingPolicyService = new ForgettingPolicyService();
  const databaseOptimizer = new DatabaseOptimizer(db);
  return {
    searchEngine,
    embeddingService,
    queryEmbeddingService,
    hybridSearchEngine,
    forgettingPolicyService,
    databaseOptimizer,
  };
}
