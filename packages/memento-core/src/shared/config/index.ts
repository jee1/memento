/**
 * Memento MCP Server 설정 관리
 */

import { config } from 'dotenv';
import type { MementoConfig, EmbeddingProvider, LLMProvider } from '../types/index.js';
import { validateConfiguration } from '../utils/configuration-validator.js';
import { isValidConfigurationEnvironment } from '../utils/environment-check.js';
import { parseTypeParamMode } from '../utils/type-param-validator.js';
import {
  providerDimensionDefaults,
  resolveNumber,
  resolveOptionalNumber,
  resolveOptionalString,
  resolveString,
  resolveBoolean,
  getRawEnvValue,
  expandHomeDirPath
} from './environment.js';

// 환경 변수 로드
config();

const embeddingProvider = (resolveString('EMBEDDING_PROVIDER') as EmbeddingProvider) || 'minilm';
const llmProvider = (resolveString('LLM_PROVIDER') as LLMProvider) || 'auto';

const embeddingDimensions: number =
  (resolveOptionalNumber('EMBEDDING_DIMENSIONS') ??
  providerDimensionDefaults[embeddingProvider] ??
  providerDimensionDefaults.minilm) as number;

export const mementoConfig: MementoConfig = {
  // 데이터베이스 설정
  dbPath: expandHomeDirPath(resolveString('DB_PATH')),

  // MCP 서버 설정
  serverName: resolveString('MCP_SERVER_NAME'),
  serverVersion: resolveString('MCP_SERVER_VERSION'),
  port: resolveNumber('MCP_SERVER_PORT', { fallbackKeys: ['PORT'] }),

  // 임베딩 설정
  embeddingProvider,
  openaiApiKey: resolveOptionalString('OPENAI_API_KEY'),
  openaiModel: resolveString('OPENAI_MODEL'),
  openaiLlmModel: resolveString('OPENAI_LLM_MODEL'),
  geminiApiKey: resolveOptionalString('GEMINI_API_KEY'),
  geminiModel: resolveString('GEMINI_MODEL'),
  embeddingDimensions,
  // LLM 설정
  llmProvider,
  ollamaBaseUrl: resolveString('OLLAMA_BASE_URL'),
  ollamaModel: resolveString('OLLAMA_MODEL'),

  // 검색 설정
  searchDefaultLimit: resolveNumber('SEARCH_DEFAULT_LIMIT'),
  searchMaxLimit: resolveNumber('SEARCH_MAX_LIMIT'),

  // 망각 정책 설정 (시간 단위: 시간)
  forgetTTL: {
    working: resolveNumber('FORGET_WORKING_TTL'),
    episodic: resolveNumber('FORGET_EPISODIC_TTL'),
    semantic: resolveNumber('FORGET_SEMANTIC_TTL'),
    procedural: resolveNumber('FORGET_PROCEDURAL_TTL')
  },

  // 로깅 설정
  logLevel: resolveString('LOG_LEVEL'),
  logFile: resolveOptionalString('LOG_FILE'),
  mcpLogProtocol: resolveBoolean('MCP_LOG_PROTOCOL', { defaultValue: false }),

  // 개발 설정
  nodeEnv: resolveString('NODE_ENV'),

  // type 파라미터 롤아웃 모드 설정 (안전한 파싱)
  typeParamMode: parseTypeParamMode(getRawEnvValue('MEMENTO_TYPE_PARAM_MODE')),

  // Consolidation Score System 설정 (기본값: false - 비활성화)
  consolidationScoreEnabled: resolveBoolean('CONSOLIDATION_SCORE_ENABLED', { defaultValue: false }),

  // FTS5 Migration Status (런타임 캐시용, 초기값: 'pending')
  // 실제 값은 데이터베이스에서 로드되며, initializeDatabase에서 업데이트됨
  fts5MigrationStatus: 'pending' as 'pending' | 'in_progress' | 'completed' | 'failed',

  // WAL 체크포인트 스케줄러 설정
  walCheckpointIntervalMs: resolveNumber('WAL_CHECKPOINT_INTERVAL_MS', { defaultValue: 300000 }),
  walSizeWarningThreshold: resolveNumber('WAL_SIZE_WARNING_THRESHOLD', { defaultValue: 16777216 }),
  walSizeDangerThreshold: resolveNumber('WAL_SIZE_DANGER_THRESHOLD', { defaultValue: 25165824 }),
  walCheckpointUseDedicatedConnection: resolveBoolean('WAL_CHECKPOINT_USE_DEDICATED_CONNECTION', { defaultValue: true }),
  walCheckpointMaxRetries: resolveNumber('WAL_CHECKPOINT_MAX_RETRIES', { defaultValue: 3 }),
  walCheckpointRetryBackoffMs: resolveNumber('WAL_CHECKPOINT_RETRY_BACKOFF_MS', { defaultValue: 1000 }),
  diagnosticsEnabled: resolveBoolean('DIAGNOSTICS_ENABLED', { defaultValue: false }),
  diagnosticsIntervalMs: resolveNumber('DIAGNOSTICS_INTERVAL_MS', { defaultValue: 15000 }),
  diagnosticsLogDir: resolveString('DIAGNOSTICS_LOG_DIR', { defaultValue: '/app/logs/diagnostics' }),
  diagnosticsJsonlMaxBytes: resolveNumber('DIAGNOSTICS_JSONL_MAX_BYTES', { defaultValue: 64 * 1024 * 1024 }),
  diagnosticsJsonlRetainFiles: resolveNumber('DIAGNOSTICS_JSONL_RETAIN_FILES', { defaultValue: 3 }),

  // 데이터베이스 락 모니터 설정
  lockMonitorIntervalMs: resolveNumber('LOCK_MONITOR_INTERVAL_MS', { defaultValue: 60000 }),
  lockMonitorWarningThresholdMs: resolveNumber('LOCK_MONITOR_WARNING_THRESHOLD_MS', { defaultValue: 5000 }),
  lockMonitorDangerThresholdMs: resolveNumber('LOCK_MONITOR_DANGER_THRESHOLD_MS', { defaultValue: 30000 }),
  lockMonitorCriticalThresholdMs: resolveNumber('LOCK_MONITOR_CRITICAL_THRESHOLD_MS', { defaultValue: 60000 }),
  batchSchedulerEnabled: resolveBoolean('BATCH_SCHEDULER_ENABLED', { defaultValue: true }),
  walCheckpointEnabled: resolveBoolean('WAL_CHECKPOINT_ENABLED', { defaultValue: true }),
  dbLockMonitorEnabled: resolveBoolean('DB_LOCK_MONITOR_ENABLED', { defaultValue: true }),

  // Procedural Memory 추출 전략 (Issue #57 Phase 2)
  proceduralExtractionStrategy: (getRawEnvValue('PROCEDURAL_EXTRACTION_STRATEGY') === 'llm_first'
    ? 'llm_first'
    : 'rule_only') as 'llm_first' | 'rule_only',
  proceduralLlmExtractorTimeoutMs: resolveNumber('PROCEDURAL_LLM_EXTRACTOR_TIMEOUT_MS', { defaultValue: 10000 }),

  // CORS: 허용 오리진 목록 (환경 변수 CORS_ALLOWED_ORIGINS 쉼표 구분, 비어 있으면 크로스 오리진 미허용)
  corsAllowedOrigins: (resolveOptionalString('CORS_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Admin/API/Quality 인증 (ADMIN_API_KEY 설정 시 해당 라우트에 Bearer 또는 X-API-Key 필요)
  adminApiKey: resolveOptionalString('ADMIN_API_KEY'),

  // HTTP 바인드·보안 (원격 바인딩 시 ADMIN_API_KEY 또는 루프백/명시적 insecure 필요)
  httpListenHost: resolveString('MEMENTO_HTTP_BIND_HOST', {
    fallbackKeys: ['HTTP_BIND_HOST'],
    // 신규 클론·ADMIN_API_KEY 미설정에서도 로컬 개발이 동작하도록 루프백 기본값.
    // 모든 인터페이스에 노출하려면 0.0.0.0(또는 ::) + ADMIN_API_KEY 등 명시 필요.
    defaultValue: '127.0.0.1'
  }),
  allowInsecureHttpAdmin: resolveBoolean('MEMENTO_ALLOW_INSECURE_HTTP_ADMIN', { defaultValue: false }),

  recallProfileEnabled: getRawEnvValue('MEMENTO_RECALL_PROFILE') === '1',
  fts5FallbackEnabled: resolveBoolean('MEMENTO_FTS5_FALLBACK_ENABLED', { defaultValue: false }),

  telemetryStoreQueryPlaintext: resolveBoolean('TELEMETRY_STORE_QUERY_PLAINTEXT', { defaultValue: false })
};

// 검색 랭킹 가중치 (Memento-Goals.md 참조)
export const searchRankingWeights = {
  relevance: 0.50,
  recency: 0.20,
  importance: 0.20,
  usage: 0.10,
  duplication_penalty: 0.15
};

// 기본 태그 분류
export const defaultTags = {
  tech: ['javascript', 'typescript', 'react', 'node', 'sqlite', 'mcp'],
  pref: ['coffee', 'tea', 'morning', 'evening'],
  task: ['ads-settlement', 'bug-fix', 'feature', 'refactor'],
  project: ['memento', 'mcp-server', 'ai-agent']
};

// 유효성 검사
export function validateConfig(): void {
  if (!isValidConfigurationEnvironment()) {
    return;
  }
  // MCP 프로토콜 준수: stderr로만 출력하도록 logger 설정
  // console.warn/error는 이미 오버라이드되었지만, 명시적으로 stderr logger 전달
  validateConfiguration(mementoConfig, {
    logger: {
      warn: (message?: any, ...optionalParams: any[]) => {
        process.stderr.write(`[CONFIG WARN] ${String(message)} ${optionalParams.map(String).join(' ')}\n`);
      },
      error: (message?: any, ...optionalParams: any[]) => {
        process.stderr.write(`[CONFIG ERROR] ${String(message)} ${optionalParams.map(String).join(' ')}\n`);
      }
    }
  });
}
