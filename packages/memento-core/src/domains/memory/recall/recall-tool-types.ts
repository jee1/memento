/**
 * Recall MCP 도구의 응답·파이프라인 공용 타입 (recall-tool.ts에서 분리, #350).
 */

import type { EmbeddingProvider } from '../../../shared/types/embedding.types.js';
import type { MemoryType } from '../../../shared/types/memory.types.js';
import type { VersionFilterType } from '../../../shared/types/procedural-versioning.js';
import type { MemorySearchFilters } from '../../../shared/types/search.types.js';

/**
 * 앵커 설정 메타데이터 타입
 */
export interface AnchorSetMetadata {
  memory_id: string;
  slot: 'A';
  agent_id: string;
}

/**
 * 이웃 기억 항목 타입
 */
export interface NeighborMemoryItem {
  id: string;
  content: string;
  similarity: number;
  /** MCP 응답 확장 시 타입 안정성을 위해 unknown으로 제한 */
  [key: string]: string | number | undefined;
}

/**
 * Recall 응답 항목 타입 (neighbors 필드 포함)
 *
 * @property neighbors - 이웃 기억 배열 (optional)
 *   - include_neighbors=true이고 상위 neighbors_limit개 결과에만 포함됨
 *   - neighbors_limit보다 많은 결과는 neighbors 필드가 없음 (undefined)
 *   - 이웃 기억 조회 실패 시 빈 배열 []로 설정됨
 */
export interface RecallResultItem {
  memory_id: string;
  id?: string;
  content: string;
  type: string;
  importance: number;
  created_at: string;
  final_score: number;
  uri?: string;
  neighbors?: NeighborMemoryItem[]; // optional: neighbors_limit보다 많은 결과는 필드 없음
  /** MCP 응답 확장 시 타입 안정성을 위해 unknown으로 제한 */
  [key: string]: string | number | NeighborMemoryItem[] | undefined;
}

/**
 * Recall 응답 메타데이터 타입
 *
 * @property anchor_set - 앵커 설정 정보 (auto_set_anchor=true일 때만 설정)
 *   - 성공 시: {memory_id, slot: "A", agent_id} 객체
 *   - 실패/건너뜀/비활성화 시: null
 * @property anchor_set_error - 앵커 설정 실패 여부 (optional)
 *   - anchor_set=null이고 anchor_set_error=true: 앵커 설정 실패
 * @property anchor_set_skipped - 앵커 설정 건너뜀 여부 (optional)
 *   - anchor_set=null이고 anchor_set_skipped=true: 앵커 설정 건너뜀 (pinned 앵커 보호 등)
 * @property anchor_set_skipped_reason - 앵커 설정 건너뜀 사유 (optional)
 *   - "pinned_anchor_protected": 슬롯 A에 pinned 앵커가 있어서 보호됨
 */
export interface RecallResponseMetadata {
  anchor_set: AnchorSetMetadata | null;
  anchor_set_error?: boolean;
  anchor_set_skipped?: boolean;
  anchor_set_skipped_reason?: string;
  /** 진단: 하이브리드 검색 시 텍스트/벡터 결과 수·Fallback 여부 (0건 원인 구분용) */
  text_result_count?: number;
  vector_result_count?: number;
  fallback_used?: boolean;
  /**
   * 단일 canonical 쿼리 임베딩 provider (비교용). 복수 실제 사용은 query_embedding_providers 참고.
   * 복수 provider 검색 시 설정 기본값이 목록에 있으면 그 값을, 아니면 정렬된 목록의 첫 값을 사용.
   */
  embedding_provider?: string;
  /** 이번 검색에서 쿼리 임베딩에 실제 사용된 provider (VEC 다중·fallback 시 복수, 정렬·중복 제거) */
  query_embedding_providers?: EmbeddingProvider[];
  /** MCP 응답 확장 시 타입 안정성을 위해 unknown으로 제한 */
  [key: string]: AnchorSetMetadata | null | boolean | string | number | EmbeddingProvider[] | undefined;
}

