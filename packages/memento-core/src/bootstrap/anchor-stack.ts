import Database from 'better-sqlite3';
import type { HybridSearchEngine } from '../domains/search/algorithms/hybrid-search-engine.js';
import { getVectorSearchEngine } from '../domains/search/algorithms/vector-search-engine.js';
import { AnchorManager } from '../domains/anchor/services/anchor/anchor-manager.js';
import { AnchorCacheService } from '../domains/anchor/services/anchor/anchor-cache-service.js';
import { AnchorSearchService } from '../domains/anchor/services/anchor/anchor-search-service.js';
import { MemoryEmbeddingService } from '../domains/memory/services/memory-embedding-service.js';
import { ErrorLoggingService } from '../domains/monitoring/services/error-logging-service.js';

export async function createAnchorStack(
  db: Database.Database,
  embeddingService: MemoryEmbeddingService,
  hybridSearchEngine: HybridSearchEngine,
  errorLoggingService: ErrorLoggingService
): Promise<{
  vectorSearchEngine: ReturnType<typeof getVectorSearchEngine>;
  anchorCacheService: AnchorCacheService;
  anchorSearchService: AnchorSearchService;
  anchorManager: AnchorManager;
}> {
  const anchorCacheService = new AnchorCacheService(db, embeddingService);
  const vectorSearchEngine = getVectorSearchEngine();
  const anchorSearchService = new AnchorSearchService(anchorCacheService, {
    db,
    hybridSearchEngine,
    vectorSearchEngine
  });
  const anchorManager = new AnchorManager(anchorCacheService, anchorSearchService, {
    db,
    errorLoggingService
  });
  await anchorCacheService.restoreCacheFromDB(db);
  return {
    vectorSearchEngine,
    anchorCacheService,
    anchorSearchService,
    anchorManager
  };
}
