import Database from 'better-sqlite3';
import type {
  EmbeddingProvider,
  MemorySearchFilters,
  MemoryType,
  ProcessAttribute,
} from '../../../shared/types/index.js';
import type { ScoreBreakdown } from '../../../shared/types/search.types.js';
import type {
  SearchBySimilarityOutcome,
  VectorSearchResult,
} from '../../memory/services/memory-embedding-service.js';

export interface ITextSearchEngine {
  search(
    db: Database.Database,
    query: {
      query: string;
      filters?: MemorySearchFilters;
      limit?: number;
      omit_feedback_in_ranking?: boolean;
    }
  ): Promise<{ items: unknown[]; total_count: number; query_time: number }>;
}

export interface IEmbeddingService {
  isAvailable(): boolean;
  searchBySimilarity(
    db: Database.Database,
    query: string,
    options: {
      type?: MemoryType[];
      limit?: number;
      threshold?: number;
      project_id?: string;
      owner_id?: string | string[];
    }
  ): Promise<VectorSearchResult[] | SearchBySimilarityOutcome>;
  getEmbeddingStats(db: Database.Database): Promise<unknown>;
}

export interface IVectorSearchEngine {
  initialize(db: Database.Database): void;
  getIndexStatus(): { available: boolean };
  search(
    vector: number[],
    options: {
      limit?: number;
      threshold?: number;
      types?: MemoryType[];
      includeContent?: boolean;
      project_id?: string;
      owner_id?: string | string[];
    },
    provider?: string
  ): Promise<Array<{
    memory_id: string;
    content: string;
    type: string;
    importance: number;
    created_at: string;
    similarity: number;
    project_id?: string | null;
    owner_id?: string | null;
  }>>;
}

export interface ISearchResultCombiner {
  combine(
    textResults: unknown[],
    vectorResults: VectorSearchResult[],
    textWeight: number,
    vectorWeight: number
  ): HybridSearchResult[];
}

export interface IProceduralMemoryMatcher {
  fetchProceduralMemoryMatches(
    db: Database.Database,
    memoryIds: string[],
    query?: HybridSearchQuery
  ): Map<string, ProceduralMemoryMatch>;
}

export interface IAdaptiveWeightCalculator {
  calculateWeights(query: string, vectorWeight: number, textWeight: number): HybridWeights;
}

export interface ISearchLogger {
  logSearchStart(searchId: string, query: HybridSearchQuery): void;
  logSearchStep(searchId: string, step: string, data: unknown): void;
  logSearchComplete(
    searchId: string,
    result: { items: unknown[]; total_count: number },
    queryTime: number
  ): void;
  logSearchError(searchId: string, error: unknown, query: HybridSearchQuery): void;
  logExperiment?(searchId: string, experimentId: string, variant: Record<string, unknown>): void;
}

export type HybridWeights = { textWeight: number; vectorWeight: number };

export type RelationInfoRow = {
  target_id: string;
  relation_type: string;
  confidence: number;
};

export type HybridRelationGraphReader = {
  getRelationsBatch(
    memoryIds: string[],
    options: { direction: 'both'; minConfidence: number }
  ): Promise<Map<string, Array<{
    source_id: string;
    target_id: string;
    relation_type: string;
    confidence: number;
  }>>>;
};

export type ProceduralMemoryMatch = {
  workflow_name_match: boolean;
  skill_name_match: boolean;
  trigger_conditions_match: boolean;
};

export interface TriggerContext {
  tool_name?: string;
  error_type?: string;
  params?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface HybridSearchQuery {
  query: string;
  filters?: MemorySearchFilters | undefined;
  limit?: number | undefined;
  vectorWeight?: number | undefined;
  textWeight?: number | undefined;
  includeRelations?: boolean;
  experiment_id?: string;
  provider_filter?: EmbeddingProvider[];
  match_trigger_conditions?: boolean;
  context?: TriggerContext;
  include_score_breakdown?: boolean;
  /** When true, return per-stage candidate IDs without changing default ranking. */
  includeFunnel?: boolean;
}

export interface HybridSearchResult {
  id: string;
  content: string;
  type: string;
  importance: number;
  created_at: string;
  last_accessed?: string | undefined;
  pinned: boolean;
  tags?: string[] | undefined;
  textScore: number;
  vectorScore: number;
  finalScore: number;
  recall_reason: string;
  consolidation_score?: number;
  relation_weight?: number;
  relations?: RelationInfoRow[];
  score_breakdown?: ScoreBreakdown;
  project_id?: string | null;
  owner_id?: string | null;
  process_id?: string | null;
  session_id?: string | null;
}

export type MemoryRankingDetails = {
  tags?: string[];
  workflow_name?: string | null;
  skill_name?: string | null;
};

export type RankingContext = {
  relationWeights: Map<string, number>;
  relationInfo: Map<string, RelationInfoRow[]>;
  consolidationScores: Map<string, number>;
  proceduralMatches: Map<string, ProceduralMemoryMatch>;
  processAttributes: ProcessAttribute | null;
  memoryDetailsMap: Map<string, MemoryRankingDetails>;
  feedbackScores: Map<string, number>;
};