/**
 * Recall 응답 타입
 *
 * @example 앵커 설정 성공 + 이웃 기억 포함
 * ```json
 * {
 *   "items": [
 *     {
 *       "memory_id": "mem_12345",
 *       "content": "검색 결과 내용",
 *       "type": "episodic",
 *       "importance": 0.8,
 *       "created_at": "2024-01-01T00:00:00Z",
 *       "final_score": 0.95,
 *       "neighbors": [
 *         {
 *           "id": "mem_67890",
 *           "content": "관련 기억 내용",
 *           "similarity": 0.85
 *         }
 *       ]
 *     },
 *     {
 *       "memory_id": "mem_11111",
 *       "content": "두 번째 결과",
 *       "neighbors": []
 *     },
 *     {
 *       "memory_id": "mem_22222",
 *       "content": "세 번째 결과 (neighbors_limit 초과로 neighbors 필드 없음)"
 *     }
 *   ],
 *   "total_count": 3,
 *   "query_time": 150,
 *   "search_type": "hybrid",
 *   "metadata": {
 *     "anchor_set": {
 *       "memory_id": "mem_12345",
 *       "slot": "A",
 *       "agent_id": "default"
 *     }
 *   }
 * }
 * ```
 *
 * @example 앵커 설정 실패
 * ```json
 * {
 *   "items": [...],
 *   "metadata": {
 *     "anchor_set": null,
 *     "anchor_set_error": true
 *   }
 * }
 * ```
 *
 * @example 앵커 설정 건너뜀 (pinned 앵커 보호)
 * ```json
 * {
 *   "items": [...],
 *   "metadata": {
 *     "anchor_set": null,
 *     "anchor_set_skipped": true,
 *     "anchor_set_skipped_reason": "pinned_anchor_protected"
 *   }
 * }
 * ```
 *
 * @example 앵커 설정 비활성화
 * ```json
 * {
 *   "items": [...],
 *   "metadata": {
 *     "anchor_set": null
 *   }
 * }
 * ```
 *
 * @example 이웃 기억 미포함 (include_neighbors=false)
 * ```json
 * {
 *   "items": [
 *     {
 *       "memory_id": "mem_12345",
 *       "content": "검색 결과",
 *       "neighbors": undefined  // neighbors 필드 없음
 *     }
 *   ]
 * }
 * ```
 */
export interface RecallResponse {
  items: RecallResultItem[];
  total_count: number;
  query_time: number;
  search_type: string;
  metadata?: RecallResponseMetadata;
  /**
   * 메타 메모리 통계 정보
   *
   * recall 결과에 포함된 메모리 항목의 통계 정보를 포함합니다.
   * include_metadata=true일 때만 포함됩니다.
   *
   * @example
   * ```json
   * {
   *   "meta_stats": {
   *     "mem_12345": {
   *       "recall_count": 10,
   *       "success_count": 8,
   *       "failure_count": 2,
   *       "avg_confidence": 0.85,
   *       "last_recalled_at": "2024-01-01T00:00:00.000Z"
   *     }
   *   }
   * }
   * ```
   */
  meta_stats?: {
    [memory_id: string]: {
      recall_count: number;
      success_count: number;
      failure_count: number;
      avg_confidence: number;
      last_recalled_at?: string; // ISO 8601 형식 (예: "2024-01-01T00:00:00.000Z")
    };
  };
  /** MCP 응답 확장 시 타입 안정성을 위해 unknown으로 제한 */
  [key: string]: RecallResultItem[] | number | string | RecallResponseMetadata | Record<string, unknown> | undefined;
}

/**
 * 검색 결과 항목 최소 형태 (filter/process/enrich 등 내부 처리용)
 */
export interface RecallSearchItem {
  id?: string;
  memory_id?: string;
  content: string;
  type: string;
  importance: number;
  created_at: string | Date;
  final_score?: number;
  finalScore?: number;
  score?: number;
  trigger_conditions?: string;
  version?: number;
  version_series_id?: string | null;
  owner_id?: string | null;
  process_id?: string | null;
  session_id?: string | null;
  project_id?: string | null;
  last_accessed?: Date;
  pinned?: boolean;
  tags?: string[];
  source?: string;
  origin_source?: string;
  privacy_scope?: string;
  task_goal?: string | null;
  steps?: string | null;
  workflow_name?: string | null;
  skill_name?: string | null;
  reflection_notes?: string | null;
  version_chain?: unknown;
  diff_with_previous?: unknown;
  diff_with?: unknown;
  textScore?: number;
  vectorScore?: number;
  recall_reason?: string;
  consolidation_score?: number;
  [key: string]: unknown;
}

/** 적용된 필터 정보 (getAppliedRecallFilters 반환형) */
export interface AppliedFilters extends Record<string, unknown> {
  type?: MemoryType[];
  tags?: string[];
  privacy_scope?: string[];
  time_from?: string;
  time_to?: string;
  pinned?: boolean;
  importance_min?: number;
  importance_max?: number;
  has_reflection_notes?: boolean;
  version_filter?: VersionFilterType;
  version_series_id?: string;
  version_number?: number;
  include_version_chain?: boolean;
  include_diff_with?: string;
  owner_id?: string | string[];
  process_id?: string | string[];
  session_id?: string | string[];
  project_id?: string;
}

/** Recall 내부 필터 (MemorySearchFilters + importance 범위) */
export type RecallFilters = MemorySearchFilters & { importance_min?: number; importance_max?: number };

/** meta_stats에 넣을 항목 (last_recalled_at은 ISO 문자열) */
export interface MetaStatsItem {
  recall_count: number;
  success_count: number;
  failure_count: number;
  avg_confidence: number;
  last_recalled_at?: string;
}
