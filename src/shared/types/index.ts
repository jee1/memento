/**
 * Memento MCP Server 타입 정의
 */

// 도메인 모델용 타입 (memory_item 테이블용, 변경 없음)
export type MemoryType = 'working' | 'episodic' | 'semantic' | 'procedural';

// 요청 파라미터용 타입 (MCP Tool 파라미터용, 확장)
export type MemoryTypeRequest = 'working' | 'episodic' | 'semantic' | 'procedural' | 'core' | 'vault';

/**
 * 타입 가드 함수: MemoryTypeRequest가 MemoryType인지 확인
 * 'core'와 'vault'는 memory_item 테이블에 저장되지 않으므로 false 반환
 */
export function isMemoryItemType(type: MemoryTypeRequest): type is MemoryType {
  return type === 'working' || type === 'episodic' || type === 'semantic' || type === 'procedural';
}

export type PrivacyScope = 'private' | 'team' | 'public';

/**
 * SQL 파라미터 타입
 * SQLite에서 지원하는 파라미터 타입을 정의합니다.
 * better-sqlite3의 prepare() 메서드에서 사용할 수 있는 타입들입니다.
 */
export type SqlParam = string | number | boolean | null | Date;

export interface MemoryItem {
  id: string;
  type: MemoryType;
  content: string;
  importance: number;
  privacy_scope: PrivacyScope;
  created_at: Date;
  last_accessed?: Date;
  pinned: boolean;
  tags?: string[];
  source?: string;
  embedding?: number[];
  // MIRIX Schema Expansion (v2.0) 필드
  origin_source?: string; // JSON 형식
  task_goal?: string; // Procedural Memory 전용, 작업 목표
  steps?: string; // Procedural Memory 전용, JSON 배열 형식
  reflection_notes?: string; // Procedural Memory 전용, JSON 형식
  // Procedural Memory Enhancement (v7.0) 필드
  workflow_name?: string; // 프로세스 이름 (예: "데이터 마이그레이션", "API 배포")
  skill_name?: string; // 기술/능력 이름 (예: "스키마 백업", "데이터 검증")
  trigger_conditions?: string; // 트리거 조건 (JSON 객체 문자열)
}

export interface MemorySearchFilters {
  id?: string[] | undefined;
  type?: MemoryType[] | undefined;
  tags?: string[] | undefined;
  privacy_scope?: PrivacyScope[] | undefined;
  time_from?: string | undefined;
  time_to?: string | undefined;
  pinned?: boolean | undefined;
  has_reflection_notes?: boolean | undefined; // reflection_notes IS NOT NULL 필터링
  // Procedural Memory Enhancement (v7.0) 필드
  workflow_name?: string | undefined; // workflow_name으로 필터링
  skill_name?: string | undefined; // skill_name으로 필터링
  // Procedural Version Management (Issue #57 Phase 2)
  version_filter?: import('./procedural-versioning.js').VersionFilterType;
  version_series_id?: string | undefined;
  version_number?: number | undefined;
  include_version_chain?: boolean | undefined;
  include_diff_with?: 'previous' | string | undefined; // id
}

// 관계 추출 타입 재export
export type {
  RelationCandidate,
  RelationType,
  RelationCategory,
  ExtractOptions,
  ExtractResult,
  IRelationExtractor
} from './relation.js';

// 관계 그래프 타입 재export
export type {
  MemoryRelation,
  RelationMetadata,
  RelationDirection,
  GetRelationsOptions,
  GetRelatedMemoriesOptions,
  AddRelationOptions,
  IRelationGraph,
  RelationTypeRegistry
} from './relation-graph.js';

// Procedural Memory 버전/비교 타입 (Issue #57 Phase 2)
export type {
  FieldDiff,
  StepsDiffItem,
  StepChangeType,
  ProceduralDiffResult,
  VersionChainItem,
  VersionFilterType
} from './procedural-versioning.js';

// Triple 추출 타입 재export
export type {
  Triple,
  TripleExtractionFailureReason,
  ExtractionSteps,
  ExtractionInfo,
  TripleExtractionResult,
  TripleExtractionOptions,
  PredicateCanonicalizationResult,
  EntityLinkingResult,
  TripleValidationResult,
  TripleExtractionStats
} from './triple-extraction.js';

