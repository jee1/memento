export {
  MemoryEmbeddingService,
} from './services/memory-embedding-service.js';
export type {
  SearchBySimilarityOutcome,
  VectorSearchResult,
} from './services/memory-embedding-service.js';

export { UnifiedEmbeddingService } from './services/unified-embedding-service.js';

export { vectorCompatibilityService } from './services/vector-compatibility-service.js';

export {
  EmbeddingReindexService,
  ID_CHUNK_SIZE,
  chunkedIn,
  expectedDimensions,
  normalizeProvider,
} from './services/embedding-reindex-service.js';
export type {
  EmbeddingHealthDiagnostics,
  EmbeddingHealthOptions,
  EmbeddingHealthProblem,
  EmbeddingHealthProblemMemory,
  EmbeddingHealthProblemPage,
  EmbeddingReindexOptions,
  EmbeddingReindexResult,
  ReindexByIdsResult,
} from './services/embedding-reindex-service.js';
