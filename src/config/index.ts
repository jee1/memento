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
  getRawEnvValue
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
  dbPath: resolveString('DB_PATH'),

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

  // 개발 설정
  nodeEnv: resolveString('NODE_ENV'),

  // type 파라미터 롤아웃 모드 설정 (안전한 파싱)
  typeParamMode: parseTypeParamMode(getRawEnvValue('MEMENTO_TYPE_PARAM_MODE')),

  // Consolidation Score System 설정 (기본값: false - 비활성화)
  consolidationScoreEnabled: resolveBoolean('CONSOLIDATION_SCORE_ENABLED', { defaultValue: false }),

  // FTS5 Migration Status (런타임 캐시용, 초기값: 'pending')
  // 실제 값은 데이터베이스에서 로드되며, initializeDatabase에서 업데이트됨
  fts5MigrationStatus: 'pending' as 'pending' | 'in_progress' | 'completed' | 'failed'
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
  validateConfiguration(mementoConfig);
}
