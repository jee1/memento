/** Backward-compatible type-only barrel. Prefer the domain type modules directly. */

export type * from './memory.types.js';
export type * from './relation.types.js';
export type * from './search.types.js';

export type { ApiScope, ApiTokenEntry } from './api-token.js';
export type { ConsolidationCluster, SleepConsolidationRunResult } from './consolidation.types.js';
export type { EmbeddingProvider } from './embedding.types.js';
export type {
  FieldDiff,
  ProceduralDiffResult,
  StepChangeType,
  StepsDiffItem,
  VersionChainItem,
  VersionFilterType,
} from './procedural-versioning.js';
