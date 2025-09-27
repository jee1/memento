/**
 * Memento MCP Server 타입 정의
 */

export type MemoryType = 'working' | 'episodic' | 'semantic' | 'procedural';
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

export interface MementoConfig {
  dbPath: string;
  serverName: string;
  serverVersion: string;
  port: number;
  openaiApiKey: string | undefined;
  openaiModel: string;
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