export {
  MEMORY_TYPE_RELATION_MAP,
  RELATION_TYPE_CATEGORY_MAP,
  RELATION_TYPE_BOOST_MAP,
  isApplicableRelationType,
  getRelationCategory,
  getRelationBoost
} from './relation.js';

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
  // MIRIX Schema Expansion (v2.0) 필드
  task_goal?: string; // Procedural Memory 전용, 작업 목표
  steps?: string; // Procedural Memory 전용, JSON 배열 형식
  reflection_notes?: string; // Procedural Memory 전용, JSON 형식
  // Procedural Memory Enhancement (v7.0) 필드
  workflow_name?: string; // 프로세스 이름
  skill_name?: string; // 기술/능력 이름
  trigger_conditions?: string; // 트리거 조건 (JSON 객체 문자열)
  // return_format에 따른 조건부 반환은 구현 레벨에서 처리
  // return_format='steps_only'일 때는 steps만 반환하도록 구현
  // Procedural Version Management (Issue #57 Phase 2)
  version?: number;
  version_series_id?: string | null;
  version_chain?: import('./procedural-versioning.js').VersionChainItem[];
  diff_with_previous?: import('./procedural-versioning.js').ProceduralDiffResult | null;
  diff_with?: import('./procedural-versioning.js').ProceduralDiffResult | null;
}

export interface SearchRankingWeights {
  relevance: number;    // α = 0.50
  recency: number;      // β = 0.20
  importance: number;   // γ = 0.20
  usage: number;        // δ = 0.10
  duplication_penalty: number; // ε = 0.15
}

export type EmbeddingProvider = 'tfidf' | 'lightweight' | 'minilm' | 'openai' | 'gemini';
export type LLMProvider = 'openai' | 'gemini' | 'ollama' | 'auto';

/**
 * 저장된 임베딩의 Provider 통계 정보
 * 데이터베이스에서 조회한 provider별 통계를 나타냄
 */
export interface StoredEmbeddingProviderStats {
  provider: EmbeddingProvider;
  count: number;
  avg_dimensions: number;
}

export interface MementoConfig {
  dbPath: string;
  serverName: string;
  serverVersion: string;
  port: number;
  // 임베딩 설정
  embeddingProvider: EmbeddingProvider;
  openaiApiKey: string | undefined;
  openaiModel: string;
  openaiLlmModel: string;
  geminiApiKey: string | undefined;
  geminiModel: string;
  embeddingDimensions: number;
  // LLM 설정
  llmProvider: LLMProvider;
  ollamaBaseUrl: string;
  ollamaModel: string;
  searchDefaultLimit: number;
  searchMaxLimit: number;
  forgetTTL: {
    working: number;
    episodic: number;
    semantic: number;
    procedural: number;
  };
  logLevel: string;
  logFile: string | undefined;
  mcpLogProtocol: boolean;
  nodeEnv: string;
  typeParamMode: 'warn' | 'deprecate' | 'error';
  // Consolidation Score System 설정
  consolidationScoreEnabled: boolean;
  // FTS5 Migration Status (런타임 캐시용)
  fts5MigrationStatus: 'pending' | 'in_progress' | 'completed' | 'failed';
  // WAL 체크포인트 스케줄러 설정
  walCheckpointIntervalMs: number;
  walSizeWarningThreshold: number;
  walSizeDangerThreshold: number;
  walCheckpointUseDedicatedConnection: boolean;
  walCheckpointMaxRetries: number;
  walCheckpointRetryBackoffMs: number;
  // 데이터베이스 락 모니터 설정
  lockMonitorIntervalMs: number;
  lockMonitorWarningThresholdMs: number;
  lockMonitorDangerThresholdMs: number;
  lockMonitorCriticalThresholdMs: number;
  // Procedural Memory 추출 전략 (Issue #57 Phase 2)
  proceduralExtractionStrategy: 'llm_first' | 'rule_only';
  proceduralLlmExtractorTimeoutMs: number;
}

/**
 * 업데이트 모드 타입
 * - replace: 기존 steps를 새로운 steps로 완전 교체
 * - incremental: 기존 steps에 새로운 단계 추가 또는 수정
 * - versioned: 새 버전의 Procedural Memory 생성 (버전 관리)
 */
export type UpdateMode = 'replace' | 'incremental' | 'versioned';

export interface RememberParams {
  content?: string; // optional - core/vault일 때는 key/value 사용
  type?: MemoryTypeRequest; // 확장된 타입 지원
  key?: string; // Core Memory / Knowledge Vault용
  value?: string; // Core Memory / Knowledge Vault용
  always_load?: boolean; // Core Memory용
  immutable?: boolean; // Knowledge Vault용
  task_goal?: string; // Procedural Memory용
  steps?: string; // Procedural Memory용 (JSON 배열 문자열)
  reflection_notes?: string; // Procedural Memory용 (JSON 객체 문자열)
  // Procedural Memory Enhancement (v7.0) 필드
  workflow_name?: string; // 프로세스 이름 (예: "데이터 마이그레이션", "API 배포")
  skill_name?: string; // 기술/능력 이름 (예: "스키마 백업", "데이터 검증")
  trigger_conditions?: string; // 트리거 조건 (JSON 객체 문자열)
  update_mode?: UpdateMode; // 업데이트 모드 (replace, incremental, versioned)
  tags?: string[];
  importance?: number;
  source?: string;
  privacy_scope?: PrivacyScope;
}

