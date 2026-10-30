import { SearchEngine } from '../domains/search/algorithms/search-engine.js';
import type { HybridSearchEngine } from '../domains/search/algorithms/hybrid-search-engine.js';
import { HybridSearchFactory } from '../domains/search/factories/hybrid-search.factory.js';
import { MemoryEmbeddingService } from '../domains/embedding/services/memory-embedding-service.js';
import { ForgettingPolicyService } from '../domains/forgetting/services/forgetting-policy-service.js';
import { OnDemandDatabaseOptimizer } from '../infrastructure/database/on-demand-database-optimizer.js';
import type { IDatabaseOptimizer } from '../shared/interfaces/database-optimizer.interface.js';
import { createRelevanceGate } from '../domains/search/services/relevance-gate/create-relevance-gate.js';
import type { RepositoryProvider } from '../shared/ports/repository-provider.port.js';

export function createSearchEmbeddingAndOptimizerServices(
  db: import('better-sqlite3').Database,
  repositories: RepositoryProvider
): {
  searchEngine: SearchEngine;
  embeddingService: MemoryEmbeddingService;
  queryEmbeddingService: MemoryEmbeddingService;
  hybridSearchEngine: HybridSearchEngine;
  forgettingPolicyService: ForgettingPolicyService;
  databaseOptimizer: IDatabaseOptimizer;
} {
  const searchEngine = new SearchEngine(repositories);
  const embeddingService = new MemoryEmbeddingService();
  // 검색 경로는 별도 인스턴스를 사용해 remember 경로와 provider 상태를 공유하지 않도록 분리한다.
  const queryEmbeddingService = new MemoryEmbeddingService();
  const hybridSearchEngine = HybridSearchFactory.createDefaultEngine(repositories, queryEmbeddingService);
  // #1095 설정이 off 면 createRelevanceGate 가 null 을 반환해 게이트가 붙지 않는다.
  hybridSearchEngine.setRejectionGate(createRelevanceGate());
  const forgettingPolicyService = new ForgettingPolicyService();
  const databaseOptimizer = new OnDemandDatabaseOptimizer(db);
  return {
    searchEngine,
    embeddingService,
    queryEmbeddingService,
    hybridSearchEngine,
    forgettingPolicyService,
    databaseOptimizer,
  };
}
