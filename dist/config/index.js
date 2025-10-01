/**
 * Memento MCP Server 설정 관리
 */
import { config } from 'dotenv';
// 환경 변수 로드
config();
export const mementoConfig = {
    // 데이터베이스 설정
    dbPath: process.env.DB_PATH || './data/memory.db',
    // MCP 서버 설정
    serverName: process.env.MCP_SERVER_NAME || 'memento-memory',
    serverVersion: process.env.MCP_SERVER_VERSION || '0.1.0',
    port: parseInt(process.env.MCP_SERVER_PORT || '3000', 10),
    // 임베딩 설정
    embeddingProvider: process.env.EMBEDDING_PROVIDER || 'openai',
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,
    openaiModel: process.env.OPENAI_MODEL || 'text-embedding-3-small',
    geminiApiKey: process.env.GEMINI_API_KEY || undefined,
    geminiModel: process.env.GEMINI_MODEL || 'text-embedding-004',
    embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10),
    // 검색 설정
    searchDefaultLimit: parseInt(process.env.SEARCH_DEFAULT_LIMIT || '10', 10),
    searchMaxLimit: parseInt(process.env.SEARCH_MAX_LIMIT || '50', 10),
    // 망각 정책 설정 (시간 단위: 시간)
    forgetTTL: {
        working: parseInt(process.env.FORGET_WORKING_TTL || '48', 10),
        episodic: parseInt(process.env.FORGET_EPISODIC_TTL || '2160', 10), // 90일
        semantic: parseInt(process.env.FORGET_SEMANTIC_TTL || '-1', 10), // 무기한
        procedural: parseInt(process.env.FORGET_PROCEDURAL_TTL || '-1', 10) // 무기한
    },
    // 로깅 설정
    logLevel: process.env.LOG_LEVEL || 'info',
    logFile: process.env.LOG_FILE || undefined,
    // 개발 설정
    nodeEnv: process.env.NODE_ENV || 'development'
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
export function validateConfig() {
    // 임베딩 제공자별 API 키 검증
    if (mementoConfig.embeddingProvider === 'openai' && !mementoConfig.openaiApiKey) {
        throw new Error('OPENAI_API_KEY is required when using OpenAI embedding provider');
    }
    if (mementoConfig.embeddingProvider === 'gemini' && !mementoConfig.geminiApiKey) {
        throw new Error('GEMINI_API_KEY is required when using Gemini embedding provider');
    }
    if (mementoConfig.embeddingProvider === 'openai' && !mementoConfig.openaiApiKey && mementoConfig.nodeEnv === 'production') {
        throw new Error('OPENAI_API_KEY is required in production environment');
    }
    if (mementoConfig.embeddingDimensions <= 0) {
        throw new Error('EMBEDDING_DIMENSIONS must be a positive number');
    }
    if (mementoConfig.searchDefaultLimit <= 0 || mementoConfig.searchMaxLimit <= 0) {
        throw new Error('Search limits must be positive numbers');
    }
    if (mementoConfig.searchDefaultLimit > mementoConfig.searchMaxLimit) {
        throw new Error('SEARCH_DEFAULT_LIMIT cannot be greater than SEARCH_MAX_LIMIT');
    }
}
//# sourceMappingURL=index.js.map