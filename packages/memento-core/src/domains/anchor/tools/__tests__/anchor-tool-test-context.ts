import { vi } from 'vitest';
import type { ToolContext } from '../types.js';
import { AnchorCacheService } from '../../services/anchor/anchor-cache-service.js';
import { AnchorManager } from '../../services/anchor/anchor-manager.js';
import { AnchorSearchService } from '../../services/anchor/anchor-search-service.js';
import type { MemoryEmbeddingService } from '../../../memory/services/memory-embedding-service.js';
import type { HybridSearchEngine } from '../../../search/algorithms/hybrid-search-engine.js';
import type { VectorSearchEngine } from '../../../search/algorithms/vector-search-engine.js';
import { setupTestDatabase } from '../../../../../test/helpers/test-database.js';

export async function createAnchorToolTestContext(): Promise<{
  db: ToolContext['db'];
  context: ToolContext;
  anchorManager: AnchorManager;
  hybridSearchEngine: HybridSearchEngine;
}> {
  const db = await setupTestDatabase();
  const embeddingService = {
    createAndStoreEmbedding: vi.fn(),
    searchBySimilarity: vi.fn(),
    migrateProvider: vi.fn(),
    isAvailable: vi.fn().mockReturnValue(false)
  } as unknown as MemoryEmbeddingService;
  const hybridSearchEngine = {
    search: vi.fn().mockResolvedValue({ items: [], total_count: 0 }),
    isEmbeddingAvailable: vi.fn().mockReturnValue(false)
  } as unknown as HybridSearchEngine;
  const vectorSearchEngine = {
    initialize: vi.fn(),
    search: vi.fn().mockResolvedValue([]),
    isAvailable: vi.fn().mockReturnValue(true)
  } as unknown as VectorSearchEngine;

  const cacheService = new AnchorCacheService();
  cacheService.setDatabase(db);
  cacheService.setEmbeddingService(embeddingService);

  const searchService = new AnchorSearchService(cacheService);
  searchService.setDatabase(db);
  searchService.setHybridSearchEngine(hybridSearchEngine);
  searchService.setVectorSearchEngine(vectorSearchEngine);

  const anchorManager = new AnchorManager(cacheService, searchService);
  anchorManager.setDatabase(db);

  return {
    db,
    anchorManager,
    hybridSearchEngine,
    context: { db, services: { anchorManager, hybridSearchEngine } }
  };
}
