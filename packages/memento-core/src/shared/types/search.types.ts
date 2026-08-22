/**
 * 검색·랭킹 타입 정의
 */

import type { EmbeddingProvider } from './embedding.types.js';
import type { MemoryType, PrivacyScope } from './memory.types.js';
import type { ProceduralDiffResult, VersionChainItem, VersionFilterType } from './procedural-versioning.js';

export interface ScoreComponent {
  /** 가중치 적용 후 절대 기여값 */
  score: number;
  /** |total| 대비 백분율을 가장 가까운 정수로 반올림(0–100 근사); 부호는 기여 방향 유지 */
  pct: number;
}

export interface ScoreBreakdown {
  /**
   * “관련성 계열” 복합 슬롯: α·relevance(통합 점수 블렌딩 포함) + 관계 가중 + 절차 부스트 + 프로세스 적합도.
   * `pct`는 |total| 대비 비율(FR-008 / spec 004 contracts §1).
   */
  relevance: ScoreComponent;
  recency: ScoreComponent;
  importance: ScoreComponent;
  usage: ScoreComponent;
  feedback: ScoreComponent;
  duplication_penalty: ScoreComponent;
  total: number;
}

/** process별 주제/속성 메타 */
export interface ProcessAttribute {
  process_id: string;
  topics?: string[];
  workflow_names?: string[];
  skill_names?: string[];
  created_at?: string;
  updated_at?: string;
}

export interface MemorySearchFilters {
  id?: string[] | undefined;
  type?: MemoryType[] | undefined;
  tags?: string[] | undefined;
  privacy_scope?: PrivacyScope[] | undefined;
  time_from?: string | undefined;
  time_to?: string | undefined;
  pinned?: boolean | undefined;
  has_reflection_notes?: boolean | undefined;
  workflow_name?: string | undefined;
  skill_name?: string | undefined;
  version_filter?: VersionFilterType;
  version_series_id?: string | undefined;
  version_number?: number | undefined;
  include_version_chain?: boolean | undefined;
  include_diff_with?: 'previous' | string | undefined;
  owner_id?: string | string[] | undefined;
  process_id?: string | string[] | undefined;
  session_id?: string | string[] | undefined;
  project_id?: string | undefined;
}

export interface MemorySearchResult {
  id: string;
  content: string;
  type: MemoryType;
  importance: number;
  created_at: Date;
  last_accessed?: Date;
  pinned: boolean;
  tags?: string[];
  score: number;
  recall_reason: string;
  score_breakdown?: ScoreBreakdown;
  task_goal?: string;
  steps?: string;
  reflection_notes?: string;
  workflow_name?: string;
  skill_name?: string;
  trigger_conditions?: string;
  version?: number;
  version_series_id?: string | null;
  version_chain?: VersionChainItem[];
  diff_with_previous?: ProceduralDiffResult | null;
  diff_with?: ProceduralDiffResult | null;
  consolidation_score?: number;
  owner_id?: string | null;
  process_id?: string | null;
  session_id?: string | null;
  num_times?: number;
  last_mentioned_at?: Date;
  project_id?: string | null;
}

export interface SearchRankingWeights {
  relevance: number;
  recency: number;
  importance: number;
  usage: number;
  duplication_penalty: number;
}

export interface StoredEmbeddingProviderStats {
  provider: EmbeddingProvider;
  count: number;
  avg_dimensions: number;
}
