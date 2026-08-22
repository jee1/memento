import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, vi } from 'vitest';
import { AnchorCacheService } from '../../../anchor/services/anchor/anchor-cache-service.js';
import { AnchorManager } from '../../../anchor/services/anchor/anchor-manager.js';
import { AnchorSearchService } from '../../../anchor/services/anchor/anchor-search-service.js';
import { createHybridSearchEngine, type HybridSearchEngine } from '../../../search/algorithms/hybrid-search-engine.js';
import { getVectorSearchEngine, type VectorSearchEngine } from '../../../search/algorithms/vector-search-engine.js';
import { mementoConfig } from '../../../../shared/config/index.js';
import { setupTestDatabase } from '../../../../../test/helpers/test-database.js';
import { MemoryEmbeddingService } from '../../services/memory-embedding-service.js';
import { RecallTool } from '../recall-tool.js';
import type { ToolContext } from '../../../tools/types.js';

export let db: Database.Database;
export let tool: RecallTool;
export let context: ToolContext;
export let hybridSearchEngine: HybridSearchEngine;
export let embeddingService: MemoryEmbeddingService;
export let anchorManager: AnchorManager;
export let vectorSearchEngine: VectorSearchEngine;

export function describeRecallTool(topic: string, registerTests: () => void): void {
  describe(`RecallTool - ${topic}`, () => {
    let savedTypeParamMode: (typeof mementoConfig)['typeParamMode'];
    let savedAutoSetAnchorDefault: boolean;

    beforeEach(async () => {
      savedTypeParamMode = mementoConfig.typeParamMode;
      mementoConfig.typeParamMode = 'warn';
      savedAutoSetAnchorDefault = mementoConfig.autoSetAnchorDefault;
      mementoConfig.autoSetAnchorDefault = false;

      db = await setupTestDatabase();
      embeddingService = new MemoryEmbeddingService();
      hybridSearchEngine = createHybridSearchEngine(
        undefined,
        embeddingService,
        undefined,
        undefined,
        undefined,
        undefined
      );
      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
      vectorSearchEngine = getVectorSearchEngine();

      const cacheService = new AnchorCacheService();
      cacheService.setDatabase(db);
      cacheService.setEmbeddingService(embeddingService);

      const searchService = new AnchorSearchService(cacheService);
      searchService.setDatabase(db);
      searchService.setHybridSearchEngine(hybridSearchEngine);
      searchService.setVectorSearchEngine(vectorSearchEngine);

      anchorManager = new AnchorManager(cacheService, searchService);
      anchorManager.setDatabase(db);

      tool = new RecallTool();
      context = {
        db,
        services: { hybridSearchEngine, embeddingService, anchorManager }
      };
    });

    afterEach(() => {
      mementoConfig.typeParamMode = savedTypeParamMode;
      mementoConfig.autoSetAnchorDefault = savedAutoSetAnchorDefault;
      db.close();
      vi.clearAllMocks();
      vi.restoreAllMocks();
    });

    registerTests();
  });
}
