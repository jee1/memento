/**
 * SearchEngine 내부 타입
 */

import type { MemorySearchFilters } from '../../../../shared/types/search.types.js';

export interface SearchQuery {
  query: string;
  filters?: MemorySearchFilters | undefined;
  limit?: number | undefined;
  /** true이면 텍스트 전용 랭킹 경로에서도 score_breakdown 포함 (하이브리드와 동일 계약) */
  include_score_breakdown?: boolean | undefined;
  /**
   * true이면 텍스트 랭킹에서 피드백 가중치를 적용하지 않음.
   * 하이브리드 검색은 combineAndSortResults → normalizeScores에서만 피드를 반영해 이중 가산을 막는다.
   */
  omit_feedback_in_ranking?: boolean | undefined;
}

export type SearchEngineRow = {
  id: string;
  content: string;
  type: string;
  importance: number;
  created_at: Date | string;
  last_accessed?: Date | string | null;
  pinned: boolean | number;
  tags?: string | null;
  fts_rank?: number | null;
  consolidation_score?: number | string | null;
  task_goal?: string | null;
  steps?: string | null;
  reflection_notes?: string | null;
  workflow_name?: string | null;
  skill_name?: string | null;
  trigger_conditions?: string | null;
  version?: number | null;
  version_series_id?: string | null;
  owner_id?: string | null;
  process_id?: string | null;
  session_id?: string | null;
  num_times?: number | string | null;
  last_mentioned_at?: Date | string | null;
  project_id?: string | null;
} & Record<string, unknown>;

export interface BuildSearchStatementResult {
  sql: string;
  params: unknown[];
  usedFtsQuery: boolean;
}

export interface BuildSearchStatementParams {
  db: import('better-sqlite3').Database;
  searchQuery: string;
  filters?: MemorySearchFilters | undefined;
  limit: number;
  hasIdFilter: boolean;
  preferFts: boolean;
  checkFTS5Availability: (db: import('better-sqlite3').Database) => Promise<boolean>;
  buildFTSQuery: (query: string) => string;
  buildReflectionNotesSearchCondition: (
    db: import('better-sqlite3').Database,
    searchQuery: string
  ) => string | null;
}
