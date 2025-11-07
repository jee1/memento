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

export interface MementoConfig {
  dbPath: string;
  serverName: string;
  serverVersion: string;
  port: number;
  // 임베딩 설정
  embeddingProvider: EmbeddingProvider;
  openaiApiKey: string | undefined;
  openaiModel: string;
  geminiApiKey: string | undefined;
  geminiModel: string;
  embeddingDimensions: number;
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
}

export interface RememberParams {
  content: string;
  type?: MemoryType;
  tags?: string[];
  importance?: number;
  source?: string;
  privacy_scope?: PrivacyScope;
}

export interface RecallParams {
  query: string;
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
