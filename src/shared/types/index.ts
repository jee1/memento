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
