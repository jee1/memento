export { HybridSearchEngine } from './algorithms/hybrid-search-engine.js';
export type {
  HybridSearchQuery,
  HybridSearchResult,
  IAdaptiveWeightCalculator,
  IEmbeddingService,
  IProceduralMemoryMatcher,
  ISearchLogger,
  ISearchResultCombiner,
  ITextSearchEngine,
  IVectorSearchEngine,
} from './algorithms/hybrid-search-engine.js';

export { hybridFusionRelevance } from './algorithms/hybrid-result-ranker.js';

export type { HybridLaneMs, HybridWeights } from './algorithms/hybrid-search-types.js';

export { SearchEngine } from './algorithms/search-engine.js';
export type { SearchQuery } from './algorithms/search-engine.js';

export {
  VectorSearchEngine,
  getVectorSearchEngine,
} from './algorithms/vector-search-engine.js';
export type {
  VectorSearchOptions,
  VectorSearchResult,
  VectorIndexStatus,
} from './algorithms/vector-search-engine.js';

export { HybridSearchFactory } from './factories/hybrid-search.factory.js';
export type { CreateDefaultHybridEngineOptions } from './factories/hybrid-search.factory.js';

export { REJECTION_GATE_DECIDED_VERDICTS } from './ports/relevance-gate-port.js';
export type {
  IRelevanceGatePort,
  RejectionGateVerdict,
  RelevanceGateOutcome,
} from './ports/relevance-gate-port.js';