/**
 * 반환 형식 타입
 * - full: 모든 필드 반환
 * - steps_only: steps 필드만 반환 (간결한 응답)
 */
export type ReturnFormat = 'full' | 'steps_only';

export interface RecallParams {
  query?: string; // optional - core/vault일 때는 key 사용
  type?: MemoryTypeRequest; // 확장된 타입 지원
  key?: string; // Core Memory / Knowledge Vault용
  agent_id?: string; // Core Memory / Knowledge Vault용
  filters?: MemorySearchFilters;
  limit?: number;
  // Procedural Memory Enhancement (v7.0) 필드
  workflow_name?: string; // workflow_name으로 필터링
  skill_name?: string; // skill_name으로 필터링
  match_trigger_conditions?: boolean; // trigger_conditions 매칭 여부 (기본값: false)
  return_format?: ReturnFormat; // 반환 형식 선택 (기본값: 'full')
  // Procedural Version Management (Issue #57 Phase 2)
  version_filter?: import('./procedural-versioning.js').VersionFilterType;
  version_series_id?: string;
  version_number?: number;
  include_version_chain?: boolean;
  include_diff_with?: 'previous' | string;
}

export interface ForgetParams {
  id: string;
  hard?: boolean;
}

export interface PinParams {
  id: string;
}

export interface UnpinParams {
  id: string;
}

export interface FeedbackParams {
  memory_id: string;
  helpful: boolean;
  score?: number;
}

export interface MemoryInjectionParams {
  query: string;
  token_budget?: number;
}

/**
 * Meta Memory Statistics 인터페이스
 * 
 * 메모리 항목의 recall 통계를 저장하는 타입입니다.
 * meta_memory_stats 테이블과 일대일 대응됩니다.
 * 
 * @property memory_id - 기억 ID (memory_item.id 참조)
 * @property recall_count - 총 회상 횟수
 * @property success_count - 성공한 회상 횟수 (final_score >= 0.5)
 * @property failure_count - 실패한 회상 횟수 (final_score < 0.5)
 * @property avg_confidence - 평균 신뢰도 점수 (0.0 ~ 1.0)
 * @property last_recalled_at - 마지막 회상 시점 (NULL 허용)
 * @property created_at - 생성 시점
 * @property updated_at - 마지막 업데이트 시점
 */
export interface MetaMemoryStats {
  memory_id: string;
  recall_count: number;
  success_count: number;
  failure_count: number;
  avg_confidence: number;
  last_recalled_at?: Date;
  created_at: Date;
  updated_at: Date;
}

/**
 * Get Meta Memory Statistics 파라미터 인터페이스
 * 
 * get_meta_memory_stats 도구의 파라미터 타입입니다.
 * 모든 필드는 선택적이며, 다양한 필터링 옵션을 제공합니다.
 * 
 * @property memory_id - 특정 기억 ID (선택적)
 * @property memory_ids - 여러 기억 ID 배열 (선택적)
 * @property min_recall_count - 최소 recall_count 필터 (선택적)
 * @property min_confidence - 최소 avg_confidence 필터 (선택적)
 * @property limit - 결과 제한 (기본값: 100, 선택적)
 * 
 * @example
 * ```typescript
 * // 특정 메모리 조회
 * const params1: GetMetaMemoryStatsParams = {
 *   memory_id: 'mem_12345'
 * };
 * 
 * // 여러 메모리 조회
 * const params2: GetMetaMemoryStatsParams = {
 *   memory_ids: ['mem_1', 'mem_2', 'mem_3']
 * };
 * 
 * // 필터링 조회
 * const params3: GetMetaMemoryStatsParams = {
 *   min_recall_count: 10,
 *   min_confidence: 0.5,
 *   limit: 50
 * };
 * ```
 */
export interface GetMetaMemoryStatsParams {
  memory_id?: string;
  memory_ids?: string[];
  min_recall_count?: number;
  min_confidence?: number;
  limit?: number;
}

/**
 * Meta Memory Statistics 결과 인터페이스
 * 
 * get_meta_memory_stats 도구의 응답 타입입니다.
 * 
 * @property items - MetaMemoryStats 배열
 * @property total_count - 전체 결과 개수
 * 
 * @example
 * ```typescript
 * const result: MetaMemoryStatsResult = {
 *   items: [
 *     {
 *       memory_id: 'mem_12345',
 *       recall_count: 10,
 *       success_count: 8,
 *       failure_count: 2,
 *       avg_confidence: 0.85,
 *       created_at: new Date('2024-01-01T00:00:00.000Z'),
 *       updated_at: new Date('2024-01-01T00:00:00.000Z')
 *     }
 *   ],
 *   total_count: 1
 * };
 * ```
 */
export interface MetaMemoryStatsResult {
  items: MetaMemoryStats[];
  total_count: number;
}
