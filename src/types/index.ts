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
}

export interface MemorySearchFilters {
  id?: string[] | undefined;
  type?: MemoryType[] | undefined;
  tags?: string[] | undefined;
  privacy_scope?: PrivacyScope[] | undefined;
  time_from?: string | undefined;
  time_to?: string | undefined;
  pinned?: boolean | undefined;
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
  nodeEnv: string;
  typeParamMode: 'warn' | 'deprecate' | 'error';
  // Consolidation Score System 설정
  consolidationScoreEnabled: boolean;
}

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
  tags?: string[];
  importance?: number;
  source?: string;
  privacy_scope?: PrivacyScope;
}

export interface RecallParams {
  query?: string; // optional - core/vault일 때는 key 사용
  type?: MemoryTypeRequest; // 확장된 타입 지원
  key?: string; // Core Memory / Knowledge Vault용
  agent_id?: string; // Core Memory / Knowledge Vault용
  filters?: MemorySearchFilters;
  limit?: number;
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
