/**
 * 메모리·MCP 요청 타입 정의
 */

import type { ApiTokenEntry } from './api-token.js';
import type { EmbeddingProvider } from './embedding.types.js';
import type { MemorySearchFilters } from './search.types.js';

// 도메인 모델용 타입 (memory_item 테이블용, 변경 없음)
export type MemoryType = 'working' | 'episodic' | 'semantic' | 'procedural';

// 요청 파라미터용 타입 (MCP Tool 파라미터용, 확장)
export type MemoryTypeRequest = MemoryType | 'core' | 'vault';

export type PrivacyScope = 'private' | 'team' | 'public';

/** SQLite에서 지원하는 SQL 파라미터 타입 */
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
  origin_source?: string;
  task_goal?: string;
  steps?: string;
  reflection_notes?: string;
  workflow_name?: string;
  skill_name?: string;
  trigger_conditions?: string;
  owner_id?: string | null;
  process_id?: string | null;
  session_id?: string | null;
  project_id?: string | null;
  num_times?: number;
  last_mentioned_at?: Date | string | null;
  source_session_id?: string | null;
  confidence?: number | null;
  /** Sleep consolidation (005): episodic이 통합 처리되었으면 true */
  isConsolidated?: boolean;
}

export type LLMProvider = 'openai' | 'gemini' | 'ollama' | 'auto';

export interface MementoConfig {
  dbPath: string;
  serverName: string;
  serverVersion: string;
  port: number;
  embeddingProvider: EmbeddingProvider;
  openaiApiKey: string | undefined;
  openaiModel: string;
  openaiLlmModel: string;
  geminiApiKey: string | undefined;
  geminiModel: string;
  /** Gemini generateContent/chat 전용 (GEMINI_MODEL 임베딩과 분리) */
  geminiLlmModel: string;
  embeddingDimensions: number;
  llmProvider: LLMProvider;
  ollamaBaseUrl: string;
  ollamaModel: string;
  /** 용도별 LLM 모델 override (설정 시 provider default보다 우선) */
  llmModelOverrides: {
    triple_extraction?: string;
    relation_extraction?: string;
    procedural?: string;
    consolidation?: string;
  };
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
  consolidationScoreEnabled: boolean;
  fts5MigrationStatus: 'pending' | 'in_progress' | 'completed' | 'failed';
  walCheckpointIntervalMs: number;
  walSizeWarningThreshold: number;
  walSizeDangerThreshold: number;
  walCheckpointUseDedicatedConnection: boolean;
  walCheckpointMaxRetries: number;
  walCheckpointRetryBackoffMs: number;
  diagnosticsEnabled: boolean;
  diagnosticsIntervalMs: number;
  diagnosticsLogDir: string;
  diagnosticsJsonlMaxBytes: number;
  diagnosticsJsonlRetainFiles: number;
  lockMonitorIntervalMs: number;
  lockMonitorWarningThresholdMs: number;
  lockMonitorDangerThresholdMs: number;
  lockMonitorCriticalThresholdMs: number;
  batchSchedulerEnabled: boolean;
  walCheckpointEnabled: boolean;
  dbLockMonitorEnabled: boolean;
  proceduralExtractionStrategy: 'llm_first' | 'rule_only';
  proceduralLlmExtractorTimeoutMs: number;
  corsAllowedOrigins: string[];
  adminApiKey: string | undefined;
  /** MEMENTO_API_TOKENS 또는 legacy ADMIN_API_KEY에서 파생된 programmatic API 토큰 */
  apiTokens: ApiTokenEntry[];
  /** HTTP 서버 바인드 주소 (MEMENTO_HTTP_BIND_HOST, 미설정 시 기본 127.0.0.1) */
  httpListenHost: string;
  /** true이면 루프백이 아닌 바인딩에서도 ADMIN_API_KEY 없이 기동 허용 */
  allowInsecureHttpAdmin: boolean;
  recallProfileEnabled: boolean;
  fts5FallbackEnabled: boolean;
  telemetryStoreQueryPlaintext: boolean;
  autoSetAnchorDefault: boolean;
  httpDefaultAgentId: string | undefined;
  ownerScopeMode: 'strict' | 'warn' | 'off';
  sourceStrict: boolean;
  rememberDedupThreshold: number;
  rememberDedupMode: 'warn' | 'strict' | 'off';
}

export type UpdateMode = 'replace' | 'incremental' | 'versioned';

export interface RememberParams {
  content?: string;
  type?: MemoryTypeRequest;
  key?: string;
  value?: string;
  always_load?: boolean;
  immutable?: boolean;
  task_goal?: string;
  steps?: string;
  reflection_notes?: string;
  workflow_name?: string;
  skill_name?: string;
  trigger_conditions?: string;
  update_mode?: UpdateMode;
  tags?: string[];
  importance?: number;
  source?: string;
  privacy_scope?: PrivacyScope;
}

export type ReturnFormat = 'full' | 'steps_only';

export interface RecallParams {
  query?: string;
  type?: MemoryTypeRequest;
  key?: string;
  agent_id?: string;
  filters?: MemorySearchFilters;
  limit?: number;
  workflow_name?: string;
  skill_name?: string;
  match_trigger_conditions?: boolean;
  return_format?: ReturnFormat;
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

/** meta_memory_stats 테이블과 일대일 대응되는 통계 */
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

export interface GetMetaMemoryStatsParams {
  memory_id?: string;
  memory_ids?: string[];
  min_recall_count?: number;
  min_confidence?: number;
  limit?: number;
}

export interface MetaMemoryStatsResult {
  items: MetaMemoryStats[];
  total_count: number;
}
