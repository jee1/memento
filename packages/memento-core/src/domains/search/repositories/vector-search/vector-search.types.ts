/**
 * 벡터 검색 리포지토리 내부 타입
 */

/**
 * 데이터베이스에서 반환된 원시 결과 타입
 * SQL 쿼리 결과는 VectorSearchResult와 유사하지만 완전히 일치하지 않을 수 있음
 */
export interface RawVectorSearchResult {
  memory_id: string;
  similarity: number;
  content: string;
  type: string;
  importance: number;
  created_at: string;
  last_accessed_at?: string | null;
  pinned: number | boolean;
  tags?: string | null;
  project_id?: string | null;
  owner_id?: string | null;
  process_id?: string | null;
  session_id?: string | null;
  /**
   * Hybrid SQL이 노출하는 cosine distance ([0, 2]).
   * 반환 similarity 변환은 mapper의 `cosineDistanceToSimilarity`만 사용한다 (#811 US5 / #806 FR-020).
   */
  vector_distance?: number;
  text_similarity?: number;
  task_goal?: string | null;
  steps?: string | null;
  reflection_notes?: string | null;
  workflow_name?: string | null;
  skill_name?: string | null;
  trigger_conditions?: string | null;
  [key: string]: unknown;
}

export interface RuntimeVectorContext {
  provider: string;
  expectedDimensions: number;
  actualStoredDimensions: number | null;
  targetDimensions: number;
  tableName: string;
}

export interface VectorSearchScope {
  typeFilters: string[];
  hasProjectScope: boolean;
  hasOwnerStringScope: boolean;
  ownerArrayScope: string[];
  hasOwnerScope: boolean;
  hasProcessStringScope: boolean;
  processArrayScope: string[];
  hasProcessScope: boolean;
  hasSessionStringScope: boolean;
  sessionArrayScope: string[];
  hasSessionScope: boolean;
  hasScopeFilter: boolean;
  scopeProjectId?: string;
  scopeOwnerId?: string | string[];
  scopeProcessId?: string | string[];
  scopeSessionId?: string | string[];
}

export interface VectorSearchExecutionOptions {
  limit: number;
  threshold: number;
  includeContent: boolean;
  includeMetadata: boolean;
}
