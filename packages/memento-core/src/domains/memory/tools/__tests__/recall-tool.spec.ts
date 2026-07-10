import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { RecallTool } from '../recall-tool.js';
import type { ToolContext } from '../../../tools/types.js';
import { HybridSearchEngine, createHybridSearchEngine } from '../../../search/algorithms/hybrid-search-engine.js';
import { MemoryEmbeddingService } from '../../services/memory-embedding-service.js';
import { AnchorManager } from '../../../anchor/services/anchor/anchor-manager.js';
import { AnchorCacheService } from '../../../anchor/services/anchor/anchor-cache-service.js';
import { AnchorSearchService } from '../../../anchor/services/anchor/anchor-search-service.js';
import { getVectorSearchEngine, type VectorSearchEngine } from '../../../search/algorithms/vector-search-engine.js';
import { MemoryNeighborService } from '../../services/memory-neighbor-service.js';
import { mementoConfig } from '../../../../shared/config/index.js';

/**
 * 테스트용 데이터베이스 초기화
 */
function initializeTestDatabase(db: Database.Database): void {
  // memory_item 테이블 생성
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT CHECK (type IN ('working','episodic','semantic','procedural')) NOT NULL,
      content TEXT NOT NULL,
      importance REAL CHECK (importance >= 0 AND importance <= 1) DEFAULT 0.5,
      privacy_scope TEXT CHECK (privacy_scope IN ('private','team','public')) DEFAULT 'private',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_accessed TIMESTAMP,
      pinned BOOLEAN DEFAULT FALSE,
      tags TEXT,
      source TEXT,
      view_count INTEGER DEFAULT 0,
      cite_count INTEGER DEFAULT 0,
      edit_count INTEGER DEFAULT 0,
      origin_source TEXT,
      task_goal TEXT,
      steps TEXT,
      reflection_notes TEXT,
      -- Procedural Memory Enhancement (v7.0) 필드
      workflow_name TEXT,
      skill_name TEXT,
      trigger_conditions TEXT,
      owner_id TEXT NULL,
      process_id TEXT NULL,
      session_id TEXT NULL,
          project_id TEXT,
          is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
          deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS core_memory (
      core_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL DEFAULT 'default',
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      always_load BOOLEAN NOT NULL DEFAULT 0,
      origin_source TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agent_id, key)
    );
    CREATE INDEX IF NOT EXISTS idx_core_memory_version ON core_memory(version);
    UPDATE core_memory SET version = 1 WHERE version = 0;

    CREATE TABLE IF NOT EXISTS knowledge_vault (
      vault_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL DEFAULT 'default',
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      immutable BOOLEAN NOT NULL DEFAULT 1,
      version INTEGER NOT NULL DEFAULT 1,
      previous_version_id TEXT,
      admin_override BOOLEAN NOT NULL DEFAULT 0,
      deleted_at TIMESTAMP,
      origin_source TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agent_id, key, version)
    );

    CREATE INDEX IF NOT EXISTS idx_core_memory_agent_id ON core_memory(agent_id);
    CREATE INDEX IF NOT EXISTS idx_core_memory_key ON core_memory(key);
    CREATE INDEX IF NOT EXISTS idx_knowledge_vault_agent_id ON knowledge_vault(agent_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_vault_key ON knowledge_vault(key);

    CREATE TABLE IF NOT EXISTS anchor (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      slot TEXT CHECK (slot IN ('A', 'B', 'C')) NOT NULL,
      memory_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE SET NULL,
      UNIQUE(agent_id, slot)
    );

    CREATE INDEX IF NOT EXISTS idx_anchor_agent_slot ON anchor(agent_id, slot);
    CREATE INDEX IF NOT EXISTS idx_anchor_memory_id ON anchor(memory_id) WHERE memory_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_anchor_agent_memory ON anchor(agent_id, memory_id) WHERE memory_id IS NOT NULL;

    -- Process Attribute (Issue #91): recall 스코어링용
    CREATE TABLE IF NOT EXISTS process_attribute (
      process_id TEXT PRIMARY KEY,
      topics TEXT NULL,
      workflow_names TEXT NULL,
      skill_names TEXT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
}

describe('RecallTool', () => {
  let db: Database.Database;
  let tool: RecallTool;
  let context: ToolContext;
  let hybridSearchEngine: HybridSearchEngine;
  let embeddingService: MemoryEmbeddingService;
  let anchorManager: AnchorManager;
  let cacheService: AnchorCacheService;
  let searchService: AnchorSearchService;
  let vectorSearchEngine: VectorSearchEngine;
  let savedTypeParamMode: (typeof mementoConfig)['typeParamMode'];
  let savedAutoSetAnchorDefault: boolean;

  beforeEach(() => {
    savedTypeParamMode = mementoConfig.typeParamMode;
    mementoConfig.typeParamMode = 'warn';
    savedAutoSetAnchorDefault = mementoConfig.autoSetAnchorDefault;
    mementoConfig.autoSetAnchorDefault = false;

    db = new Database(':memory:');
    initializeTestDatabase(db);

    embeddingService = new MemoryEmbeddingService();
    // HybridSearchEngine을 팩토리 함수로 생성하여 모든 의존성이 제대로 초기화되도록 함
    hybridSearchEngine = createHybridSearchEngine(
      undefined, // textSearchEngine (기본값 사용)
      embeddingService, // embeddingService 전달
      undefined, // vectorSearchEngine (기본값 사용)
      undefined, // resultCombiner (기본값 사용)
      undefined, // weightCalculator (기본값 사용)
      undefined // logger (기본값 사용)
    );
    // HybridSearchEngine의 isEmbeddingAvailable 메서드를 mock하여 항상 true 반환
    // (하이브리드 검색 경로로 가도록 보장)
    vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
    vectorSearchEngine = getVectorSearchEngine();
    
    // AnchorManager 설정
    cacheService = new AnchorCacheService();
    cacheService.setDatabase(db);
    cacheService.setEmbeddingService(embeddingService);
    
    searchService = new AnchorSearchService(cacheService);
    searchService.setDatabase(db);
    searchService.setHybridSearchEngine(hybridSearchEngine);
    searchService.setVectorSearchEngine(vectorSearchEngine);
    
    anchorManager = new AnchorManager(cacheService, searchService);
    anchorManager.setDatabase(db);

    tool = new RecallTool();

    context = {
      db,
      services: {
        hybridSearchEngine,
        embeddingService,
        anchorManager
      }
    };
  });

  afterEach(() => {
    mementoConfig.typeParamMode = savedTypeParamMode;
    mementoConfig.autoSetAnchorDefault = savedAutoSetAnchorDefault;
    if (db) {
      db.close();
    }
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('초기화', () => {
    it('should create tool with correct name and description', () => {
      const definition = tool.getDefinition();
      expect(definition.name).toBe('recall');
      expect(definition.description).toBe('관련 기억을 검색합니다');
    });

    it('should have correct input schema with new fields', () => {
      const definition = tool.getDefinition();
      expect(definition.inputSchema).toHaveProperty('type', 'object');
      expect(definition.inputSchema.properties).toHaveProperty('type');
      expect(definition.inputSchema.properties).toHaveProperty('key');
      expect(definition.inputSchema.properties).toHaveProperty('agent_id');
      expect(definition.inputSchema.properties.memory_types.items.enum).toContain('core');
      expect(definition.inputSchema.properties.memory_types.items.enum).toContain('vault');
    });

    it('query 필드 설명에 자연어 문장 입력 안내가 포함되어야 함', () => {
      const definition = tool.getDefinition();
      const desc = String(definition.inputSchema.properties.query.description);
      expect(desc).toContain('자연어 문장');
      expect(desc).toMatch(/e\.g\./i);
    });
  });

  describe('type 파라미터 롤아웃 (issue 290)', () => {
    let savedTypeParamMode: (typeof mementoConfig)['typeParamMode'];

    beforeEach(() => {
      savedTypeParamMode = mementoConfig.typeParamMode;
      mementoConfig.typeParamMode = 'warn';
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [],
        total_count: 0,
        query_time: 1,
        text_count: 0,
        vector_count: 0,
      });
    });

    afterEach(() => {
      mementoConfig.typeParamMode = savedTypeParamMode;
    });

    it("type 없고 memory_types만 있으면 missing-type 경고(validateTypeParam 문구)를 내지 않는다", async () => {
      const logWarningSpy = vi.spyOn(tool as unknown as { logWarning: (...args: unknown[]) => void }, 'logWarning');
      await tool.handle(
        { query: 'q', memory_types: ['semantic'] as const, limit: 5 },
        context,
      );
      const missingTypeCalls = logWarningSpy.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0].includes("type' 파라미터가 지정되지 않았습니다"),
      );
      expect(missingTypeCalls).toHaveLength(0);
    });

    it('type·memory_types 모두 없으면 warn 모드에서 missing-type 경고를 낸다', async () => {
      const logWarningSpy = vi.spyOn(tool as unknown as { logWarning: (...args: unknown[]) => void }, 'logWarning');
      await tool.handle({ query: 'q', limit: 5 }, context);
      expect(logWarningSpy).toHaveBeenCalledWith(
        expect.stringContaining("type' 파라미터가 지정되지 않았습니다"),
      );
    });
  });

  describe('type 파라미터 거절 시 로그 레벨 (issue 653)', () => {
    // MEMENTO_TYPE_PARAM_MODE=error(기본값)에서 type/query 누락은 호출자 입력 오류이지
    // 서버 결함이 아니므로 logError가 아닌 logWarning으로 기록되어야 한다.
    // logError로 기록되면 log-issue-monitor가 첫 발생 즉시 "bug" 이슈를 자동 등록한다(#653).
    //
    // 프로덕션에서는 bootstrap.ts가 항상 failureDetector를 초기화해서 넘기므로
    // BaseTool.handleFailure의 "FailureDetector 미초기화" logError 폴백은 실제로 타지 않는다.
    // 이 테스트도 동일하게 failureDetector를 채워 그 폴백 경로를 배제하고,
    // recall-tool.ts 자체의 로그 레벨 분기만 검증한다.
    let savedTypeParamMode: (typeof mementoConfig)['typeParamMode'];

    beforeEach(() => {
      savedTypeParamMode = mementoConfig.typeParamMode;
      mementoConfig.typeParamMode = 'error';
      context.services.failureDetector = {
        detectToolError: vi.fn().mockReturnValue({ detected: false }),
      } as unknown as ToolContext['services']['failureDetector'];
    });

    afterEach(() => {
      mementoConfig.typeParamMode = savedTypeParamMode;
    });

    it('type·memory_types 모두 없으면 error 모드에서 거절 시 logWarning만 호출되고 logError는 호출되지 않는다', async () => {
      const logWarningSpy = vi.spyOn(tool as unknown as { logWarning: (...args: unknown[]) => void }, 'logWarning');
      const logErrorSpy = vi.spyOn(tool as unknown as { logError: (...args: unknown[]) => void }, 'logError');

      await expect(tool.handle({ query: 'q', limit: 5 }, context)).rejects.toThrow(
        "type' 파라미터는 필수입니다",
      );

      expect(logWarningSpy).toHaveBeenCalledWith(
        'Recall 도구 실행 실패 (입력 검증)',
        expect.objectContaining({ error: expect.stringContaining("type' 파라미터는 필수입니다") }),
      );
      expect(logErrorSpy).not.toHaveBeenCalled();
    });

    it("type='core'가 아닌데 query가 없으면 error 모드 여부와 무관하게 logWarning만 호출되고 logError는 호출되지 않는다", async () => {
      const logWarningSpy = vi.spyOn(tool as unknown as { logWarning: (...args: unknown[]) => void }, 'logWarning');
      const logErrorSpy = vi.spyOn(tool as unknown as { logError: (...args: unknown[]) => void }, 'logError');

      await expect(tool.handle({ type: 'episodic' }, context)).rejects.toThrow();

      expect(logWarningSpy).toHaveBeenCalledWith(
        'Recall 도구 실행 실패 (입력 검증)',
        expect.anything(),
      );
      expect(logErrorSpy).not.toHaveBeenCalled();
    });

    it('실제 시스템 오류(DB 미초기화)는 여전히 logError로 기록된다', async () => {
      const logWarningSpy = vi.spyOn(tool as unknown as { logWarning: (...args: unknown[]) => void }, 'logWarning');
      const logErrorSpy = vi.spyOn(tool as unknown as { logError: (...args: unknown[]) => void }, 'logError');

      db.close();

      await expect(tool.handle({ type: 'core' }, context)).rejects.toThrow();

      expect(logErrorSpy).toHaveBeenCalledWith(
        expect.any(Error),
        'Recall 도구 실행 실패',
        expect.objectContaining({ params: { type: 'core' } }),
      );
      const inputValidationWarnCalls = logWarningSpy.mock.calls.filter(
        (c) => c[0] === 'Recall 도구 실행 실패 (입력 검증)',
      );
      expect(inputValidationWarnCalls).toHaveLength(0);
    });
  });

  describe('agent_id 무시 경고 (issue 291)', () => {
    beforeEach(() => {
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [],
        total_count: 0,
        query_time: 1,
        text_count: 0,
        vector_count: 0,
      });
    });

    it('memory_item 검색에서 agent_id가 있어도 무시 경고를 남기지 않는다', async () => {
      const logWarningSpy = vi.spyOn(
        tool as unknown as { logWarning: (...args: unknown[]) => void },
        'logWarning',
      );

      await tool.handle(
        { query: 'q', type: 'episodic', agent_id: 'default', limit: 5 },
        context,
      );

      const agentIdWarningCalls = logWarningSpy.mock.calls.filter(
        (c) =>
          typeof c[0] === 'string' &&
          c[0].includes('memory_item 검색 시 agent_id 파라미터는 무시됩니다'),
      );

      expect(agentIdWarningCalls).toHaveLength(0);
      expect(hybridSearchEngine.search).toHaveBeenCalledOnce();
    });
  });

  describe('include_score_breakdown (US3, T021)', () => {
    const mockItemBase = {
      id: 'mem_1',
      content: 'test',
      type: 'episodic' as const,
      importance: 0.5,
      created_at: new Date().toISOString(),
      pinned: false,
      tags: [] as string[],
      origin_source: JSON.stringify({
        tool: 'remember',
        caller: 'user',
        timestamp: new Date().toISOString(),
        context: { type: 'episodic' },
      }),
      textScore: 0.8,
      vectorScore: 0.7,
      finalScore: 0.75,
      recall_reason: '텍스트 검색 결과',
    };

    const sampleBreakdown = {
      relevance: { score: 0.2, pct: 25 },
      recency: { score: 0.1, pct: 10 },
      importance: { score: 0.1, pct: 10 },
      usage: { score: 0.05, pct: 5 },
      feedback: { score: 0.02, pct: 5 },
      duplication_penalty: { score: -0.01, pct: 2 },
      total: 0.75,
    };

    it('include_score_breakdown=true이면 항목에 score_breakdown이 포함된다', async () => {
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [{ ...mockItemBase, score_breakdown: sampleBreakdown }],
        total_count: 1,
        query_time: 10,
        text_count: 1,
        vector_count: 1,
      });
      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      const result = await tool.handle(
        {
          query: 'test',
          type: 'episodic',
          include_score_breakdown: true,
          include_metadata: true,
        },
        context,
      );
      const data = JSON.parse(result.content[0].text) as {
        items?: Array<{ score_breakdown?: { total: number } }>;
      };
      expect(data.items?.[0]?.score_breakdown).toBeDefined();
      expect(data.items?.[0]?.score_breakdown?.total).toBe(0.75);
    });

    it('include_score_breakdown=false면 응답에 score_breakdown이 없다', async () => {
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [{ ...mockItemBase }],
        total_count: 1,
        query_time: 10,
        text_count: 1,
        vector_count: 1,
      });
      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      const result = await tool.handle(
        { query: 'test', type: 'episodic', include_score_breakdown: false },
        context,
      );
      const data = JSON.parse(result.content[0].text) as {
        items?: Array<{ score_breakdown?: unknown }>;
      };
      expect(data.items?.[0]?.score_breakdown).toBeUndefined();
    });

    it('include_metadata=false이면 score_breakdown도 포함되지 않는다', async () => {
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [{ ...mockItemBase, score_breakdown: sampleBreakdown }],
        total_count: 1,
        query_time: 10,
        text_count: 1,
        vector_count: 1,
      });
      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      const result = await tool.handle(
        {
          query: 'test',
          type: 'episodic',
          include_score_breakdown: true,
          include_metadata: false,
        },
        context,
      );
      const data = JSON.parse(result.content[0].text) as {
        items?: Array<{ score_breakdown?: unknown }>;
      };
      expect(data.items?.[0]?.score_breakdown).toBeUndefined();
    });
  });

  describe('embedding_provider 및 벡터 인덱스 fallback stderr', () => {
    let savedEmbeddingProvider: (typeof mementoConfig)['embeddingProvider'];

    beforeEach(() => {
      savedEmbeddingProvider = mementoConfig.embeddingProvider;
      mementoConfig.embeddingProvider = 'minilm';
    });

    afterEach(() => {
      mementoConfig.embeddingProvider = savedEmbeddingProvider;
    });

    const mockSearchItem = {
      id: 'mem_1',
      content: 'test',
      type: 'episodic',
      importance: 0.5,
      created_at: new Date().toISOString(),
      pinned: false,
      tags: [],
      origin_source: JSON.stringify({
        tool: 'remember',
        caller: 'user',
        timestamp: new Date().toISOString(),
        context: { type: 'episodic' }
      }),
      textScore: 0.8,
      vectorScore: 0.7,
      finalScore: 0.75,
      recall_reason: '텍스트 검색 결과'
    };

    const TFIDF_QUERY_FALLBACK_MSG =
      '⚠️ [Memento] 이번 검색의 쿼리 임베딩에 TF-IDF가 사용되었습니다.' +
      ' sqlite-vec 유사도 fallback이거나, 다중 provider VEC 검색에서 고차원 임베딩 대신 TF-IDF로 생성된 경우 의미 기반 검색 품질이 저하될 수 있습니다.\n';
    const TFIDF_QUERY_FALLBACK_MSG_WITH_MINILM =
      '⚠️ [Memento] 이번 검색의 쿼리 임베딩에 TF-IDF가 사용되었습니다. TF-IDF로 대체된 요청 provider: minilm.' +
      ' sqlite-vec 유사도 fallback이거나, 다중 provider VEC 검색에서 고차원 임베딩 대신 TF-IDF로 생성된 경우 의미 기반 검색 품질이 저하될 수 있습니다.\n';

    it('fallback_used=true여도 tfidf_query_embedding_fallback이 true일 때만 stderr에 TF-IDF 품질 경고를 출력한다', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [mockSearchItem],
        total_count: 1,
        query_time: 10,
        text_count: 1,
        vector_count: 1,
        fallback_used: true,
        query_embedding_providers: ['tfidf'],
        tfidf_query_embedding_fallback: true
      });
      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      await tool.handle({ query: 'test', type: 'episodic' }, context);

      expect(stderrSpy).toHaveBeenCalledWith(TFIDF_QUERY_FALLBACK_MSG);
      stderrSpy.mockRestore();
    });

    it('include_metadata=false여도 fallback_used+tfidf 쿼리일 때 stderr 경고는 출력한다', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [mockSearchItem],
        total_count: 1,
        query_time: 10,
        text_count: 1,
        vector_count: 1,
        fallback_used: true,
        query_embedding_providers: ['tfidf'],
        tfidf_query_embedding_fallback: true
      });
      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      const result = await tool.handle(
        { query: 'test', type: 'episodic', include_metadata: false },
        context
      );
      const resultData = JSON.parse(result.content[0].text);

      expect(stderrSpy).toHaveBeenCalledWith(TFIDF_QUERY_FALLBACK_MSG);
      expect(resultData.metadata?.embedding_provider).toBeUndefined();
      stderrSpy.mockRestore();
    });

    it('fallback_used=true이어도 tfidf_query_embedding_fallback이 설정되지 않으면 TF-IDF 품질 경고를 출력하지 않는다 (provider_filter=[tfidf])', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [mockSearchItem],
        total_count: 1,
        query_time: 10,
        text_count: 1,
        vector_count: 1,
        fallback_used: true,
        query_embedding_providers: ['tfidf']
      });
      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      await tool.handle({ query: 'test', type: 'episodic' }, context);

      const tfidfQualityWarnings = stderrSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('이번 검색의 쿼리 임베딩에 TF-IDF')
      );
      expect(tfidfQualityWarnings).toHaveLength(0);
      stderrSpy.mockRestore();
    });

    it('fallback_used=true이어도 쿼리 임베딩이 minilm이면 TF-IDF 품질 경고를 출력하지 않는다', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [mockSearchItem],
        total_count: 1,
        query_time: 10,
        text_count: 1,
        vector_count: 1,
        fallback_used: true,
        query_embedding_providers: ['minilm']
      });
      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      await tool.handle({ query: 'test', type: 'episodic' }, context);

      const tfidfQualityWarnings = stderrSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('쿼리 임베딩에 TF-IDF')
      );
      expect(tfidfQualityWarnings).toHaveLength(0);
      stderrSpy.mockRestore();
    });

    it('query_embedding_providers가 있으면 metadata.embedding_provider·query_embedding_providers에 반영된다', async () => {
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [mockSearchItem],
        total_count: 1,
        query_time: 10,
        text_count: 1,
        vector_count: 1,
        fallback_used: false,
        query_embedding_providers: ['tfidf']
      });
      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      const result = await tool.handle({ query: 'test', type: 'episodic' }, context);
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.metadata.embedding_provider).toBe('tfidf');
      expect(resultData.metadata.query_embedding_providers).toEqual(['tfidf']);
    });

    it('복수 query_embedding_providers일 때 metadata.embedding_provider는 canonical 단일 값·배열은 전체 목록이다', async () => {
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [mockSearchItem],
        total_count: 1,
        query_time: 10,
        text_count: 1,
        vector_count: 1,
        fallback_used: false,
        query_embedding_providers: ['tfidf', 'minilm']
      });
      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      const result = await tool.handle({ query: 'test', type: 'episodic' }, context);
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.metadata.query_embedding_providers).toEqual(['minilm', 'tfidf']);
      expect(resultData.metadata.embedding_provider).toBe('minilm');
    });

    it('fallback_used=false이고 tfidf_query_embedding_fallback도 false면 TF-IDF 품질 경고를 stderr에 출력하지 않는다', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [mockSearchItem],
        total_count: 1,
        query_time: 10,
        text_count: 1,
        vector_count: 1,
        fallback_used: false,
        query_embedding_providers: ['tfidf'],
        tfidf_query_embedding_fallback: false
      });
      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      await tool.handle({ query: 'test', type: 'episodic' }, context);

      const tfidfQualityWarnings = stderrSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('이번 검색의 쿼리 임베딩에 TF-IDF')
      );
      expect(tfidfQualityWarnings).toHaveLength(0);
      stderrSpy.mockRestore();
    });

    it('fallback_used=false여도 tfidf_query_embedding_fallback이면 stderr에 TF-IDF 품질 경고를 출력한다', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [mockSearchItem],
        total_count: 1,
        query_time: 10,
        text_count: 1,
        vector_count: 1,
        fallback_used: false,
        query_embedding_providers: ['tfidf'],
        tfidf_query_embedding_fallback: true
      });
      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      await tool.handle({ query: 'test', type: 'episodic' }, context);

      expect(stderrSpy).toHaveBeenCalledWith(TFIDF_QUERY_FALLBACK_MSG);
      stderrSpy.mockRestore();
    });

    it('tfidf_query_embedding_fallback_providers가 있으면 stderr에 대체된 요청 provider를 포함한다', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [mockSearchItem],
        total_count: 1,
        query_time: 10,
        text_count: 1,
        vector_count: 1,
        fallback_used: false,
        query_embedding_providers: ['tfidf'],
        tfidf_query_embedding_fallback: true,
        tfidf_query_embedding_fallback_providers: ['minilm']
      });
      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      await tool.handle({ query: 'test', type: 'episodic' }, context);

      expect(stderrSpy).toHaveBeenCalledWith(TFIDF_QUERY_FALLBACK_MSG_WITH_MINILM);
      stderrSpy.mockRestore();
    });

    it('MEMENTO_CLI_QUIET=1이면 TF-IDF fallback 경고를 stderr에 출력하지 않는다', async () => {
      const prevQuiet = process.env.MEMENTO_CLI_QUIET;
      process.env.MEMENTO_CLI_QUIET = '1';
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [mockSearchItem],
        total_count: 1,
        query_time: 10,
        text_count: 1,
        vector_count: 1,
        fallback_used: true,
        query_embedding_providers: ['tfidf'],
        tfidf_query_embedding_fallback: true,
        tfidf_query_embedding_fallback_providers: ['openai']
      });
      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      await tool.handle({ query: 'test', type: 'episodic' }, context);

      const tfidfQualityWarnings = stderrSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('이번 검색의 쿼리 임베딩에 TF-IDF')
      );
      expect(tfidfQualityWarnings).toHaveLength(0);
      stderrSpy.mockRestore();
      if (prevQuiet === undefined) {
        delete process.env.MEMENTO_CLI_QUIET;
      } else {
        process.env.MEMENTO_CLI_QUIET = prevQuiet;
      }
    });

    it('mementoConfig.embeddingProvider가 tfidf여도 명시적 provider 강등이면 TF-IDF 품질 경고를 출력한다', async () => {
      mementoConfig.embeddingProvider = 'tfidf';
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [mockSearchItem],
        total_count: 1,
        query_time: 10,
        text_count: 1,
        vector_count: 1,
        fallback_used: false,
        query_embedding_providers: ['tfidf'],
        tfidf_query_embedding_fallback: true,
        tfidf_query_embedding_fallback_providers: ['openai']
      });
      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      await tool.handle({ query: 'test', type: 'episodic' }, context);

      const tfidfQualityWarnings = stderrSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('이번 검색의 쿼리 임베딩에 TF-IDF')
      );
      expect(tfidfQualityWarnings).toHaveLength(1);
      expect(stderrSpy).toHaveBeenCalledWith(
        '⚠️ [Memento] 이번 검색의 쿼리 임베딩에 TF-IDF가 사용되었습니다. TF-IDF로 대체된 요청 provider: openai. sqlite-vec 유사도 fallback이거나, 다중 provider VEC 검색에서 고차원 임베딩 대신 TF-IDF로 생성된 경우 의미 기반 검색 품질이 저하될 수 있습니다.\n'
      );
      stderrSpy.mockRestore();
    });

    it('mementoConfig.embeddingProvider가 tfidf면 fallback_used+tfidf여도 TF-IDF 품질 경고를 출력하지 않는다', async () => {
      mementoConfig.embeddingProvider = 'tfidf';
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [mockSearchItem],
        total_count: 1,
        query_time: 10,
        text_count: 1,
        vector_count: 1,
        fallback_used: true,
        query_embedding_providers: ['tfidf']
      });
      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      await tool.handle({ query: 'test', type: 'episodic' }, context);

      const tfidfQualityWarnings = stderrSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('이번 검색의 쿼리 임베딩에 TF-IDF')
      );
      expect(tfidfQualityWarnings).toHaveLength(0);
      stderrSpy.mockRestore();
    });
  });

  describe('Core Memory 조회', () => {
    beforeEach(() => {
      // 테스트 데이터 준비
      const originSource = JSON.stringify({
        tool: 'remember',
        caller: 'user',
        timestamp: new Date().toISOString(),
        context: { type: 'core' }
      });

      DatabaseUtils.run(db, `
        INSERT INTO core_memory (core_id, agent_id, key, value, always_load, origin_source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, ['core_123', 'default', 'persona', 'I am helpful', 1, originSource]);

      DatabaseUtils.run(db, `
        INSERT INTO core_memory (core_id, agent_id, key, value, always_load, origin_source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, ['core_456', 'default', 'instructions', 'Be polite', 0, originSource]);
    });

    it('should retrieve all core memories when type=core and no key', async () => {
      const params = {
        type: 'core'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items).toHaveLength(2);
      expect(resultData.items[0].type).toBe('core');
      expect(resultData.items[0]).toHaveProperty('memory_id');
      expect(resultData.items[0]).toHaveProperty('key');
      expect(resultData.items[0]).toHaveProperty('value');
      expect(resultData.items[0]).toHaveProperty('origin_source');
    });

    it('should retrieve specific core memory when type=core and key provided', async () => {
      const params = {
        type: 'core',
        key: 'persona'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items).toHaveLength(1);
      expect(resultData.items[0].key).toBe('persona');
      expect(resultData.items[0].value).toBe('I am helpful');
      expect(resultData.items[0].origin_source).toBeDefined();
    });

    it('should return empty array when key not found', async () => {
      const params = {
        type: 'core',
        key: 'nonexistent'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items).toHaveLength(0);
    });

    it('should ignore query parameter when type=core', async () => {
      const params = {
        type: 'core',
        query: 'should be ignored',
        key: 'persona'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items).toHaveLength(1);
      expect(resultData.search_type).toBe('direct');
    });

    it('should include origin_source in response', async () => {
      const params = {
        type: 'core',
        key: 'persona'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items[0].origin_source).toBeDefined();
      expect(resultData.items[0].origin_source.tool).toBe('remember');
      expect(resultData.items[0].origin_source.caller).toBe('user');
    });
  });

  describe('owner_id 필터 (다중 에이전트, Issue #57 Phase 2 D)', () => {
    it('Given: owner_id가 서로 다른 메모리 2건, When: recall에 owner_id 제공 시, Then: 해당 소유자 메모리만 반환', async () => {
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, owner_id, created_at) VALUES ('mem-a', 'episodic', 'Agent A memory', 0.5, 'private', 'agent-a', CURRENT_TIMESTAMP)
      `);
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, owner_id, created_at) VALUES ('mem-b', 'episodic', 'Agent B memory', 0.5, 'private', 'agent-b', CURRENT_TIMESTAMP)
      `);
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [
          { id: 'mem-a', content: 'Agent A memory', type: 'episodic', importance: 0.5, created_at: new Date().toISOString(), owner_id: 'agent-a', finalScore: 0.9 },
          { id: 'mem-b', content: 'Agent B memory', type: 'episodic', importance: 0.5, created_at: new Date().toISOString(), owner_id: 'agent-b', finalScore: 0.8 },
        ],
        total_count: 2,
        query_time: 10,
      });
      const params = { query: 'memory', type: 'episodic', owner_id: 'agent-a' };
      const result = await tool.handle(params, context);
      const data = JSON.parse(result.content[0].text);
      expect(data.items).toHaveLength(1);
      expect(data.items[0].memory_id).toBe('mem-a');
      expect(data.items[0].owner_id).toBe('agent-a');
    });
  });

  describe('process_id, session_id 필터 (Memori Attribution, Issue #87)', () => {
    it('Given: process_id가 서로 다른 메모리 2건, When: recall에 process_id 제공 시, Then: 해당 process 메모리만 반환', async () => {
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, process_id, created_at) VALUES ('mem-p1', 'episodic', 'Process 1 memory', 0.5, 'private', 'process-deploy', CURRENT_TIMESTAMP)
      `);
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, process_id, created_at) VALUES ('mem-p2', 'episodic', 'Process 2 memory', 0.5, 'private', 'process-review', CURRENT_TIMESTAMP)
      `);
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [
          { id: 'mem-p1', content: 'Process 1 memory', type: 'episodic', importance: 0.5, created_at: new Date().toISOString(), process_id: 'process-deploy', finalScore: 0.9 },
          { id: 'mem-p2', content: 'Process 2 memory', type: 'episodic', importance: 0.5, created_at: new Date().toISOString(), process_id: 'process-review', finalScore: 0.8 },
        ],
        total_count: 2,
        query_time: 10,
      });
      const params = { query: 'memory', type: 'episodic', process_id: 'process-deploy' };
      const result = await tool.handle(params, context);
      const data = JSON.parse(result.content[0].text);
      expect(data.items).toHaveLength(1);
      expect(data.items[0].memory_id).toBe('mem-p1');
      expect(data.items[0].process_id).toBe('process-deploy');
    });

    it('Given: session_id가 서로 다른 메모리 2건, When: recall에 session_id 제공 시, Then: 해당 session 메모리만 반환', async () => {
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [
          { id: 'mem-s1', content: 'Session 1 memory', type: 'episodic', importance: 0.5, created_at: new Date().toISOString(), session_id: 'session-abc', finalScore: 0.9 },
          { id: 'mem-s2', content: 'Session 2 memory', type: 'episodic', importance: 0.5, created_at: new Date().toISOString(), session_id: 'session-xyz', finalScore: 0.8 },
        ],
        total_count: 2,
        query_time: 10,
      });
      const params = { query: 'memory', type: 'episodic', session_id: 'session-abc' };
      const result = await tool.handle(params, context);
      const data = JSON.parse(result.content[0].text);
      expect(data.items).toHaveLength(1);
      expect(data.items[0].memory_id).toBe('mem-s1');
      expect(data.items[0].session_id).toBe('session-abc');
    });
  });

  describe('project_id 필터 (Project-scoped Memory, Issue #81)', () => {
    it('Given: project_id가 서로 다른 메모리 2건, When: recall에 project_id 제공 시, Then: 해당 project 메모리만 반환', async () => {
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [
          { id: 'mem-proj-a', content: 'proj-a 결정', type: 'semantic', importance: 0.8, created_at: new Date().toISOString(), project_id: 'proj-a', finalScore: 0.9 },
          { id: 'mem-proj-b', content: 'proj-b 결정', type: 'semantic', importance: 0.8, created_at: new Date().toISOString(), project_id: 'proj-b', finalScore: 0.8 },
        ],
        total_count: 2,
        query_time: 10,
      });
      const params = { query: '결정', type: 'semantic', project_id: 'proj-a' };
      const result = await tool.handle(params, context);
      const data = JSON.parse(result.content[0].text);
      expect(data.items).toHaveLength(1);
      expect(data.items[0].memory_id).toBe('mem-proj-a');
      expect(data.items[0].project_id).toBe('proj-a');
    });

    it('Given: project_id 미지정, When: recall 호출 시, Then: 모든 project 메모리 반환', async () => {
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [
          { id: 'mem-a2', content: '테스트 A2', type: 'semantic', importance: 0.8, created_at: new Date().toISOString(), project_id: 'proj-a', finalScore: 0.9 },
          { id: 'mem-b2', content: '테스트 B2', type: 'semantic', importance: 0.8, created_at: new Date().toISOString(), project_id: null, finalScore: 0.8 },
        ],
        total_count: 2,
        query_time: 10,
      });
      const params = { query: '테스트', type: 'semantic' };
      const result = await tool.handle(params, context);
      const data = JSON.parse(result.content[0].text);
      expect(data.items).toHaveLength(2);
    });
  });

  describe('recall profiling (recallProfileEnabled)', () => {
    it('Given: recallProfileEnabled=true, When: recall 성공 시, Then: logInfo에 recall_profile 및 total_ms 호출됨', async () => {
      const configRestore = mementoConfig.recallProfileEnabled;
      mementoConfig.recallProfileEnabled = true;
      const logSpy = vi.spyOn(tool, 'logInfo');
      try {
        const params = { type: 'core' };
        await tool.handle(params, context);
        const profileCall = logSpy.mock.calls.find(c => c[0] === 'recall_profile');
        expect(profileCall).toBeDefined();
        expect(profileCall![1]).toMatchObject({ total_ms: expect.any(Number) });
      } finally {
        mementoConfig.recallProfileEnabled = configRestore;
        logSpy.mockRestore();
      }
    });
  });

  describe('Knowledge Vault 조회', () => {
    beforeEach(() => {
      const originSource = JSON.stringify({
        tool: 'remember',
        caller: 'user',
        timestamp: new Date().toISOString(),
        context: { type: 'vault' }
      });

      DatabaseUtils.run(db, `
        INSERT INTO knowledge_vault (vault_id, agent_id, key, value, immutable, version, origin_source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, ['vault_123', 'default', 'user_rules', 'Never share personal info', 1, 1, originSource]);

      DatabaseUtils.run(db, `
        INSERT INTO knowledge_vault (vault_id, agent_id, key, value, immutable, version, origin_source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, ['vault_456', 'default', 'api_keys', 'encrypted_data', 1, 1, originSource]);
    });

    it('should retrieve all vault items when type=vault and no key', async () => {
      const params = {
        type: 'vault'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items).toHaveLength(2);
      expect(resultData.items[0].type).toBe('vault');
      expect(resultData.items[0]).toHaveProperty('memory_id');
      expect(resultData.items[0]).toHaveProperty('key');
      expect(resultData.items[0]).toHaveProperty('value');
      expect(resultData.items[0]).toHaveProperty('origin_source');
    });

    it('should retrieve specific vault item when type=vault and key provided', async () => {
      const params = {
        type: 'vault',
        key: 'user_rules'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items).toHaveLength(1);
      expect(resultData.items[0].key).toBe('user_rules');
      expect(resultData.items[0].value).toBe('Never share personal info');
      expect(resultData.items[0].origin_source).toBeDefined();
    });

    it('should ignore query parameter when type=vault', async () => {
      const params = {
        type: 'vault',
        query: 'should be ignored',
        key: 'user_rules'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items).toHaveLength(1);
      expect(resultData.search_type).toBe('direct');
    });

    it('should include origin_source in response', async () => {
      const params = {
        type: 'vault',
        key: 'user_rules'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items[0].origin_source).toBeDefined();
      expect(resultData.items[0].origin_source.tool).toBe('remember');
    });
  });

  describe('Memory Item 검색', () => {
    beforeEach(() => {
      const originSource = JSON.stringify({
        tool: 'remember',
        caller: 'user',
        timestamp: new Date().toISOString(),
        context: { type: 'episodic' }
      });

      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, origin_source, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, ['mem_1', 'episodic', 'I learned React hooks', 0.7, 'private', originSource]);

      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, origin_source, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, ['mem_2', 'semantic', 'React is a library', 0.9, 'private', originSource]);

      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, origin_source, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, ['mem_3', 'procedural', 'How to deploy', 0.8, 'private', originSource]);
    });

    it('should require query parameter for memory_item search', async () => {
      const params = {
        type: 'episodic'
      };

      await expect(tool.handle(params, context)).rejects.toThrow();
    });

    it('should filter by type parameter', async () => {
      const params = {
        type: 'episodic',
        query: 'React'
      };

      // hybridSearchEngine.search를 모킹
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [{
          id: 'mem_1',
          content: 'I learned React hooks',
          type: 'episodic',
          importance: 0.7,
          created_at: new Date().toISOString(),
          pinned: false,
          tags: [],
          origin_source: JSON.stringify({
            tool: 'remember',
            caller: 'user',
            timestamp: new Date().toISOString(),
            context: { type: 'episodic' }
          }),
          textScore: 0.8,
          vectorScore: 0.7,
          finalScore: 0.75,
          recall_reason: '텍스트 검색 결과'
        }],
        total_count: 1,
        query_time: 10
      });

      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items).toHaveLength(1);
      expect(resultData.items[0].type).toBe('episodic');
    });

    it('type 미지정 시 기본 episodic 필터가 적용되어야 함', async () => {
      // Given: 여러 타입의 메모리 생성
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, origin_source, created_at) VALUES ('mem1', 'episodic', 'Episodic memory content', 0.5, 'private', NULL, datetime('now'))
      `);
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, origin_source, created_at) VALUES ('mem2', 'semantic', 'Semantic memory content', 0.5, 'private', NULL, datetime('now'))
      `);
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, origin_source, created_at) VALUES ('mem3', 'working', 'Working memory content', 0.5, 'private', NULL, datetime('now'))
      `);

      const params = {
        query: 'memory'
      };
      // type 파라미터 미지정

      // Mock 검색 결과 (episodic만 반환)
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [
          {
            id: 'mem1',
            content: 'Episodic memory content',
            type: 'episodic',
            importance: 0.5,
            created_at: new Date(),
            finalScore: 0.8
          }
        ],
        total_count: 1,
        query_time: 10
      });
      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      // When: recall Tool 실행 (type 미지정)
      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // Then: 기본 타입(episodic)으로 필터링되어야 함
      expect(resultData.items).toHaveLength(1);
      expect(resultData.items[0].type).toBe('episodic');
      
      // search 호출 시 type 필터가 episodic로 전달되었는지 확인
      expect(hybridSearchEngine.search).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          filters: expect.objectContaining({
            type: ['episodic']
          })
        })
      );
    });

    it('memory_types 미지정 시에도 type 기본값이 적용되어야 함', async () => {
      // Given: 여러 타입의 메모리 생성
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, origin_source, created_at) VALUES ('mem1', 'episodic', 'Episodic memory content', 0.5, 'private', NULL, datetime('now'))
      `);
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, origin_source, created_at) VALUES ('mem2', 'semantic', 'Semantic memory content', 0.5, 'private', NULL, datetime('now'))
      `);

      const params = {
        query: 'memory'
        // type과 memory_types 모두 미지정
      };

      // Mock 검색 결과 (episodic만 반환)
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [
          {
            id: 'mem1',
            content: 'Episodic memory content',
            type: 'episodic',
            importance: 0.5,
            created_at: new Date(),
            finalScore: 0.8
          }
        ],
        total_count: 1,
        query_time: 10
      });
      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      // When: recall Tool 실행 (type과 memory_types 모두 미지정)
      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // Then: 기본 타입(episodic)으로 필터링되어야 함
      expect(resultData.items).toHaveLength(1);
      expect(resultData.items[0].type).toBe('episodic');
      
      // search 호출 시 type 필터가 episodic로 전달되었는지 확인
      expect(hybridSearchEngine.search).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          filters: expect.objectContaining({
            type: ['episodic']
          })
        })
      );
    });

    it('type 미지정 + memory_types 제공 시 기본 타입이 우선 적용되어야 함', async () => {
      // Given: 여러 타입의 메모리 생성
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, origin_source, created_at) VALUES ('mem1', 'episodic', 'Episodic memory content', 0.5, 'private', NULL, datetime('now'))
      `);
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, origin_source, created_at) VALUES ('mem2', 'semantic', 'Semantic memory content', 0.5, 'private', NULL, datetime('now'))
      `);

      const params = {
        query: 'memory',
        memory_types: ['semantic', 'working']
        // type 미지정, memory_types는 제공
      };

      // Mock 검색 결과 (episodic만 반환 - 기본 타입 우선)
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [
          {
            id: 'mem1',
            content: 'Episodic memory content',
            type: 'episodic',
            importance: 0.5,
            created_at: new Date(),
            finalScore: 0.8
          }
        ],
        total_count: 1,
        query_time: 10
      });
      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      // When: recall Tool 실행 (type 미지정, memory_types 제공)
      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // Then: 기본 타입(episodic)이 우선 적용되어야 함
      expect(resultData.items).toHaveLength(1);
      expect(resultData.items[0].type).toBe('episodic');
      
      // search 호출 시 type 필터가 episodic로 전달되었는지 확인 (memory_types 무시)
      expect(hybridSearchEngine.search).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          filters: expect.objectContaining({
            type: ['episodic']
          })
        })
      );
    });

    it('should filter memory_types array and remove core/vault', async () => {
      const params = {
        query: 'test',
        memory_types: ['episodic', 'core', 'vault']
      };

      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [],
        total_count: 0,
        query_time: 5
      });

      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      await tool.handle(params, context);

      // memory_types에서 core/vault가 제거되었는지 확인
      expect(hybridSearchEngine.search).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          filters: expect.objectContaining({
            type: ['episodic']
          })
        })
      );
    });

    it('should include origin_source in memory_item search results', async () => {
      const originSource = JSON.stringify({
        tool: 'remember',
        caller: 'user',
        timestamp: new Date().toISOString(),
        context: { type: 'episodic' }
      });

      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [{
          id: 'mem_1',
          content: 'I learned React hooks',
          type: 'episodic',
          importance: 0.7,
          created_at: new Date().toISOString(),
          pinned: false,
          tags: [],
          origin_source: originSource,
          textScore: 0.8,
          vectorScore: 0.7,
          finalScore: 0.75,
          recall_reason: '텍스트 검색 결과'
        }],
        total_count: 1,
        query_time: 10
      });

      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      const params = {
        query: 'React',
        type: 'episodic',
        include_metadata: true
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items[0].origin_source).toBeDefined();
      expect(resultData.items[0].origin_source.tool).toBe('remember');
      expect(resultData.items[0].origin_source.caller).toBe('user');
    });

    it('should use type parameter over memory_types when both provided', async () => {
      const params = {
        query: 'test',
        type: 'episodic',
        memory_types: ['semantic', 'procedural']
      };

      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [],
        total_count: 0,
        query_time: 5
      });

      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      await tool.handle(params, context);

      // type 파라미터가 우선 적용되었는지 확인
      expect(hybridSearchEngine.search).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          filters: expect.objectContaining({
            type: ['episodic']
          })
        })
      );
    });
  });

  describe('에러 처리', () => {
    it('should handle database errors gracefully', async () => {
      const params = {
        type: 'core'
      };

      db.close();

      await expect(tool.handle(params, context)).rejects.toThrow();
    });

    it('should handle missing hybridSearchEngine for memory_item search', async () => {
      const params = {
        query: 'test',
        type: 'episodic'
      };

      context.services.hybridSearchEngine = undefined;

      await expect(tool.handle(params, context)).rejects.toThrow();
    });
  });

  describe('Provider 필터링 기능', () => {
    beforeEach(() => {
      // Mock hybridSearchEngine 메서드들
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [],
        total_count: 0,
        query_time: 10
      });
      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
    });

    it('단일 provider 필터 - 지정된 provider만 검색', async () => {
      // Given: provider_filter로 minilm만 지정
      const params = {
        query: 'test query',
        type: 'episodic',
        provider_filter: ['minilm']
      };

      // When: recall 도구 실행
      const result = await tool.handle(params, context);

      // Then: provider_filter가 HybridSearchQuery에 전달되어야 함
      expect(result).toBeDefined();
      if (result && typeof result === 'object' && 'content' in result) {
        // ToolResult가 content를 포함하는 경우
        expect(hybridSearchEngine.search).toHaveBeenCalledWith(
          db,
          expect.objectContaining({
            query: 'test query',
            provider_filter: ['minilm']
          })
        );
      } else {
        // ToolResult가 success 필드를 포함하는 경우
        expect((result as any).success).toBe(true);
        expect(hybridSearchEngine.search).toHaveBeenCalledWith(
          db,
          expect.objectContaining({
            query: 'test query',
            provider_filter: ['minilm']
          })
        );
      }
    });

    it('다중 provider 필터 - 여러 provider 지정', async () => {
      // Given: provider_filter로 minilm과 openai 지정
      const params = {
        query: 'test query',
        type: 'episodic',
        provider_filter: ['minilm', 'openai']
      };

      // When: recall 도구 실행
      const result = await tool.handle(params, context);

      // Then: provider_filter가 HybridSearchQuery에 전달되어야 함
      expect(result).toBeDefined();
      expect(hybridSearchEngine.search).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          query: 'test query',
          provider_filter: ['minilm', 'openai']
        })
      );
    });

    it('필터 없음 케이스 - provider_filter 미지정 시 모든 provider 검색', async () => {
      // Given: provider_filter 없이 검색
      const params = {
        query: 'test query',
        type: 'episodic'
      };

      // When: recall 도구 실행
      const result = await tool.handle(params, context);

      // Then: provider_filter가 undefined이거나 전달되지 않아야 함
      expect(result).toBeDefined();
      expect(hybridSearchEngine.search).toHaveBeenCalled();
      const searchCall = (hybridSearchEngine.search as any).mock.calls[0];
      const searchQuery = searchCall[1];
      // provider_filter가 없거나 undefined여야 함 (모든 provider 검색)
      expect(searchQuery.provider_filter).toBeUndefined();
    });

    it('provider_filter 스키마 검증 - 유효하지 않은 provider 거부', async () => {
      // Given: 유효하지 않은 provider 포함
      const params = {
        query: 'test query',
        type: 'episodic',
        provider_filter: ['invalid_provider', 'minilm']
      };

      // When/Then: 스키마 검증 실패
      await expect(tool.handle(params, context)).rejects.toThrow();
    });
  });

  describe('reflection_notes 조회', () => {
    const createValidReflectionNote = (overrides: Partial<any> = {}) => ({
      failure_type: 'tool_error',
      failure_description: 'Test error',
      timestamp: new Date().toISOString(),
      ...overrides
    });

    beforeEach(() => {
      // 테스트용 procedural memory 데이터 생성
      const reflectionNote1 = createValidReflectionNote({ 
        timestamp: '2025-01-01T00:00:00Z',
        failure_description: 'Error 1'
      });
      const reflectionNote2 = createValidReflectionNote({ 
        timestamp: '2025-01-02T00:00:00Z',
        failure_description: 'Error 2'
      });

      // reflection_notes가 있는 procedural memory
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, task_goal, steps, reflection_notes, importance, privacy_scope, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        'proc_1',
        'procedural',
        'Test procedure 1',
        'Task A',
        JSON.stringify(['step1', 'step2']),
        JSON.stringify(reflectionNote1),
        0.8,
        'private',
        new Date().toISOString()
      ]);

      // reflection_notes가 배열인 procedural memory
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, task_goal, steps, reflection_notes, importance, privacy_scope, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        'proc_2',
        'procedural',
        'Test procedure 2',
        'Task B',
        JSON.stringify(['step1']),
        JSON.stringify([reflectionNote1, reflectionNote2]),
        0.7,
        'private',
        new Date().toISOString()
      ]);

      // reflection_notes가 없는 procedural memory
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, task_goal, steps, reflection_notes, importance, privacy_scope, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        'proc_3',
        'procedural',
        'Test procedure 3',
        'Task C',
        JSON.stringify(['step1']),
        null,
        0.6,
        'private',
        new Date().toISOString()
      ]);

      // episodic memory (reflection_notes 없음)
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at) VALUES (?, ?, ?, ?, ?, ?)
      `, [
        'epi_1',
        'episodic',
        'Test episodic memory',
        0.5,
        'private',
        new Date().toISOString()
      ]);

      // FTS5 인덱스 생성 (검색을 위해 필요)
      try {
        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_fts USING fts5(
            content,
            tags,
            reflection_notes,
            content=memory_item,
            content_rowid=rowid
          );
        `);
        
        // FTS5 인덱스에 데이터 삽입
        db.exec(`
          INSERT INTO memory_item_fts(rowid, content, tags, reflection_notes)
          SELECT rowid, content, tags, reflection_notes FROM memory_item;
        `);
      } catch (error) {
        // FTS5 테이블이 이미 존재하거나 생성 실패 시 무시
      }
    });

    describe('includeMetadata가 true일 때 reflection_notes 포함', () => {
      it('should include reflection_notes when includeMetadata is true', async () => {
        const params = {
          query: 'Test procedure',
          type: 'procedural',
          include_metadata: true,
          limit: 10
        };

        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'proc_1',
              content: 'Test procedure 1',
              type: 'procedural',
              importance: 0.8,
              created_at: new Date().toISOString(),
              task_goal: 'Task A',
              steps: JSON.stringify(['step1', 'step2']),
              reflection_notes: JSON.stringify(createValidReflectionNote({ 
                timestamp: '2025-01-01T00:00:00Z',
                failure_description: 'Error 1'
              })),
              finalScore: 0.9,
              textScore: 0.5,
              vectorScore: 0.4,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        expect(resultData.items).toBeDefined();
        expect(resultData.items.length).toBeGreaterThan(0);
        
        const proceduralItem = resultData.items.find((item: any) => item.type === 'procedural');
        expect(proceduralItem).toBeDefined();
        expect(proceduralItem.reflection_notes).toBeDefined();
        expect(proceduralItem.reflection_notes).not.toBeNull();
      });

      it('should not include reflection_notes when includeMetadata is false', async () => {
        const params = {
          query: 'Test procedure',
          type: 'procedural',
          include_metadata: false,
          limit: 10
        };

        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'proc_1',
              content: 'Test procedure 1',
              type: 'procedural',
              importance: 0.8,
              created_at: new Date().toISOString(),
              reflection_notes: JSON.stringify(createValidReflectionNote()),
              finalScore: 0.9,
              textScore: 0.5,
              vectorScore: 0.4,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        expect(resultData.items).toBeDefined();
        const proceduralItem = resultData.items.find((item: any) => item.type === 'procedural');
        expect(proceduralItem).toBeDefined();
        expect(proceduralItem.reflection_notes).toBeUndefined();
      });
    });

    describe('Procedural Memory 조회 시 reflection_notes 자동 포함', () => {
      it('should automatically include reflection_notes for procedural memory', async () => {
        const params = {
          query: 'Test procedure',
          type: 'procedural',
          include_metadata: true,
          limit: 10
        };

        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'proc_1',
              content: 'Test procedure 1',
              type: 'procedural',
              importance: 0.8,
              created_at: new Date().toISOString(),
              task_goal: 'Task A',
              steps: JSON.stringify(['step1', 'step2']),
              reflection_notes: JSON.stringify(createValidReflectionNote()),
              finalScore: 0.9,
              textScore: 0.5,
              vectorScore: 0.4,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        const proceduralItem = resultData.items.find((item: any) => item.type === 'procedural');
        expect(proceduralItem).toBeDefined();
        expect(proceduralItem.reflection_notes).toBeDefined();
        expect(proceduralItem.task_goal).toBe('Task A');
        expect(proceduralItem.steps).toBeDefined();
      });

      it('should not include reflection_notes for non-procedural memory', async () => {
        const params = {
          query: 'Test episodic',
          type: 'episodic',
          include_metadata: true,
          limit: 10
        };

        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'epi_1',
              content: 'Test episodic memory',
              type: 'episodic',
              importance: 0.5,
              created_at: new Date().toISOString(),
              finalScore: 0.8,
              textScore: 0.5,
              vectorScore: 0.3,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        const episodicItem = resultData.items.find((item: any) => item.type === 'episodic');
        expect(episodicItem).toBeDefined();
        expect(episodicItem.reflection_notes).toBeUndefined();
        expect(episodicItem.task_goal).toBeUndefined();
        expect(episodicItem.steps).toBeUndefined();
      });
    });

    describe('reflection_notes JSON 파싱', () => {
      it('should parse reflection_notes from string to object', async () => {
        const reflectionNote = createValidReflectionNote({ 
          timestamp: '2025-01-01T00:00:00Z',
          failure_description: 'Error 1'
        });

        const params = {
          query: 'Test procedure',
          type: 'procedural',
          include_metadata: true,
          limit: 10
        };

        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'proc_1',
              content: 'Test procedure 1',
              type: 'procedural',
              importance: 0.8,
              created_at: new Date().toISOString(),
              task_goal: 'Task A',
              steps: JSON.stringify(['step1', 'step2']),
              reflection_notes: JSON.stringify(reflectionNote),
              finalScore: 0.9,
              textScore: 0.5,
              vectorScore: 0.4,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        const proceduralItem = resultData.items.find((item: any) => item.type === 'procedural');
        expect(proceduralItem).toBeDefined();
        expect(proceduralItem.reflection_notes).toBeDefined();
        expect(typeof proceduralItem.reflection_notes).toBe('object');
        expect(proceduralItem.reflection_notes.failure_type).toBe('tool_error');
        expect(proceduralItem.reflection_notes.failure_description).toBe('Error 1');
      });

      it('should parse reflection_notes from string to array', async () => {
        const reflectionNotes = [
          createValidReflectionNote({ timestamp: '2025-01-01T00:00:00Z', failure_description: 'Error 1' }),
          createValidReflectionNote({ timestamp: '2025-01-02T00:00:00Z', failure_description: 'Error 2' })
        ];

        const params = {
          query: 'Test procedure',
          type: 'procedural',
          include_metadata: true,
          limit: 10
        };

        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'proc_2',
              content: 'Test procedure 2',
              type: 'procedural',
              importance: 0.7,
              created_at: new Date().toISOString(),
              task_goal: 'Task B',
              steps: JSON.stringify(['step1']),
              reflection_notes: JSON.stringify(reflectionNotes),
              finalScore: 0.8,
              textScore: 0.5,
              vectorScore: 0.3,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        const proceduralItem = resultData.items.find((item: any) => item.type === 'procedural');
        expect(proceduralItem).toBeDefined();
        expect(proceduralItem.reflection_notes).toBeDefined();
        expect(Array.isArray(proceduralItem.reflection_notes)).toBe(true);
        expect(proceduralItem.reflection_notes).toHaveLength(2);
        expect(proceduralItem.reflection_notes[0].failure_description).toBe('Error 1');
        expect(proceduralItem.reflection_notes[1].failure_description).toBe('Error 2');
      });

      it('should return original string when JSON parsing fails', async () => {
        const params = {
          query: 'Test procedure',
          type: 'procedural',
          include_metadata: true,
          limit: 10
        };

        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'proc_1',
              content: 'Test procedure 1',
              type: 'procedural',
              importance: 0.8,
              created_at: new Date().toISOString(),
              task_goal: 'Task A',
              steps: JSON.stringify(['step1', 'step2']),
              reflection_notes: '{ invalid json }',
              finalScore: 0.9,
              textScore: 0.5,
              vectorScore: 0.4,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        const proceduralItem = resultData.items.find((item: any) => item.type === 'procedural');
        expect(proceduralItem).toBeDefined();
        expect(proceduralItem.reflection_notes).toBeDefined();
        expect(typeof proceduralItem.reflection_notes).toBe('string');
        expect(proceduralItem.reflection_notes).toBe('{ invalid json }');
      });

      it('should return null when reflection_notes is null', async () => {
        const params = {
          query: 'Test procedure',
          type: 'procedural',
          include_metadata: true,
          limit: 10
        };

        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'proc_3',
              content: 'Test procedure 3',
              type: 'procedural',
              importance: 0.6,
              created_at: new Date().toISOString(),
              task_goal: 'Task C',
              steps: JSON.stringify(['step1']),
              reflection_notes: null,
              finalScore: 0.7,
              textScore: 0.5,
              vectorScore: 0.2,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        const proceduralItem = resultData.items.find((item: any) => item.type === 'procedural');
        expect(proceduralItem).toBeDefined();
        expect(proceduralItem.reflection_notes).toBeNull();
      });
    });

    describe('has_reflection_notes 필터링', () => {
      it('should filter memories with reflection_notes when has_reflection_notes is true', async () => {
        const params = {
          query: 'Test procedure',
          type: 'procedural',
          has_reflection_notes: true,
          include_metadata: true,
          limit: 10
        };

        // has_reflection_notes 필터가 적용되어야 함
        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'proc_1',
              content: 'Test procedure 1',
              type: 'procedural',
              importance: 0.8,
              created_at: new Date().toISOString(),
              task_goal: 'Task A',
              steps: JSON.stringify(['step1', 'step2']),
              reflection_notes: JSON.stringify(createValidReflectionNote()),
              finalScore: 0.9,
              textScore: 0.5,
              vectorScore: 0.4,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // has_reflection_notes 필터가 search 호출에 전달되었는지 확인
        expect(hybridSearchEngine.search).toHaveBeenCalled();
        const searchCall = (hybridSearchEngine.search as any).mock.calls[0];
        const searchQuery = searchCall[1];
        expect(searchQuery.filters?.has_reflection_notes).toBe(true);
      });

      it('should filter memories without reflection_notes when has_reflection_notes is false', async () => {
        const params = {
          query: 'Test procedure',
          type: 'procedural',
          has_reflection_notes: false,
          include_metadata: true,
          limit: 10
        };

        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'proc_3',
              content: 'Test procedure 3',
              type: 'procedural',
              importance: 0.6,
              created_at: new Date().toISOString(),
              task_goal: 'Task C',
              steps: JSON.stringify(['step1']),
              reflection_notes: null,
              finalScore: 0.7,
              textScore: 0.5,
              vectorScore: 0.2,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // has_reflection_notes 필터가 search 호출에 전달되었는지 확인
        expect(hybridSearchEngine.search).toHaveBeenCalled();
        const searchCall = (hybridSearchEngine.search as any).mock.calls[0];
        const searchQuery = searchCall[1];
        expect(searchQuery.filters?.has_reflection_notes).toBe(false);
      });
    });

    describe('Procedural Memory Enhancement (v7.0)', () => {
      beforeEach(() => {
        // Mock hybridSearchEngine 메서드들
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [],
          total_count: 0,
          query_time: 10
        });
        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
      });

      describe('workflow_name/skill_name 필터링', () => {
        it('should filter by workflow_name', async () => {
          // Given: workflow_name이 있는 procedural memory 생성
          DatabaseUtils.run(db, `
            INSERT INTO memory_item (id, type, content, workflow_name, skill_name) VALUES ('mem1', 'procedural', 'Test procedure', '데이터 마이그레이션', '스키마 백업')
          `);

          const params = {
            query: 'test',
            type: 'procedural',
            workflow_name: '데이터 마이그레이션'
          };

          // Mock 검색 결과
          vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
            items: [
              {
                id: 'mem1',
                content: 'Test procedure',
                type: 'procedural',
                workflow_name: '데이터 마이그레이션',
                skill_name: '스키마 백업',
                importance: 0.5,
                created_at: new Date(),
                finalScore: 0.8
              }
            ],
            total_count: 1,
            query_time: 10
          });

          // When: recall Tool 실행
          const result = await tool.handle(params, context);
          const resultData = JSON.parse(result.content[0].text);

          // Then: workflow_name 필터가 전달되어야 함
          expect(hybridSearchEngine.search).toHaveBeenCalled();
          const searchCall = vi.mocked(hybridSearchEngine.search).mock.calls[0];
          const searchQuery = searchCall[1];
          expect(searchQuery.filters?.workflow_name).toBe('데이터 마이그레이션');
        });

        it('should filter by skill_name', async () => {
          // Given: skill_name이 있는 procedural memory 생성
          DatabaseUtils.run(db, `
            INSERT INTO memory_item (id, type, content, workflow_name, skill_name) VALUES ('mem1', 'procedural', 'Test procedure', '데이터 마이그레이션', '스키마 백업')
          `);

          const params = {
            query: 'test',
            type: 'procedural',
            skill_name: '스키마 백업'
          };

          // Mock 검색 결과
          vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
            items: [
              {
                id: 'mem1',
                content: 'Test procedure',
                type: 'procedural',
                workflow_name: '데이터 마이그레이션',
                skill_name: '스키마 백업',
                importance: 0.5,
                created_at: new Date(),
                finalScore: 0.8
              }
            ],
            total_count: 1,
            query_time: 10
          });

          // When: recall Tool 실행
          const result = await tool.handle(params, context);
          const resultData = JSON.parse(result.content[0].text);

          // Then: skill_name 필터가 전달되어야 함
          expect(hybridSearchEngine.search).toHaveBeenCalled();
          const searchCall = vi.mocked(hybridSearchEngine.search).mock.calls[0];
          const searchQuery = searchCall[1];
          expect(searchQuery.filters?.skill_name).toBe('스키마 백업');
        });
      });

      describe('trigger_conditions 매칭', () => {
        it('should filter by trigger_conditions when match_trigger_conditions is true', async () => {
          // Given: trigger_conditions가 있는 procedural memory 생성
          DatabaseUtils.run(db, `
            INSERT INTO memory_item (id, type, content, workflow_name, skill_name, trigger_conditions) VALUES ('mem1', 'procedural', 'Test procedure', '데이터 마이그레이션', '스키마 백업', '{"event": "migration_start"}')
          `);

          const params = {
            query: 'migration_start', // trigger_conditions의 값과 매칭되도록 수정
            type: 'procedural',
            match_trigger_conditions: true
          };

          // Mock 검색 결과 (trigger_conditions가 있는 항목과 없는 항목)
          vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
            items: [
              {
                id: 'mem1',
                content: 'Test procedure',
                type: 'procedural',
                workflow_name: '데이터 마이그레이션',
                skill_name: '스키마 백업',
                trigger_conditions: '{"event": "migration_start"}',
                importance: 0.5,
                created_at: new Date(),
                finalScore: 0.8
              },
              {
                id: 'mem2',
                content: 'Another procedure',
                type: 'procedural',
                workflow_name: 'API 배포',
                skill_name: '배포 검증',
                trigger_conditions: null,
                importance: 0.5,
                created_at: new Date(),
                finalScore: 0.7
              }
            ],
            total_count: 2,
            query_time: 10
          });

          // When: recall Tool 실행
          const result = await tool.handle(params, context);
          const resultData = JSON.parse(result.content[0].text);

          // Then: trigger_conditions가 있는 항목만 반환되어야 함
          expect(resultData.items).toHaveLength(1);
          expect(resultData.items[0].memory_id).toBe('mem1');
          expect(resultData.items[0].trigger_conditions).toBeDefined();
        });

        it('should require all keys in trigger_conditions to match (not just first key)', async () => {
          // Given: 여러 키를 가진 trigger_conditions가 있는 procedural memory
          DatabaseUtils.run(db, `
            INSERT INTO memory_item (id, type, content, workflow_name, skill_name, trigger_conditions) VALUES ('mem_all_match', 'procedural', 'All match procedure', '데이터 마이그레이션', '스키마 백업', '{"tool_name": "remember", "error_type": "tool_error"}'),
              ('mem_partial_match', 'procedural', 'Partial match procedure', 'API 배포', '배포 검증', '{"tool_name": "remember", "error_type": "validation_error"}')
          `);

          // Mock 검색 결과
          vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
            items: [
              {
                id: 'mem_all_match',
                content: 'All match procedure',
                type: 'procedural',
                workflow_name: '데이터 마이그레이션',
                skill_name: '스키마 백업',
                trigger_conditions: '{"tool_name": "remember", "error_type": "tool_error"}',
                importance: 0.5,
                created_at: new Date(),
                finalScore: 0.8
              },
              {
                id: 'mem_partial_match',
                content: 'Partial match procedure',
                type: 'procedural',
                workflow_name: 'API 배포',
                skill_name: '배포 검증',
                trigger_conditions: '{"tool_name": "remember", "error_type": "validation_error"}',
                importance: 0.5,
                created_at: new Date(),
                finalScore: 0.7
              }
            ],
            total_count: 2,
            query_time: 10
          });

          // When: 모든 키가 매칭되는 컨텍스트로 검색
          const params = {
            query: 'remember tool error',
            type: 'procedural',
            match_trigger_conditions: true,
            trigger_context: {
              tool_name: 'remember',
              error_type: 'tool_error'
            }
          };

          const result = await tool.handle(params, context);
          const resultData = JSON.parse(result.content[0].text);

          // Then: 모든 키가 매칭되는 항목만 반환되어야 함 (첫 번째 키만 맞는 항목은 제외)
          expect(resultData.items).toHaveLength(1);
          expect(resultData.items[0].memory_id).toBe('mem_all_match');
          expect(resultData.items[0].memory_id).not.toBe('mem_partial_match');
        });

        it('should reject when trigger_conditions key is missing in context', async () => {
          // Given: 여러 키를 가진 trigger_conditions가 있는 procedural memory
          DatabaseUtils.run(db, `
            INSERT INTO memory_item (id, type, content, workflow_name, skill_name, trigger_conditions) VALUES ('mem_missing_key', 'procedural', 'Missing key procedure', '데이터 마이그레이션', '스키마 백업', '{"tool_name": "remember", "error_type": "tool_error"}')
          `);

          // Mock 검색 결과
          vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
            items: [
              {
                id: 'mem_missing_key',
                content: 'Missing key procedure',
                type: 'procedural',
                workflow_name: '데이터 마이그레이션',
                skill_name: '스키마 백업',
                trigger_conditions: '{"tool_name": "remember", "error_type": "tool_error"}',
                importance: 0.5,
                created_at: new Date(),
                finalScore: 0.8
              }
            ],
            total_count: 1,
            query_time: 10
          });

          // When: 일부 키만 있는 컨텍스트로 검색 (error_type 누락)
          const params = {
            query: 'remember',
            type: 'procedural',
            match_trigger_conditions: true,
            trigger_context: {
              tool_name: 'remember'
              // error_type 누락
            }
          };

          const result = await tool.handle(params, context);
          const resultData = JSON.parse(result.content[0].text);

          // Then: 매칭되지 않아야 함 (모든 키가 필요하므로)
          expect(resultData.items).toHaveLength(0);
        });
      });

      describe('return_format 처리', () => {
        it('should return only steps when return_format is steps_only', async () => {
          // Given: procedural memory 생성
          DatabaseUtils.run(db, `
            INSERT INTO memory_item (id, type, content, workflow_name, skill_name, steps) VALUES ('mem1', 'procedural', 'Test procedure', '데이터 마이그레이션', '스키마 백업', '["step1", "step2", "step3"]')
          `);

          const params = {
            query: 'test',
            type: 'procedural',
            return_format: 'steps_only'
          };

          // Mock 검색 결과
          vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
            items: [
              {
                id: 'mem1',
                content: 'Test procedure',
                type: 'procedural',
                workflow_name: '데이터 마이그레이션',
                skill_name: '스키마 백업',
                steps: '["step1", "step2", "step3"]',
                task_goal: 'Test task',
                reflection_notes: null,
                importance: 0.5,
                created_at: new Date(),
                finalScore: 0.8
              }
            ],
            total_count: 1,
            query_time: 10
          });

          // When: recall Tool 실행
          const result = await tool.handle(params, context);
          const resultData = JSON.parse(result.content[0].text);

          // Then: steps_only일 때 steps만 반환되어야 함
          expect(resultData.items).toHaveLength(1);
          expect(resultData.items[0]).toEqual({
            memory_id: 'mem1',
            id: 'mem1',
            steps: '["step1", "step2", "step3"]'
          });
          expect(resultData.items[0].content).toBeUndefined();
          expect(resultData.items[0].task_goal).toBeUndefined();
        });

        it('should return all fields when return_format is full', async () => {
          // Given: procedural memory 생성
          DatabaseUtils.run(db, `
            INSERT INTO memory_item (id, type, content, workflow_name, skill_name, steps, task_goal) VALUES ('mem1', 'procedural', 'Test procedure', '데이터 마이그레이션', '스키마 백업', '["step1", "step2"]', 'Test task')
          `);

          const params = {
            query: 'test',
            type: 'procedural',
            return_format: 'full'
          };

          // Mock 검색 결과
          vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
            items: [
              {
                id: 'mem1',
                content: 'Test procedure',
                type: 'procedural',
                workflow_name: '데이터 마이그레이션',
                skill_name: '스키마 백업',
                steps: '["step1", "step2"]',
                task_goal: 'Test task',
                importance: 0.5,
                created_at: new Date(),
                finalScore: 0.8
              }
            ],
            total_count: 1,
            query_time: 10
          });

          // When: recall Tool 실행
          const result = await tool.handle(params, context);
          const resultData = JSON.parse(result.content[0].text);

          // Then: 모든 필드가 반환되어야 함
          expect(resultData.items).toHaveLength(1);
          expect(resultData.items[0].memory_id).toBe('mem1');
          expect(resultData.items[0].content).toBe('Test procedure');
          expect(resultData.items[0].steps).toBe('["step1", "step2"]');
          expect(resultData.items[0].task_goal).toBe('Test task');
          expect(resultData.items[0].workflow_name).toBe('데이터 마이그레이션');
          expect(resultData.items[0].skill_name).toBe('스키마 백업');
        });
      });
    });
  });

  describe('자동 앵커 설정 및 이웃 기억 포함 파라미터 검증', () => {
    describe('RecallSchema 파라미터 검증', () => {
      it('given: 새 파라미터들 없음, when: 스키마 파싱, then: 기본값 확인', async () => {
        // Given: 새 파라미터들 없이 recall 호출
        const params = {
          query: 'test',
          limit: 10
        };

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [],
          total_count: 0,
          query_time: 10
        });

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 기본값이 적용되어야 함 (기본값은 내부적으로 처리되므로 에러가 발생하지 않으면 성공)
        expect(resultData).toBeDefined();
        expect(resultData.items).toBeDefined();
      });

      it('given: auto_set_anchor=true, when: 스키마 파싱, then: 파라미터가 정상적으로 파싱되어야 함', async () => {
        // Given: auto_set_anchor=true로 설정
        const params = {
          query: 'test',
          limit: 10,
          auto_set_anchor: true
        };

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [],
          total_count: 0,
          query_time: 10
        });

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 에러가 발생하지 않아야 함
        expect(resultData).toBeDefined();
      });

      it('given: include_neighbors=true, when: 스키마 파싱, then: 파라미터가 정상적으로 파싱되어야 함', async () => {
        // Given: include_neighbors=true로 설정
        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true
        };

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [],
          total_count: 0,
          query_time: 10
        });

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 에러가 발생하지 않아야 함
        expect(resultData).toBeDefined();
      });

      it('given: neighbors_limit 범위 밖 값(0), when: 스키마 파싱, then: 검증 에러 발생', async () => {
        // Given: neighbors_limit=0 (최소값 1 미만)
        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_limit: 0
        };

        // When/Then: recall Tool 실행 시 검증 에러 발생해야 함
        await expect(tool.handle(params, context)).rejects.toThrow();
      });

      it('given: neighbors_limit 범위 밖 값(11), when: 스키마 파싱, then: 검증 에러 발생', async () => {
        // Given: neighbors_limit=11 (최대값 10 초과)
        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_limit: 11
        };

        // When/Then: recall Tool 실행 시 검증 에러 발생해야 함
        await expect(tool.handle(params, context)).rejects.toThrow();
      });

      it('given: neighbors_per_item 범위 밖 값(0), when: 스키마 파싱, then: 검증 에러 발생', async () => {
        // Given: neighbors_per_item=0 (최소값 1 미만)
        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_per_item: 0
        };

        // When/Then: recall Tool 실행 시 검증 에러 발생해야 함
        await expect(tool.handle(params, context)).rejects.toThrow();
      });

      it('given: neighbors_per_item 범위 밖 값(51), when: 스키마 파싱, then: 검증 에러 발생', async () => {
        // Given: neighbors_per_item=51 (최대값 50 초과)
        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_per_item: 51
        };

        // When/Then: recall Tool 실행 시 검증 에러 발생해야 함
        await expect(tool.handle(params, context)).rejects.toThrow();
      });

      it('given: neighbors_similarity_threshold 범위 밖 값(-0.1), when: 스키마 파싱, then: 검증 에러 발생', async () => {
        // Given: neighbors_similarity_threshold=-0.1 (최소값 0 미만)
        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_similarity_threshold: -0.1
        };

        // When/Then: recall Tool 실행 시 검증 에러 발생해야 함
        await expect(tool.handle(params, context)).rejects.toThrow();
      });

      it('given: neighbors_similarity_threshold 범위 밖 값(1.1), when: 스키마 파싱, then: 검증 에러 발생', async () => {
        // Given: neighbors_similarity_threshold=1.1 (최대값 1 초과)
        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_similarity_threshold: 1.1
        };

        // When/Then: recall Tool 실행 시 검증 에러 발생해야 함
        await expect(tool.handle(params, context)).rejects.toThrow();
      });

      it('given: 유효한 범위 내 값들, when: 스키마 파싱, then: 정상적으로 파싱되어야 함', async () => {
        // Given: 모든 새 파라미터를 유효한 범위 내 값으로 설정
        const params = {
          query: 'test',
          limit: 10,
          auto_set_anchor: true,
          include_neighbors: true,
          neighbors_limit: 5,
          neighbors_per_item: 10,
          neighbors_similarity_threshold: 0.75
        };

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [],
          total_count: 0,
          query_time: 10
        });

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 에러가 발생하지 않아야 함
        expect(resultData).toBeDefined();
      });
    });
  });

  describe('자동 앵커 설정', () => {
    describe('자동 앵커 설정 성공 시나리오', () => {
      it('given: 검색 결과 있음, when: auto_set_anchor=true, then: 슬롯 A에 앵커 설정됨', async () => {
        // Given: 검색 결과가 있는 상황
        const memoryId = 'mem_test_001';
        const agentId = 'default';
        
        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Test memory content', 0.8, CURRENT_TIMESTAMP)
        `).run(memoryId);

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: memoryId,
              content: 'Test memory content',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const params = {
          query: 'test',
          limit: 10,
          auto_set_anchor: true,
          agent_id: agentId
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 슬롯 A에 앵커가 설정되어야 함
        const anchor = db.prepare(`
          SELECT memory_id, slot FROM anchor WHERE agent_id = ? AND slot = 'A'
        `).get(agentId) as { memory_id: string; slot: string } | undefined;

        expect(anchor).toBeDefined();
        expect(anchor?.memory_id).toBe(memoryId);
        expect(anchor?.slot).toBe('A');

        // Then: metadata에 anchor_set이 포함되어야 함
        expect(resultData.metadata).toBeDefined();
        expect(resultData.metadata.anchor_set).toBeDefined();
        expect(resultData.metadata.anchor_set.memory_id).toBe(memoryId);
        expect(resultData.metadata.anchor_set.slot).toBe('A');
        expect(resultData.metadata.anchor_set.agent_id).toBe(agentId);
        expect(resultData.metadata.anchor_set_error).toBeUndefined();
        expect(resultData.metadata.anchor_set_skipped).toBeUndefined();
      });
    });

    describe('슬롯 회전 로직', () => {
      it('given: 슬롯 A/B/C에 앵커 있음, when: auto_set_anchor=true, then: A→B→C→제거 순서로 이동', async () => {
        // Given: 슬롯 A/B/C에 앵커가 있는 상황
        const agentId = 'default';
        const memoryIdA = 'mem_slot_a';
        const memoryIdB = 'mem_slot_b';
        const memoryIdC = 'mem_slot_c';
        const newMemoryId = 'mem_new';
        
        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Memory A', 0.8, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Memory B', 0.7, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Memory C', 0.6, CURRENT_TIMESTAMP),
            (?, 'episodic', 'New Memory', 0.9, CURRENT_TIMESTAMP)
        `).run(memoryIdA, memoryIdB, memoryIdC, newMemoryId);

        // 슬롯 A, B, C에 앵커 설정
        await anchorManager.setAnchor(agentId, memoryIdA, 'A');
        await anchorManager.setAnchor(agentId, memoryIdB, 'B');
        await anchorManager.setAnchor(agentId, memoryIdC, 'C');

        // Mock 검색 결과 (새로운 메모리가 첫 번째 결과)
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: newMemoryId,
              content: 'New Memory',
              type: 'episodic',
              importance: 0.9,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const params = {
          query: 'test',
          limit: 10,
          auto_set_anchor: true,
          agent_id: agentId
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: A→B→C→제거 순서로 이동
        // 슬롯 A에 새로운 앵커가 설정되어야 함
        const slotA = db.prepare(`
          SELECT memory_id FROM anchor WHERE agent_id = ? AND slot = 'A'
        `).get(agentId) as { memory_id: string } | undefined;
        expect(slotA?.memory_id).toBe(newMemoryId);

        // 슬롯 B에 기존 A의 앵커가 이동해야 함
        const slotB = db.prepare(`
          SELECT memory_id FROM anchor WHERE agent_id = ? AND slot = 'B'
        `).get(agentId) as { memory_id: string } | undefined;
        expect(slotB?.memory_id).toBe(memoryIdA);

        // 슬롯 C에 기존 B의 앵커가 이동해야 함
        const slotC = db.prepare(`
          SELECT memory_id FROM anchor WHERE agent_id = ? AND slot = 'C'
        `).get(agentId) as { memory_id: string } | undefined;
        expect(slotC?.memory_id).toBe(memoryIdB);

        // 기존 C의 앵커는 제거되어야 함 (더 이상 존재하지 않음)
        const oldSlotC = db.prepare(`
          SELECT memory_id FROM anchor WHERE agent_id = ? AND memory_id = ?
        `).get(agentId, memoryIdC);
        expect(oldSlotC).toBeUndefined();

        // Then: metadata에 anchor_set이 포함되어야 함
        expect(resultData.metadata).toBeDefined();
        expect(resultData.metadata.anchor_set).toBeDefined();
        expect(resultData.metadata.anchor_set.memory_id).toBe(newMemoryId);
        expect(resultData.metadata.anchor_set.slot).toBe('A');
      });
    });

    describe('슬롯 A의 pinned 앵커 보호 정책', () => {
      it('given: 슬롯 A에 pinned 앵커 있음, when: auto_set_anchor=true, then: 앵커 설정 건너뜀', async () => {
        // Given: 슬롯 A에 pinned 앵커가 있는 상황
        const agentId = 'default';
        const pinnedMemoryId = 'mem_pinned';
        const newMemoryId = 'mem_new';
        
        // pinned 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, pinned, created_at) VALUES (?, 'episodic', 'Pinned Memory', 0.9, 1, CURRENT_TIMESTAMP),
            (?, 'episodic', 'New Memory', 0.8, 0, CURRENT_TIMESTAMP)
        `).run(pinnedMemoryId, newMemoryId);

        // 슬롯 A에 pinned 앵커 설정
        await anchorManager.setAnchor(agentId, pinnedMemoryId, 'A');

        // Mock 검색 결과 (새로운 메모리가 첫 번째 결과)
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: newMemoryId,
              content: 'New Memory',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const params = {
          query: 'test',
          limit: 10,
          auto_set_anchor: true,
          agent_id: agentId
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 슬롯 A의 앵커가 변경되지 않아야 함 (pinned 앵커 보호)
        const slotA = db.prepare(`
          SELECT memory_id FROM anchor WHERE agent_id = ? AND slot = 'A'
        `).get(agentId) as { memory_id: string } | undefined;
        expect(slotA?.memory_id).toBe(pinnedMemoryId);

        // Then: metadata에 anchor_set_skipped가 포함되어야 함
        expect(resultData.metadata).toBeDefined();
        expect(resultData.metadata.anchor_set).toBeNull();
        expect(resultData.metadata.anchor_set_skipped).toBe(true);
        expect(resultData.metadata.anchor_set_skipped_reason).toBe('pinned_anchor_protected');
        expect(resultData.metadata.anchor_set_error).toBeUndefined();
      });
    });

    describe('슬롯 B/C의 pinned 앵커 덮어쓰기', () => {
      it('given: 슬롯 B에 pinned 앵커 있음, when: auto_set_anchor=true, then: 경고 로그 및 덮어쓰기', async () => {
        // Given: 슬롯 B에 pinned 앵커가 있는 상황
        const agentId = 'default';
        const memoryIdA = 'mem_slot_a';
        const pinnedMemoryIdB = 'mem_pinned_b';
        const newMemoryId = 'mem_new';
        
        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, pinned, created_at) VALUES (?, 'episodic', 'Memory A', 0.8, 0, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Pinned Memory B', 0.9, 1, CURRENT_TIMESTAMP),
            (?, 'episodic', 'New Memory', 0.85, 0, CURRENT_TIMESTAMP)
        `).run(memoryIdA, pinnedMemoryIdB, newMemoryId);

        // 슬롯 A와 B에 앵커 설정 (B는 pinned)
        await anchorManager.setAnchor(agentId, memoryIdA, 'A');
        await anchorManager.setAnchor(agentId, pinnedMemoryIdB, 'B');

        // Mock 검색 결과 (새로운 메모리가 첫 번째 결과)
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: newMemoryId,
              content: 'New Memory',
              type: 'episodic',
              importance: 0.85,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            }
          ],
          total_count: 1,
          query_time: 10
        });

        // logWarning spy 설정
        const logWarningSpy = vi.spyOn(tool as any, 'logWarning');

        const params = {
          query: 'test',
          limit: 10,
          auto_set_anchor: true,
          agent_id: agentId
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 슬롯 B의 pinned 앵커가 덮어써졌는지 확인
        const slotB = db.prepare(`
          SELECT memory_id FROM anchor WHERE agent_id = ? AND slot = 'B'
        `).get(agentId) as { memory_id: string } | undefined;
        expect(slotB?.memory_id).toBe(memoryIdA); // 기존 A의 앵커가 B로 이동

        // Then: 경고 로그가 기록되었는지 확인
        expect(logWarningSpy).toHaveBeenCalledWith(
          '슬롯 B의 pinned 앵커가 덮어써집니다',
          expect.objectContaining({
            agent_id: agentId,
            old_memory_id: pinnedMemoryIdB,
            new_memory_id: memoryIdA
          })
        );

        // Then: 슬롯 A에 새로운 앵커가 설정되어야 함
        const slotA = db.prepare(`
          SELECT memory_id FROM anchor WHERE agent_id = ? AND slot = 'A'
        `).get(agentId) as { memory_id: string } | undefined;
        expect(slotA?.memory_id).toBe(newMemoryId);

        // Then: metadata에 anchor_set이 포함되어야 함
        expect(resultData.metadata).toBeDefined();
        expect(resultData.metadata.anchor_set).toBeDefined();
        expect(resultData.metadata.anchor_set.memory_id).toBe(newMemoryId);
      });

      it('given: 슬롯 C에 pinned 앵커 있음, when: auto_set_anchor=true, then: 경고 로그 및 제거', async () => {
        // Given: 슬롯 C에 pinned 앵커가 있는 상황
        const agentId = 'default';
        const memoryIdA = 'mem_slot_a';
        const memoryIdB = 'mem_slot_b';
        const pinnedMemoryIdC = 'mem_pinned_c';
        const newMemoryId = 'mem_new';
        
        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, pinned, created_at) VALUES (?, 'episodic', 'Memory A', 0.8, 0, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Memory B', 0.7, 0, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Pinned Memory C', 0.9, 1, CURRENT_TIMESTAMP),
            (?, 'episodic', 'New Memory', 0.85, 0, CURRENT_TIMESTAMP)
        `).run(memoryIdA, memoryIdB, pinnedMemoryIdC, newMemoryId);

        // 슬롯 A, B, C에 앵커 설정 (C는 pinned)
        await anchorManager.setAnchor(agentId, memoryIdA, 'A');
        await anchorManager.setAnchor(agentId, memoryIdB, 'B');
        await anchorManager.setAnchor(agentId, pinnedMemoryIdC, 'C');

        // Mock 검색 결과 (새로운 메모리가 첫 번째 결과)
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: newMemoryId,
              content: 'New Memory',
              type: 'episodic',
              importance: 0.85,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            }
          ],
          total_count: 1,
          query_time: 10
        });

        // logWarning spy 설정
        const logWarningSpy = vi.spyOn(tool as any, 'logWarning');

        const params = {
          query: 'test',
          limit: 10,
          auto_set_anchor: true,
          agent_id: agentId
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 슬롯 C의 pinned 앵커가 제거되고 B의 앵커가 C로 이동했는지 확인
        // PRD: 슬롯 B/C의 pinned 앵커도 덮어쓰고 A→B→C→제거 순으로 회전
        const slotC = db.prepare(`
          SELECT memory_id FROM anchor WHERE agent_id = ? AND slot = 'C'
        `).get(agentId) as { memory_id: string } | undefined;
        expect(slotC?.memory_id).toBe(memoryIdB); // 슬롯 B의 앵커가 C로 이동

        // Then: 경고 로그가 기록되었는지 확인
        expect(logWarningSpy).toHaveBeenCalledWith(
          '슬롯 C의 pinned 앵커가 제거됩니다',
          expect.objectContaining({
            agent_id: agentId,
            old_memory_id: pinnedMemoryIdC
          })
        );

        // Then: 슬롯 A에 새로운 앵커가 설정되어야 함
        const slotA = db.prepare(`
          SELECT memory_id FROM anchor WHERE agent_id = ? AND slot = 'A'
        `).get(agentId) as { memory_id: string } | undefined;
        expect(slotA?.memory_id).toBe(newMemoryId);

        // Then: 슬롯 B에 기존 A의 앵커가 이동해야 함
        const slotB = db.prepare(`
          SELECT memory_id FROM anchor WHERE agent_id = ? AND slot = 'B'
        `).get(agentId) as { memory_id: string } | undefined;
        expect(slotB?.memory_id).toBe(memoryIdA);

        // Then: metadata에 anchor_set이 포함되어야 함
        expect(resultData.metadata).toBeDefined();
        expect(resultData.metadata.anchor_set).toBeDefined();
        expect(resultData.metadata.anchor_set.memory_id).toBe(newMemoryId);
      });
    });

    describe('앵커 설정 실패 시 에러 처리', () => {
      it('given: 앵커 설정 실패, when: auto_set_anchor=true, then: 검색 결과는 정상 반환, metadata에 anchor_set_error 포함', async () => {
        // Given: 앵커 설정이 실패하는 상황
        const agentId = 'default';
        const memoryId = 'mem_test_001';
        
        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Test memory content', 0.8, CURRENT_TIMESTAMP)
        `).run(memoryId);

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: memoryId,
              content: 'Test memory content',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            }
          ],
          total_count: 1,
          query_time: 10
        });

        // AnchorManager.setAnchor를 mock하여 에러 발생시키기
        const setAnchorError = new Error('앵커 설정 실패');
        vi.spyOn(anchorManager, 'setAnchor').mockRejectedValue(setAnchorError);

        // logError spy 설정
        const logErrorSpy = vi.spyOn(tool as any, 'logError');

        const params = {
          query: 'test',
          limit: 10,
          auto_set_anchor: true,
          agent_id: agentId
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 검색 결과는 정상 반환되어야 함
        expect(resultData.items).toBeDefined();
        expect(resultData.items.length).toBe(1);
        expect(resultData.items[0].id).toBe(memoryId);

        // Then: metadata에 anchor_set_error가 포함되어야 함
        expect(resultData.metadata).toBeDefined();
        expect(resultData.metadata.anchor_set).toBeNull();
        expect(resultData.metadata.anchor_set_error).toBe(true);
        expect(resultData.metadata.anchor_set_skipped).toBeUndefined();

        // Then: 에러 로그가 기록되었는지 확인
        expect(logErrorSpy).toHaveBeenCalledWith(
          setAnchorError,
          '앵커 자동 설정 실패',
          expect.objectContaining({
            agent_id: agentId,
            memory_id: memoryId
          })
        );
      });
    });
  });

  describe('자동 이웃 기억 포함', () => {
    describe('자동 이웃 기억 포함 성공 시나리오', () => {
      it('given: 검색 결과 있음, when: include_neighbors=true, then: 상위 결과에 neighbors 필드 포함', async () => {
        // Given: 검색 결과가 있는 상황
        const memoryId1 = 'mem_test_001';
        const memoryId2 = 'mem_test_002';
        const neighborId1 = 'mem_neighbor_001';
        const neighborId2 = 'mem_neighbor_002';
        
        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Test memory 1', 0.8, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 2', 0.7, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Neighbor memory 1', 0.6, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Neighbor memory 2', 0.5, CURRENT_TIMESTAMP)
        `).run(memoryId1, memoryId2, neighborId1, neighborId2);

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: memoryId1,
              content: 'Test memory 1',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            },
            {
              id: memoryId2,
              content: 'Test memory 2',
              type: 'episodic',
              importance: 0.7,
              created_at: new Date().toISOString(),
              finalScore: 0.85
            }
          ],
          total_count: 2,
          query_time: 10
        });

        // Note: recall-tool.ts 내부에서 MemoryNeighborService를 생성하므로 직접 mock하기 어렵습니다.
        // 이 테스트는 neighbors 필드가 포함되는지 확인하는 것을 목표로 합니다.
        // 실제 이웃 기억 조회는 memory_embedding 테이블에 임베딩이 있어야 하므로,
        // 이 테스트에서는 neighbors 필드의 존재 여부만 확인합니다.
        
        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_limit: 2,
          neighbors_per_item: 5,
          neighbors_similarity_threshold: 0.8
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 검색 결과는 정상 반환되어야 함
        expect(resultData.items).toBeDefined();
        expect(resultData.items.length).toBe(2);

        // Then: 상위 결과에 neighbors 필드가 포함되어야 함
        // (실제로는 이웃 기억 조회가 실패할 수 있지만, 필드 자체는 존재해야 함)
        // neighbors_limit=2이므로 상위 2개 결과에 neighbors 필드가 있어야 함
        expect(resultData.items[0].neighbors).toBeDefined();
        expect(resultData.items[1].neighbors).toBeDefined();
        // neighbors는 배열이어야 함 (빈 배열일 수도 있음)
        expect(Array.isArray(resultData.items[0].neighbors)).toBe(true);
        expect(Array.isArray(resultData.items[1].neighbors)).toBe(true);
      });
    });

    describe('이웃 기억 조회 병렬 처리', () => {
      it('given: 여러 검색 결과, when: include_neighbors=true, then: 모든 이웃 기억이 병렬로 조회됨', async () => {
        // Given: 여러 검색 결과가 있는 상황
        const memoryId1 = 'mem_test_001';
        const memoryId2 = 'mem_test_002';
        const memoryId3 = 'mem_test_003';
        
        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Test memory 1', 0.8, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 2', 0.7, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 3', 0.6, CURRENT_TIMESTAMP)
        `).run(memoryId1, memoryId2, memoryId3);

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: memoryId1,
              content: 'Test memory 1',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            },
            {
              id: memoryId2,
              content: 'Test memory 2',
              type: 'episodic',
              importance: 0.7,
              created_at: new Date().toISOString(),
              finalScore: 0.85
            },
            {
              id: memoryId3,
              content: 'Test memory 3',
              type: 'episodic',
              importance: 0.6,
              created_at: new Date().toISOString(),
              finalScore: 0.75
            }
          ],
          total_count: 3,
          query_time: 10
        });

        // 이웃 기억 조회 호출 추적을 위한 변수
        const callTimestamps: number[] = [];
        const callOrder: string[] = [];

        // MemoryNeighborService 모듈 mock 설정
        const originalModule = await import('../../services/memory-neighbor-service.js');
        const mockGetNeighbors = vi.fn().mockImplementation(async (memoryId: string) => {
          const timestamp = Date.now();
          callTimestamps.push(timestamp);
          callOrder.push(memoryId);
          
          // 각 호출에 약간의 지연 추가 (병렬 처리 확인용)
          await new Promise(resolve => setTimeout(resolve, 50));
          
          return {
            memory_id: memoryId,
            neighbors: [],
            total_count: 0,
            query_time: 5
          };
        });

        vi.spyOn(originalModule, 'MemoryNeighborService').mockImplementation(() => ({
          setDatabase: vi.fn(),
          getNeighbors: mockGetNeighbors
        } as any));

        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_limit: 3,
          neighbors_per_item: 5,
          neighbors_similarity_threshold: 0.8
        };

        // When: recall Tool 실행
        const startTime = Date.now();
        const result = await tool.handle(params, context);
        const endTime = Date.now();
        const resultData = JSON.parse(result.content[0].text);

        // Then: 모든 이웃 기억이 병렬로 조회되었는지 확인
        // 병렬 처리 시 모든 호출이 거의 동시에 시작되어야 함
        expect(mockGetNeighbors).toHaveBeenCalledTimes(3);
        
        // 호출 시간 차이가 작아야 함 (병렬 처리)
        if (callTimestamps.length >= 2) {
          const timeDiff = Math.max(...callTimestamps) - Math.min(...callTimestamps);
          // 병렬 처리 시 시간 차이는 100ms 이하여야 함 (각 호출 지연 50ms + 오버헤드)
          expect(timeDiff).toBeLessThan(200);
        }

        // Then: 모든 검색 결과에 neighbors 필드가 포함되어야 함
        expect(resultData.items).toBeDefined();
        expect(resultData.items.length).toBe(3);
        expect(resultData.items[0].neighbors).toBeDefined();
        expect(resultData.items[1].neighbors).toBeDefined();
        expect(resultData.items[2].neighbors).toBeDefined();

        // 전체 처리 시간이 순차 처리보다 짧아야 함 (병렬 처리)
        // 순차 처리 시: 3 * 50ms = 150ms 이상
        // 병렬 처리 시: 약 50ms + 오버헤드
        const totalTime = endTime - startTime;
        expect(totalTime).toBeLessThan(300); // 병렬 처리 시 300ms 이하여야 함
      });
    });

    describe('이웃 기억 조회 개별 타임아웃', () => {
      it('given: 느린 이웃 기억 조회, when: include_neighbors=true, then: 개별 조회 타임아웃 내에 응답 반환, 타임아웃된 항목은 빈 배열', async () => {
        // Given: 느린 이웃 기억 조회가 있는 상황
        const memoryId1 = 'mem_test_001';
        const memoryId2 = 'mem_test_002';
        const memoryId3 = 'mem_test_003';
        
        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Test memory 1', 0.8, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 2', 0.7, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 3', 0.6, CURRENT_TIMESTAMP)
        `).run(memoryId1, memoryId2, memoryId3);

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: memoryId1,
              content: 'Test memory 1',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            },
            {
              id: memoryId2,
              content: 'Test memory 2',
              type: 'episodic',
              importance: 0.7,
              created_at: new Date().toISOString(),
              finalScore: 0.85
            },
            {
              id: memoryId3,
              content: 'Test memory 3',
              type: 'episodic',
              importance: 0.6,
              created_at: new Date().toISOString(),
              finalScore: 0.75
            }
          ],
          total_count: 3,
          query_time: 10
        });

        // logWarning spy 설정 (타임아웃 경고 확인용)
        const logWarningSpy = vi.spyOn(tool as any, 'logWarning');

        // MemoryNeighborService 모듈 mock 설정
        // memoryId1: 빠른 응답 (500ms)
        // memoryId2: 느린 응답 (2500ms, 타임아웃 발생)
        // memoryId3: 빠른 응답 (800ms)
        const originalModule = await import('../../services/memory-neighbor-service.js');
        const mockGetNeighbors = vi.fn().mockImplementation(async (memoryId: string) => {
          if (memoryId === memoryId1) {
            // 빠른 응답
            await new Promise(resolve => setTimeout(resolve, 500));
            return {
              memory_id: memoryId,
              neighbors: [{ id: 'neighbor_1', content: 'Neighbor 1', similarity: 0.85 }],
              total_count: 1,
              query_time: 5
            };
          } else if (memoryId === memoryId2) {
            // 느린 응답 (2초 이상, 타임아웃 발생)
            await new Promise(resolve => setTimeout(resolve, 2500));
            return {
              memory_id: memoryId,
              neighbors: [{ id: 'neighbor_2', content: 'Neighbor 2', similarity: 0.82 }],
              total_count: 1,
              query_time: 5
            };
          } else {
            // 빠른 응답
            await new Promise(resolve => setTimeout(resolve, 800));
            return {
              memory_id: memoryId,
              neighbors: [{ id: 'neighbor_3', content: 'Neighbor 3', similarity: 0.80 }],
              total_count: 1,
              query_time: 5
            };
          }
        });

        vi.spyOn(originalModule, 'MemoryNeighborService').mockImplementation(() => ({
          setDatabase: vi.fn(),
          getNeighbors: mockGetNeighbors
        } as any));

        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_limit: 3,
          neighbors_per_item: 5,
          neighbors_similarity_threshold: 0.8
        };

        // When: recall Tool 실행
        const startTime = Date.now();
        const result = await tool.handle(params, context);
        const endTime = Date.now();
        const resultData = JSON.parse(result.content[0].text);
        const totalTime = endTime - startTime;

        // Then: 개별 조회 타임아웃(2초) 내에 응답 반환
        // 전체 응답은 2.5초 이내에 반환되어야 함 (가장 느린 빠른 응답 + 오버헤드)
        expect(totalTime).toBeLessThan(2500);

        // Then: 타임아웃된 항목은 빈 배열
        expect(resultData.items).toBeDefined();
        expect(resultData.items.length).toBe(3);
        
        // memoryId1: 빠른 응답, neighbors 포함
        expect(resultData.items[0].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[0].neighbors)).toBe(true);
        expect(resultData.items[0].neighbors.length).toBeGreaterThan(0);
        
        // memoryId2: 타임아웃 발생, 빈 배열
        expect(resultData.items[1].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[1].neighbors)).toBe(true);
        expect(resultData.items[1].neighbors.length).toBe(0);
        
        // memoryId3: 빠른 응답, neighbors 포함
        expect(resultData.items[2].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[2].neighbors)).toBe(true);
        expect(resultData.items[2].neighbors.length).toBeGreaterThan(0);

        // Then: 타임아웃 경고 로그가 기록되었는지 확인
        expect(logWarningSpy).toHaveBeenCalledWith(
          '이웃 기억 조회 타임아웃',
          expect.objectContaining({
            memoryId: memoryId2,
            index: 1
          })
        );
      });
    });

    describe('이웃 기억 조회 전체 타임아웃', () => {
      it('given: 전체 요청이 2.5초 초과, when: include_neighbors=true, then: 완료된 조회 결과만 반환, 미완료 항목은 빈 배열, 로그/메타데이터 정상', async () => {
        // Given: 전체 요청이 2.5초 초과하는 상황
        const memoryId1 = 'mem_test_001';
        const memoryId2 = 'mem_test_002';
        const memoryId3 = 'mem_test_003';
        const memoryId4 = 'mem_test_004';
        
        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Test memory 1', 0.8, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 2', 0.7, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 3', 0.6, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 4', 0.5, CURRENT_TIMESTAMP)
        `).run(memoryId1, memoryId2, memoryId3, memoryId4);

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: memoryId1,
              content: 'Test memory 1',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            },
            {
              id: memoryId2,
              content: 'Test memory 2',
              type: 'episodic',
              importance: 0.7,
              created_at: new Date().toISOString(),
              finalScore: 0.85
            },
            {
              id: memoryId3,
              content: 'Test memory 3',
              type: 'episodic',
              importance: 0.6,
              created_at: new Date().toISOString(),
              finalScore: 0.75
            },
            {
              id: memoryId4,
              content: 'Test memory 4',
              type: 'episodic',
              importance: 0.5,
              created_at: new Date().toISOString(),
              finalScore: 0.65
            }
          ],
          total_count: 4,
          query_time: 10
        });

        // MemoryNeighborService 모듈 mock 설정
        // memoryId1: 빠른 응답 (1초)
        // memoryId2: 빠른 응답 (1.5초)
        // memoryId3: 느린 응답 (3초, 전체 타임아웃 발생)
        // memoryId4: 느린 응답 (3초, 전체 타임아웃 발생)
        const originalModule = await import('../../services/memory-neighbor-service.js');
        const mockGetNeighbors = vi.fn().mockImplementation(async (memoryId: string) => {
          if (memoryId === memoryId1) {
            // 빠른 응답 (1초)
            await new Promise(resolve => setTimeout(resolve, 1000));
            return {
              memory_id: memoryId,
              neighbors: [{ id: 'neighbor_1', content: 'Neighbor 1', similarity: 0.85 }],
              total_count: 1,
              query_time: 5
            };
          } else if (memoryId === memoryId2) {
            // 빠른 응답 (1.5초)
            await new Promise(resolve => setTimeout(resolve, 1500));
            return {
              memory_id: memoryId,
              neighbors: [{ id: 'neighbor_2', content: 'Neighbor 2', similarity: 0.82 }],
              total_count: 1,
              query_time: 5
            };
          } else {
            // 느린 응답 (3초, 전체 타임아웃 발생)
            await new Promise(resolve => setTimeout(resolve, 3000));
            return {
              memory_id: memoryId,
              neighbors: [{ id: 'neighbor_3', content: 'Neighbor 3', similarity: 0.80 }],
              total_count: 1,
              query_time: 5
            };
          }
        });

        vi.spyOn(originalModule, 'MemoryNeighborService').mockImplementation(() => ({
          setDatabase: vi.fn(),
          getNeighbors: mockGetNeighbors
        } as any));

        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_limit: 4,
          neighbors_per_item: 5,
          neighbors_similarity_threshold: 0.8
        };

        // When: recall Tool 실행
        const startTime = Date.now();
        const result = await tool.handle(params, context);
        const endTime = Date.now();
        const resultData = JSON.parse(result.content[0].text);
        const totalTime = endTime - startTime;

        // Then: 전체 타임아웃(2.5초) 내에 응답 반환
        // 완료된 조회 결과만 반환되어야 하므로 2.5초 이내에 응답
        expect(totalTime).toBeLessThan(2600); // 2.5초 + 약간의 오버헤드

        // Then: 완료된 조회 결과만 반환, 미완료 항목은 빈 배열
        expect(resultData.items).toBeDefined();
        expect(resultData.items.length).toBe(4);
        
        // memoryId1: 빠른 응답 (1초), neighbors 포함
        expect(resultData.items[0].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[0].neighbors)).toBe(true);
        expect(resultData.items[0].neighbors.length).toBeGreaterThan(0);
        
        // memoryId2: 빠른 응답 (1.5초), neighbors 포함
        expect(resultData.items[1].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[1].neighbors)).toBe(true);
        expect(resultData.items[1].neighbors.length).toBeGreaterThan(0);
        
        // memoryId3: 느린 응답 (3초), 전체 타임아웃으로 빈 배열
        expect(resultData.items[2].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[2].neighbors)).toBe(true);
        expect(resultData.items[2].neighbors.length).toBe(0);
        
        // memoryId4: 느린 응답 (3초), 전체 타임아웃으로 빈 배열
        expect(resultData.items[3].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[3].neighbors)).toBe(true);
        expect(resultData.items[3].neighbors.length).toBe(0);

        // Then: 로그/메타데이터 정상
        // 검색 결과는 정상 반환되어야 함
        expect(resultData.total_count).toBe(4);
        expect(resultData.query_time).toBeDefined();
      });
    });

    describe('이웃 기억 조회 실패 시 에러 처리', () => {
      it('given: 이웃 기억 조회 실패, when: include_neighbors=true, then: 해당 항목의 neighbors는 빈 배열, 다른 항목은 정상', async () => {
        // Given: 이웃 기억 조회가 실패하는 상황
        const memoryId1 = 'mem_test_001';
        const memoryId2 = 'mem_test_002';
        const memoryId3 = 'mem_test_003';
        
        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Test memory 1', 0.8, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 2', 0.7, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 3', 0.6, CURRENT_TIMESTAMP)
        `).run(memoryId1, memoryId2, memoryId3);

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: memoryId1,
              content: 'Test memory 1',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            },
            {
              id: memoryId2,
              content: 'Test memory 2',
              type: 'episodic',
              importance: 0.7,
              created_at: new Date().toISOString(),
              finalScore: 0.85
            },
            {
              id: memoryId3,
              content: 'Test memory 3',
              type: 'episodic',
              importance: 0.6,
              created_at: new Date().toISOString(),
              finalScore: 0.75
            }
          ],
          total_count: 3,
          query_time: 10
        });

        // logError spy 설정 (에러 로그 확인용)
        const logErrorSpy = vi.spyOn(tool as any, 'logError');

        // MemoryNeighborService 모듈 mock 설정
        // memoryId1: 성공
        // memoryId2: 에러 발생
        // memoryId3: 성공
        const originalModule = await import('../../services/memory-neighbor-service.js');
        const mockGetNeighbors = vi.fn().mockImplementation(async (memoryId: string) => {
          if (memoryId === memoryId1) {
            // 성공
            return {
              memory_id: memoryId,
              neighbors: [{ id: 'neighbor_1', content: 'Neighbor 1', similarity: 0.85 }],
              total_count: 1,
              query_time: 5
            };
          } else if (memoryId === memoryId2) {
            // 에러 발생
            throw new Error('이웃 기억 조회 실패');
          } else {
            // 성공
            return {
              memory_id: memoryId,
              neighbors: [{ id: 'neighbor_3', content: 'Neighbor 3', similarity: 0.80 }],
              total_count: 1,
              query_time: 5
            };
          }
        });

        vi.spyOn(originalModule, 'MemoryNeighborService').mockImplementation(() => ({
          setDatabase: vi.fn(),
          getNeighbors: mockGetNeighbors
        } as any));

        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_limit: 3,
          neighbors_per_item: 5,
          neighbors_similarity_threshold: 0.8
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 해당 항목의 neighbors는 빈 배열, 다른 항목은 정상
        expect(resultData.items).toBeDefined();
        expect(resultData.items.length).toBe(3);
        
        // memoryId1: 성공, neighbors 포함
        expect(resultData.items[0].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[0].neighbors)).toBe(true);
        expect(resultData.items[0].neighbors.length).toBeGreaterThan(0);
        
        // memoryId2: 에러 발생, 빈 배열
        expect(resultData.items[1].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[1].neighbors)).toBe(true);
        expect(resultData.items[1].neighbors.length).toBe(0);
        
        // memoryId3: 성공, neighbors 포함
        expect(resultData.items[2].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[2].neighbors)).toBe(true);
        expect(resultData.items[2].neighbors.length).toBeGreaterThan(0);

        // Then: 에러 로그가 기록되었는지 확인
        expect(logErrorSpy).toHaveBeenCalledWith(
          expect.any(Error),
          '이웃 기억 조회 실패',
          expect.objectContaining({
            memoryId: memoryId2,
            index: 1
          })
        );

        // Then: 검색 결과는 정상 반환되어야 함
        expect(resultData.total_count).toBe(3);
        expect(resultData.query_time).toBeDefined();
      });
    });

    describe('이웃 기억 순서 보존', () => {
      it('given: 검색 결과 5개(역순 ID 등), neighbors_limit=3, when: include_neighbors=true, then: 상위 3개 결과가 원본 검색 결과 순서대로 neighbors 필드를 포함', async () => {
        // Given: 검색 결과 5개(역순 ID 등으로 순서 명확히)
        const memoryId1 = 'mem_001';
        const memoryId2 = 'mem_002';
        const memoryId3 = 'mem_003';
        const memoryId4 = 'mem_004';
        const memoryId5 = 'mem_005';
        
        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Test memory 1', 0.8, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 2', 0.7, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 3', 0.6, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 4', 0.5, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 5', 0.4, CURRENT_TIMESTAMP)
        `).run(memoryId1, memoryId2, memoryId3, memoryId4, memoryId5);

        // Mock 검색 결과 (5개 항목, 순서 명확히)
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: memoryId1,
              content: 'Test memory 1',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            },
            {
              id: memoryId2,
              content: 'Test memory 2',
              type: 'episodic',
              importance: 0.7,
              created_at: new Date().toISOString(),
              finalScore: 0.85
            },
            {
              id: memoryId3,
              content: 'Test memory 3',
              type: 'episodic',
              importance: 0.6,
              created_at: new Date().toISOString(),
              finalScore: 0.75
            },
            {
              id: memoryId4,
              content: 'Test memory 4',
              type: 'episodic',
              importance: 0.5,
              created_at: new Date().toISOString(),
              finalScore: 0.65
            },
            {
              id: memoryId5,
              content: 'Test memory 5',
              type: 'episodic',
              importance: 0.4,
              created_at: new Date().toISOString(),
              finalScore: 0.55
            }
          ],
          total_count: 5,
          query_time: 10
        });

        // 이웃 기억 조회 호출 순서 추적 (순서 보존 확인용)
        const callOrder: string[] = [];

        // MemoryNeighborService 모듈 mock 설정
        // 각 항목에 대해 다른 지연 시간 적용 (순서 보존 확인용)
        // memoryId1: 가장 느린 응답 (1.5초)
        // memoryId2: 중간 응답 (1초)
        // memoryId3: 가장 빠른 응답 (0.5초)
        const originalModule = await import('../../services/memory-neighbor-service.js');
        const mockGetNeighbors = vi.fn().mockImplementation(async (memoryId: string) => {
          callOrder.push(memoryId);
          
          let delay = 500;
          if (memoryId === memoryId1) {
            delay = 1500; // 가장 느린 응답
          } else if (memoryId === memoryId2) {
            delay = 1000; // 중간 응답
          } else if (memoryId === memoryId3) {
            delay = 500; // 가장 빠른 응답
          }
          
          await new Promise(resolve => setTimeout(resolve, delay));
          
          return {
            memory_id: memoryId,
            neighbors: [{ id: `neighbor_${memoryId}`, content: `Neighbor ${memoryId}`, similarity: 0.85 }],
            total_count: 1,
            query_time: 5
          };
        });

        vi.spyOn(originalModule, 'MemoryNeighborService').mockImplementation(() => ({
          setDatabase: vi.fn(),
          getNeighbors: mockGetNeighbors
        } as any));

        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_limit: 3, // 상위 3개만
          neighbors_per_item: 5,
          neighbors_similarity_threshold: 0.8
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 상위 3개 결과가 원본 검색 결과 순서대로 neighbors 필드를 포함
        expect(resultData.items).toBeDefined();
        expect(resultData.items.length).toBe(5);
        
        // 상위 3개 결과에 neighbors 필드가 포함되어야 함
        expect(resultData.items[0].neighbors).toBeDefined();
        expect(resultData.items[1].neighbors).toBeDefined();
        expect(resultData.items[2].neighbors).toBeDefined();
        
        // 4번째, 5번째 결과에는 neighbors 필드가 없어야 함 (neighbors_limit=3)
        expect(resultData.items[3].neighbors).toBeUndefined();
        expect(resultData.items[4].neighbors).toBeUndefined();
        
        // 원본 검색 결과 순서 확인
        expect(resultData.items[0].id).toBe(memoryId1);
        expect(resultData.items[1].id).toBe(memoryId2);
        expect(resultData.items[2].id).toBe(memoryId3);
        expect(resultData.items[3].id).toBe(memoryId4);
        expect(resultData.items[4].id).toBe(memoryId5);
        
        // neighbors 필드의 순서도 원본 검색 결과 순서와 일치해야 함
        // (병렬 처리로 완료 순서가 다를 수 있지만, 최종 결과는 원본 순서 유지)
        expect(resultData.items[0].neighbors[0].id).toBe(`neighbor_${memoryId1}`);
        expect(resultData.items[1].neighbors[0].id).toBe(`neighbor_${memoryId2}`);
        expect(resultData.items[2].neighbors[0].id).toBe(`neighbor_${memoryId3}`);
      });
    });

    describe('neighbors_limit 적용', () => {
      it('given: 검색 결과 10개, neighbors_limit=3, when: include_neighbors=true, then: 상위 3개 결과만 neighbors 필드 포함', async () => {
        // Given: 검색 결과 10개
        const memoryIds = Array.from({ length: 10 }, (_, i) => `mem_test_${String(i + 1).padStart(3, '0')}`);
        
        // 메모리 아이템 생성
        const insertStmt = db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', ?, 0.8, CURRENT_TIMESTAMP)
        `);
        
        for (let i = 0; i < 10; i++) {
          insertStmt.run(memoryIds[i], `Test memory ${i + 1}`);
        }

        // Mock 검색 결과 (10개 항목)
        const searchItems = memoryIds.map((id, index) => ({
          id,
          content: `Test memory ${index + 1}`,
          type: 'episodic',
          importance: 0.8,
          created_at: new Date().toISOString(),
          finalScore: 0.95 - index * 0.05
        }));

        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: searchItems,
          total_count: 10,
          query_time: 10
        });

        // MemoryNeighborService 모듈 mock 설정
        // 모든 항목에 대해 이웃 기억 반환
        const originalModule = await import('../../services/memory-neighbor-service.js');
        const mockGetNeighbors = vi.fn().mockImplementation(async (memoryId: string) => {
          return {
            memory_id: memoryId,
            neighbors: [{ id: `neighbor_${memoryId}`, content: `Neighbor ${memoryId}`, similarity: 0.85 }],
            total_count: 1,
            query_time: 5
          };
        });

        vi.spyOn(originalModule, 'MemoryNeighborService').mockImplementation(() => ({
          setDatabase: vi.fn(),
          getNeighbors: mockGetNeighbors
        } as any));

        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_limit: 3, // 상위 3개만
          neighbors_per_item: 5,
          neighbors_similarity_threshold: 0.8
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 상위 3개 결과만 neighbors 필드 포함
        expect(resultData.items).toBeDefined();
        expect(resultData.items.length).toBe(10);
        
        // 상위 3개 결과에 neighbors 필드 포함 확인
        expect(resultData.items[0].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[0].neighbors)).toBe(true);
        expect(resultData.items[0].neighbors.length).toBeGreaterThan(0);
        
        expect(resultData.items[1].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[1].neighbors)).toBe(true);
        expect(resultData.items[1].neighbors.length).toBeGreaterThan(0);
        
        expect(resultData.items[2].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[2].neighbors)).toBe(true);
        expect(resultData.items[2].neighbors.length).toBeGreaterThan(0);
        
        // 4번째부터 10번째 결과에는 neighbors 필드가 없어야 함
        for (let i = 3; i < 10; i++) {
          expect(resultData.items[i].neighbors).toBeUndefined();
        }

        // Then: getNeighbors가 3번만 호출되었는지 확인 (neighbors_limit=3)
        expect(mockGetNeighbors).toHaveBeenCalledTimes(3);
        expect(mockGetNeighbors).toHaveBeenCalledWith(memoryIds[0], expect.any(Object));
        expect(mockGetNeighbors).toHaveBeenCalledWith(memoryIds[1], expect.any(Object));
        expect(mockGetNeighbors).toHaveBeenCalledWith(memoryIds[2], expect.any(Object));
      });
    });

    describe('neighbors_per_item 적용', () => {
      it('given: neighbors_per_item=2, when: include_neighbors=true, then: 각 항목의 neighbors 배열이 최대 2개', async () => {
        // Given: neighbors_per_item=2
        const memoryId1 = 'mem_test_001';
        const memoryId2 = 'mem_test_002';
        const memoryId3 = 'mem_test_003';
        
        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Test memory 1', 0.8, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 2', 0.7, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 3', 0.6, CURRENT_TIMESTAMP)
        `).run(memoryId1, memoryId2, memoryId3);

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: memoryId1,
              content: 'Test memory 1',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            },
            {
              id: memoryId2,
              content: 'Test memory 2',
              type: 'episodic',
              importance: 0.7,
              created_at: new Date().toISOString(),
              finalScore: 0.85
            },
            {
              id: memoryId3,
              content: 'Test memory 3',
              type: 'episodic',
              importance: 0.6,
              created_at: new Date().toISOString(),
              finalScore: 0.75
            }
          ],
          total_count: 3,
          query_time: 10
        });

        // MemoryNeighborService 모듈 mock 설정
        // neighbors_per_item=2이므로 각 항목당 최대 2개의 이웃 기억 반환
        const originalModule = await import('../../services/memory-neighbor-service.js');
        const mockGetNeighbors = vi.fn().mockImplementation(async (memoryId: string, options: any) => {
          // limit 파라미터가 neighbors_per_item과 일치하는지 확인
          expect(options.limit).toBe(2);
          
          // 각 항목에 대해 2개의 이웃 기억 반환
          return {
            memory_id: memoryId,
            neighbors: [
              { id: `neighbor_${memoryId}_1`, content: `Neighbor 1 of ${memoryId}`, similarity: 0.85 },
              { id: `neighbor_${memoryId}_2`, content: `Neighbor 2 of ${memoryId}`, similarity: 0.82 }
            ],
            total_count: 2,
            query_time: 5
          };
        });

        vi.spyOn(originalModule, 'MemoryNeighborService').mockImplementation(() => ({
          setDatabase: vi.fn(),
          getNeighbors: mockGetNeighbors
        } as any));

        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_limit: 3,
          neighbors_per_item: 2, // 각 항목당 최대 2개
          neighbors_similarity_threshold: 0.8
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 각 항목의 neighbors 배열이 최대 2개
        expect(resultData.items).toBeDefined();
        expect(resultData.items.length).toBe(3);
        
        // 모든 항목의 neighbors 배열이 최대 2개인지 확인
        expect(resultData.items[0].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[0].neighbors)).toBe(true);
        expect(resultData.items[0].neighbors.length).toBeLessThanOrEqual(2);
        expect(resultData.items[0].neighbors.length).toBe(2);
        
        expect(resultData.items[1].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[1].neighbors)).toBe(true);
        expect(resultData.items[1].neighbors.length).toBeLessThanOrEqual(2);
        expect(resultData.items[1].neighbors.length).toBe(2);
        
        expect(resultData.items[2].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[2].neighbors)).toBe(true);
        expect(resultData.items[2].neighbors.length).toBeLessThanOrEqual(2);
        expect(resultData.items[2].neighbors.length).toBe(2);

        // Then: getNeighbors가 limit=2로 호출되었는지 확인
        expect(mockGetNeighbors).toHaveBeenCalledTimes(3);
        expect(mockGetNeighbors).toHaveBeenCalledWith(memoryId1, expect.objectContaining({ limit: 2 }));
        expect(mockGetNeighbors).toHaveBeenCalledWith(memoryId2, expect.objectContaining({ limit: 2 }));
        expect(mockGetNeighbors).toHaveBeenCalledWith(memoryId3, expect.objectContaining({ limit: 2 }));
      });
    });

    describe('neighbors_similarity_threshold 필터링', () => {
      it('given: 유사도 0.7, 0.8, 0.9인 이웃 기억, neighbors_similarity_threshold=0.8, when: include_neighbors=true, then: 0.8 이상만 포함', async () => {
        // Given: 유사도 0.7, 0.8, 0.9인 이웃 기억
        const memoryId = 'mem_test_001';
        
        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Test memory', 0.8, CURRENT_TIMESTAMP)
        `).run(memoryId);

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: memoryId,
              content: 'Test memory',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            }
          ],
          total_count: 1,
          query_time: 10
        });

        // MemoryNeighborService 모듈 mock 설정
        // neighbors_similarity_threshold=0.8이므로 0.8 이상의 유사도를 가진 이웃 기억만 반환
        const originalModule = await import('../../services/memory-neighbor-service.js');
        const mockGetNeighbors = vi.fn().mockImplementation(async (memoryId: string, options: any) => {
          // similarity_threshold 파라미터가 neighbors_similarity_threshold와 일치하는지 확인
          expect(options.similarity_threshold).toBe(0.8);
          
          // 유사도 0.7, 0.8, 0.9인 이웃 기억 반환
          // MemoryNeighborService는 similarity_threshold 이상인 것만 반환해야 함
          return {
            memory_id: memoryId,
            neighbors: [
              { id: 'neighbor_0.9', content: 'Neighbor with similarity 0.9', similarity: 0.9 },
              { id: 'neighbor_0.8', content: 'Neighbor with similarity 0.8', similarity: 0.8 }
              // 유사도 0.7은 similarity_threshold=0.8 미만이므로 제외됨
            ],
            total_count: 2,
            query_time: 5
          };
        });

        vi.spyOn(originalModule, 'MemoryNeighborService').mockImplementation(() => ({
          setDatabase: vi.fn(),
          getNeighbors: mockGetNeighbors
        } as any));

        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_limit: 1,
          neighbors_per_item: 5,
          neighbors_similarity_threshold: 0.8 // 유사도 임계값 0.8
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 0.8 이상만 포함
        expect(resultData.items).toBeDefined();
        expect(resultData.items.length).toBe(1);
        expect(resultData.items[0].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[0].neighbors)).toBe(true);
        
        // 반환된 neighbors 배열의 모든 항목이 0.8 이상의 유사도를 가져야 함
        resultData.items[0].neighbors.forEach((neighbor: any) => {
          expect(neighbor.similarity).toBeGreaterThanOrEqual(0.8);
        });
        
        // 유사도 0.9와 0.8인 이웃 기억이 포함되어야 함
        expect(resultData.items[0].neighbors.length).toBe(2);
        expect(resultData.items[0].neighbors.some((n: any) => n.similarity === 0.9)).toBe(true);
        expect(resultData.items[0].neighbors.some((n: any) => n.similarity === 0.8)).toBe(true);
        // 유사도 0.7인 이웃 기억은 포함되지 않아야 함
        expect(resultData.items[0].neighbors.some((n: any) => n.similarity === 0.7)).toBe(false);

        // Then: getNeighbors가 similarity_threshold=0.8로 호출되었는지 확인
        expect(mockGetNeighbors).toHaveBeenCalledTimes(1);
        expect(mockGetNeighbors).toHaveBeenCalledWith(memoryId, expect.objectContaining({ 
          similarity_threshold: 0.8 
        }));
      });
    });

    describe('하위 호환성', () => {
      it('given: 새 파라미터 없음, when: recall 호출, then: 기존 동작과 동일하게 동작, metadata.anchor_set=null, neighbors 필드 없음', async () => {
        // Given: 새 파라미터 없음
        const memoryId = 'mem_test_001';
        
        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Test memory', 0.8, CURRENT_TIMESTAMP)
        `).run(memoryId);

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: memoryId,
              content: 'Test memory',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            }
          ],
          total_count: 1,
          query_time: 10
        });

        // 새 파라미터 없이 recall 호출 (기존 파라미터만 사용)
        const params = {
          query: 'test',
          limit: 10
          // auto_set_anchor, include_neighbors 등 새 파라미터 없음
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 기존 동작과 동일하게 동작
        expect(resultData.items).toBeDefined();
        expect(resultData.items.length).toBe(1);
        expect(resultData.items[0].id).toBe(memoryId);
        expect(resultData.items[0].content).toBe('Test memory');
        expect(resultData.total_count).toBe(1);
        expect(resultData.query_time).toBeDefined();

        // Then: metadata.anchor_set=null
        expect(resultData.metadata).toBeDefined();
        expect(resultData.metadata.anchor_set).toBeNull();
        expect(resultData.metadata.anchor_set_error).toBeUndefined();
        expect(resultData.metadata.anchor_set_skipped).toBeUndefined();

        // Then: neighbors 필드 없음
        expect(resultData.items[0].neighbors).toBeUndefined();
      });
    });
  });

  describe('앵커 설정 메타데이터', () => {
    describe('앵커 설정 성공 시 메타데이터', () => {
      it('given: 앵커 설정 성공, when: auto_set_anchor=true, then: metadata.anchor_set={memory_id, slot: "A", agent_id}, anchor_set_error/anchor_set_skipped 없음', async () => {
        // Given: 앵커 설정이 성공하는 상황
        const memoryId = 'mem_test_001';
        const agentId = 'default';
        
        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Test memory content', 0.8, CURRENT_TIMESTAMP)
        `).run(memoryId);

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: memoryId,
              content: 'Test memory content',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const params = {
          query: 'test',
          limit: 10,
          auto_set_anchor: true,
          agent_id: agentId
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: metadata.anchor_set={memory_id, slot: "A", agent_id}
        expect(resultData.metadata).toBeDefined();
        expect(resultData.metadata.anchor_set).toBeDefined();
        expect(resultData.metadata.anchor_set).toEqual({
          memory_id: memoryId,
          slot: 'A',
          agent_id: agentId
        });

        // Then: anchor_set_error/anchor_set_skipped 없음
        expect(resultData.metadata.anchor_set_error).toBeUndefined();
        expect(resultData.metadata.anchor_set_skipped).toBeUndefined();
        expect(resultData.metadata.anchor_set_skipped_reason).toBeUndefined();
      });
    });

    describe('앵커 설정 실패 시 메타데이터', () => {
      it('given: 앵커 설정 실패, when: auto_set_anchor=true, then: metadata.anchor_set=null, anchor_set_error=true, anchor_set_skipped 없음', async () => {
        // Given: 앵커 설정이 실패하는 상황
        const memoryId = 'mem_test_001';
        const agentId = 'default';
        
        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Test memory content', 0.8, CURRENT_TIMESTAMP)
        `).run(memoryId);

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: memoryId,
              content: 'Test memory content',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            }
          ],
          total_count: 1,
          query_time: 10
        });

        // AnchorManager.setAnchor를 mock하여 에러 발생시키기
        const setAnchorError = new Error('앵커 설정 실패');
        vi.spyOn(anchorManager, 'setAnchor').mockRejectedValue(setAnchorError);

        const params = {
          query: 'test',
          limit: 10,
          auto_set_anchor: true,
          agent_id: agentId
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: metadata.anchor_set=null
        expect(resultData.metadata).toBeDefined();
        expect(resultData.metadata.anchor_set).toBeNull();

        // Then: anchor_set_error=true
        expect(resultData.metadata.anchor_set_error).toBe(true);

        // Then: anchor_set_skipped 없음
        expect(resultData.metadata.anchor_set_skipped).toBeUndefined();
        expect(resultData.metadata.anchor_set_skipped_reason).toBeUndefined();
      });
    });

    describe('앵커 설정 건너뜀 시 메타데이터', () => {
      it('given: 슬롯 A에 pinned 앵커 있음, when: auto_set_anchor=true, then: metadata.anchor_set=null, anchor_set_skipped=true, anchor_set_skipped_reason="pinned_anchor_protected", anchor_set_error 없음', async () => {
        // Given: 슬롯 A에 pinned 앵커가 있는 상황
        const agentId = 'default';
        const pinnedMemoryId = 'mem_pinned';
        const newMemoryId = 'mem_new';
        
        // pinned 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, pinned, created_at) VALUES (?, 'episodic', 'Pinned Memory', 0.9, 1, CURRENT_TIMESTAMP),
            (?, 'episodic', 'New Memory', 0.8, 0, CURRENT_TIMESTAMP)
        `).run(pinnedMemoryId, newMemoryId);

        // 슬롯 A에 pinned 앵커 설정
        await anchorManager.setAnchor(agentId, pinnedMemoryId, 'A');

        // Mock 검색 결과 (새로운 메모리가 첫 번째 결과)
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: newMemoryId,
              content: 'New Memory',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const params = {
          query: 'test',
          limit: 10,
          auto_set_anchor: true,
          agent_id: agentId
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: metadata.anchor_set=null
        expect(resultData.metadata).toBeDefined();
        expect(resultData.metadata.anchor_set).toBeNull();

        // Then: anchor_set_skipped=true
        expect(resultData.metadata.anchor_set_skipped).toBe(true);

        // Then: anchor_set_skipped_reason="pinned_anchor_protected"
        expect(resultData.metadata.anchor_set_skipped_reason).toBe('pinned_anchor_protected');

        // Then: anchor_set_error 없음
        expect(resultData.metadata.anchor_set_error).toBeUndefined();
      });
    });

    describe('앵커 설정 비활성화 시 메타데이터', () => {
      it('given: auto_set_anchor=false, when: recall 호출, then: metadata.anchor_set=null, anchor_set_error/anchor_set_skipped 없음', async () => {
        // Given: auto_set_anchor=false
        const memoryId = 'mem_test_001';
        
        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Test memory content', 0.8, CURRENT_TIMESTAMP)
        `).run(memoryId);

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: memoryId,
              content: 'Test memory content',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const params = {
          query: 'test',
          limit: 10,
          auto_set_anchor: false // 비활성화
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: metadata.anchor_set=null
        expect(resultData.metadata).toBeDefined();
        expect(resultData.metadata.anchor_set).toBeNull();

        // Then: anchor_set_error/anchor_set_skipped 없음
        expect(resultData.metadata.anchor_set_error).toBeUndefined();
        expect(resultData.metadata.anchor_set_skipped).toBeUndefined();
        expect(resultData.metadata.anchor_set_skipped_reason).toBeUndefined();
      });
    });

    describe('검색 결과 없을 때 자동 앵커 설정 메타데이터', () => {
      it('given: 검색 결과 없음, auto_set_anchor=true, when: recall 호출, then: metadata.anchor_set=null, anchor_set_error/anchor_set_skipped 없음', async () => {
        // Given: 검색 결과 없음, auto_set_anchor=true
        const agentId = 'default';
        
        // Mock 검색 결과 (빈 배열)
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [],
          total_count: 0,
          query_time: 10
        });

        const params = {
          query: 'test',
          limit: 10,
          auto_set_anchor: true,
          agent_id: agentId
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: metadata.anchor_set=null
        expect(resultData.metadata).toBeDefined();
        expect(resultData.metadata.anchor_set).toBeNull();

        // Then: anchor_set_error/anchor_set_skipped 없음
        expect(resultData.metadata.anchor_set_error).toBeUndefined();
        expect(resultData.metadata.anchor_set_skipped).toBeUndefined();
        expect(resultData.metadata.anchor_set_skipped_reason).toBeUndefined();

        // Then: 검색 결과가 없어서 앵커 설정이 시도되지 않았는지 확인
        expect(resultData.items).toBeDefined();
        expect(resultData.items.length).toBe(0);
        expect(resultData.total_count).toBe(0);
      });
    });
  });

  describe('메타 통계 수집 통합', () => {
    it('given: recall 호출 시 검색 결과가 있을 때, when: 통계를 확인하면, then: 각 메모리 항목의 통계가 업데이트되어야 함', async () => {
      // Given: 메모리 항목 생성 및 검색 결과 준비
      const memoryId1 = 'mem_test_meta_1';
      const memoryId2 = 'mem_test_meta_2';

      // memory_item 테이블에 테스트 데이터 삽입
      db.exec(`
        INSERT INTO memory_item (id, type, content, importance, created_at) VALUES ('${memoryId1}', 'episodic', 'Test memory 1', 0.8, CURRENT_TIMESTAMP),
          ('${memoryId2}', 'episodic', 'Test memory 2', 0.7, CURRENT_TIMESTAMP)
      `);

      // meta_memory_stats 테이블 생성 (마이그레이션 실행)
      db.exec(`
        CREATE TABLE IF NOT EXISTS meta_memory_stats (
          memory_id TEXT PRIMARY KEY,
          recall_count INTEGER DEFAULT 0 NOT NULL,
          success_count INTEGER DEFAULT 0 NOT NULL,
          failure_count INTEGER DEFAULT 0 NOT NULL,
          avg_confidence REAL DEFAULT 0.0 NOT NULL,
          last_recalled_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE
        )
      `);

      // MetaMemoryService 초기화
      const { MetaMemoryService } = await import('../../services/meta-memory-service.js');
      const metaMemoryService = new MetaMemoryService(db);

      // context에 MetaMemoryService 추가
      context.services.metaMemoryService = metaMemoryService;

      // Mock 검색 결과 (final_score 포함)
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [
          {
            id: memoryId1,
            memory_id: memoryId1,
            content: 'Test memory 1',
            type: 'episodic',
            importance: 0.8,
            created_at: new Date().toISOString(),
            final_score: 0.95, // 성공 (>= 0.5)
            consolidation_score: 0.9,
            vectorScore: 0.85
          },
          {
            id: memoryId2,
            memory_id: memoryId2,
            content: 'Test memory 2',
            type: 'episodic',
            importance: 0.7,
            created_at: new Date().toISOString(),
            final_score: 0.3, // 실패 (< 0.5)
            consolidation_score: 0.2,
            vectorScore: 0.25
          }
        ],
        total_count: 2,
        query_time: 10
      });

      // When: recall 호출
      const params = {
        query: 'test',
        limit: 10
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // 검색 결과 확인
      expect(resultData.items).toBeDefined();
      expect(resultData.items.length).toBe(2);

      // 통계 업데이트를 위해 debounce 시간 대기 (100ms)
      await new Promise(resolve => setTimeout(resolve, 150));

      // MetaMemoryService destroy로 남은 버퍼 flush
      await metaMemoryService.destroy();

      // Then: 각 메모리 항목의 통계가 업데이트되어야 함
      const stats1 = await metaMemoryService.getStatsById(memoryId1);
      const stats2 = await metaMemoryService.getStatsById(memoryId2);

      // memoryId1: 성공 (final_score >= 0.5)
      expect(stats1.recall_count).toBe(1);
      expect(stats1.success_count).toBe(1);
      expect(stats1.failure_count).toBe(0);
      expect(stats1.avg_confidence).toBeGreaterThan(0);
      expect(stats1.last_recalled_at).toBeDefined();

      // memoryId2: 실패 (final_score < 0.5)
      expect(stats2.recall_count).toBe(1);
      expect(stats2.success_count).toBe(0);
      expect(stats2.failure_count).toBe(1);
      expect(stats2.avg_confidence).toBeGreaterThan(0);
      expect(stats2.last_recalled_at).toBeDefined();
    });

    it('given: 검색 결과가 0개일 때, when: recall을 호출하면, then: 통계 업데이트가 발생하지 않아야 함', async () => {
      // Given: 메모리 항목 생성 (하지만 검색 결과는 0개)
      const memoryId = 'mem_test_meta_empty';

      // memory_item 테이블에 테스트 데이터 삽입
      db.exec(`
        INSERT INTO memory_item (id, type, content, importance, created_at) VALUES ('${memoryId}', 'episodic', 'Test memory', 0.8, CURRENT_TIMESTAMP)
      `);

      // meta_memory_stats 테이블 생성 (마이그레이션 실행)
      db.exec(`
        CREATE TABLE IF NOT EXISTS meta_memory_stats (
          memory_id TEXT PRIMARY KEY,
          recall_count INTEGER DEFAULT 0 NOT NULL,
          success_count INTEGER DEFAULT 0 NOT NULL,
          failure_count INTEGER DEFAULT 0 NOT NULL,
          avg_confidence REAL DEFAULT 0.0 NOT NULL,
          last_recalled_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE
        )
      `);

      // MetaMemoryService 초기화
      const { MetaMemoryService } = await import('../../services/meta-memory-service.js');
      const metaMemoryService = new MetaMemoryService(db);

      // context에 MetaMemoryService 추가
      context.services.metaMemoryService = metaMemoryService;

      // Mock 검색 결과 (0개)
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [],
        total_count: 0,
        query_time: 10
      });

      // When: recall 호출
      const params = {
        query: 'nonexistent',
        limit: 10
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // 검색 결과 확인
      expect(resultData.items).toBeDefined();
      expect(resultData.items.length).toBe(0);

      // 통계 업데이트를 위해 debounce 시간 대기 (100ms)
      await new Promise(resolve => setTimeout(resolve, 150));

      // MetaMemoryService destroy로 남은 버퍼 flush
      await metaMemoryService.destroy();

      // Then: 통계 업데이트가 발생하지 않아야 함
      const stats = await metaMemoryService.getStatsById(memoryId);

      // 통계가 기본값(0)으로 유지되어야 함
      expect(stats.recall_count).toBe(0);
      expect(stats.success_count).toBe(0);
      expect(stats.failure_count).toBe(0);
      expect(stats.avg_confidence).toBe(0.0);
      expect(stats.last_recalled_at).toBeUndefined();
    });

    it('given: include_metadata=true로 recall 호출할 때, when: 응답을 확인하면, then: meta_stats 필드가 포함되어야 함', async () => {
      // Given: 메모리 항목 생성 및 검색 결과 준비
      const memoryId1 = 'mem_test_meta_stats_1';
      const memoryId2 = 'mem_test_meta_stats_2';

      // memory_item 테이블에 테스트 데이터 삽입
      db.exec(`
        INSERT INTO memory_item (id, type, content, importance, created_at) VALUES ('${memoryId1}', 'episodic', 'Test memory 1', 0.8, CURRENT_TIMESTAMP),
          ('${memoryId2}', 'episodic', 'Test memory 2', 0.7, CURRENT_TIMESTAMP)
      `);

      // meta_memory_stats 테이블 생성 (마이그레이션 실행)
      db.exec(`
        CREATE TABLE IF NOT EXISTS meta_memory_stats (
          memory_id TEXT PRIMARY KEY,
          recall_count INTEGER DEFAULT 0 NOT NULL,
          success_count INTEGER DEFAULT 0 NOT NULL,
          failure_count INTEGER DEFAULT 0 NOT NULL,
          avg_confidence REAL DEFAULT 0.0 NOT NULL,
          last_recalled_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE
        )
      `);

      // MetaMemoryService 초기화
      const { MetaMemoryService } = await import('../../services/meta-memory-service.js');
      const metaMemoryService = new MetaMemoryService(db);

      // context에 MetaMemoryService 추가
      context.services.metaMemoryService = metaMemoryService;

      // Mock 검색 결과
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [
          {
            id: memoryId1,
            memory_id: memoryId1,
            content: 'Test memory 1',
            type: 'episodic',
            importance: 0.8,
            created_at: new Date().toISOString(),
            final_score: 0.95,
            consolidation_score: 0.9,
            vectorScore: 0.85
          },
          {
            id: memoryId2,
            memory_id: memoryId2,
            content: 'Test memory 2',
            type: 'episodic',
            importance: 0.7,
            created_at: new Date().toISOString(),
            final_score: 0.3,
            consolidation_score: 0.2,
            vectorScore: 0.25
          }
        ],
        total_count: 2,
        query_time: 10
      });

      // When: include_metadata=true로 recall 호출
      const params = {
        query: 'test',
        limit: 10,
        include_metadata: true
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // 검색 결과 확인
      expect(resultData.items).toBeDefined();
      expect(resultData.items.length).toBe(2);

      // 통계 업데이트를 위해 debounce 시간 대기 (100ms)
      await new Promise(resolve => setTimeout(resolve, 150));

      // MetaMemoryService destroy로 남은 버퍼 flush
      await metaMemoryService.destroy();

      // Then: meta_stats 필드가 포함되어야 함
      expect(resultData.meta_stats).toBeDefined();
      expect(typeof resultData.meta_stats).toBe('object');

      // meta_stats는 memory_id를 키로 하는 객체
      expect(resultData.meta_stats[memoryId1]).toBeDefined();
      expect(resultData.meta_stats[memoryId2]).toBeDefined();

      const stats1 = resultData.meta_stats[memoryId1];
      const stats2 = resultData.meta_stats[memoryId2];

      expect(stats1).toBeDefined();
      expect(stats1.recall_count).toBe(1);
      expect(stats1.success_count).toBe(1);
      expect(stats1.failure_count).toBe(0);
      expect(stats1.avg_confidence).toBeGreaterThan(0);
      expect(stats1.last_recalled_at).toBeDefined();

      expect(stats2).toBeDefined();
      expect(stats2.recall_count).toBe(1);
      expect(stats2.success_count).toBe(0);
      expect(stats2.failure_count).toBe(1);
      expect(stats2.avg_confidence).toBeGreaterThan(0);
      expect(stats2.last_recalled_at).toBeDefined();
    });

    it('given: 같은 memory_id가 여러 번 검색 결과에 포함될 때, when: 통계를 확인하면, then: 각각 별도로 통계가 업데이트되어야 함', async () => {
      // Given: 메모리 항목 생성 및 검색 결과에 같은 memory_id가 2번 포함
      const memoryId = 'mem_test_meta_duplicate';

      // memory_item 테이블에 테스트 데이터 삽입
      db.exec(`
        INSERT INTO memory_item (id, type, content, importance, created_at) VALUES ('${memoryId}', 'episodic', 'Test memory', 0.8, CURRENT_TIMESTAMP)
      `);

      // meta_memory_stats 테이블 생성 (마이그레이션 실행)
      db.exec(`
        CREATE TABLE IF NOT EXISTS meta_memory_stats (
          memory_id TEXT PRIMARY KEY,
          recall_count INTEGER DEFAULT 0 NOT NULL,
          success_count INTEGER DEFAULT 0 NOT NULL,
          failure_count INTEGER DEFAULT 0 NOT NULL,
          avg_confidence REAL DEFAULT 0.0 NOT NULL,
          last_recalled_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE
        )
      `);

      // MetaMemoryService 초기화
      const { MetaMemoryService } = await import('../../services/meta-memory-service.js');
      const metaMemoryService = new MetaMemoryService(db);

      // context에 MetaMemoryService 추가
      context.services.metaMemoryService = metaMemoryService;

      // Mock 검색 결과 (같은 memory_id가 2번 포함)
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [
          {
            id: memoryId,
            memory_id: memoryId,
            content: 'Test memory',
            type: 'episodic',
            importance: 0.8,
            created_at: new Date().toISOString(),
            final_score: 0.95, // 첫 번째: 성공
            consolidation_score: 0.9,
            vectorScore: 0.85
          },
          {
            id: memoryId, // 같은 memory_id
            memory_id: memoryId,
            content: 'Test memory (duplicate)',
            type: 'episodic',
            importance: 0.8,
            created_at: new Date().toISOString(),
            final_score: 0.3, // 두 번째: 실패
            consolidation_score: 0.2,
            vectorScore: 0.25
          }
        ],
        total_count: 2,
        query_time: 10
      });

      // When: recall 호출
      const params = {
        query: 'test',
        limit: 10
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // 검색 결과 확인
      expect(resultData.items).toBeDefined();
      expect(resultData.items.length).toBe(2);

      // 통계 업데이트를 위해 debounce 시간 대기 (100ms)
      await new Promise(resolve => setTimeout(resolve, 150));

      // MetaMemoryService destroy로 남은 버퍼 flush
      await metaMemoryService.destroy();

      // Then: 각각 별도로 통계가 업데이트되어야 함
      const stats = await metaMemoryService.getStatsById(memoryId);

      // 같은 memory_id가 2번 나타났으므로 recall_count는 2여야 함
      expect(stats.recall_count).toBe(2);
      // 첫 번째는 성공 (final_score >= 0.5), 두 번째는 실패 (final_score < 0.5)
      expect(stats.success_count).toBe(1);
      expect(stats.failure_count).toBe(1);
      expect(stats.avg_confidence).toBeGreaterThan(0);
      expect(stats.last_recalled_at).toBeDefined();
    });

    it('given: 통계 수집이 실패할 때, when: recall 응답을 확인하면, then: recall은 정상적으로 성공해야 함', async () => {
      // Given: 메모리 항목 생성 및 MetaMemoryService mock (에러 발생하도록)
      const memoryId = 'mem_test_meta_error';

      // memory_item 테이블에 테스트 데이터 삽입
      db.exec(`
        INSERT INTO memory_item (id, type, content, importance, created_at) VALUES ('${memoryId}', 'episodic', 'Test memory', 0.8, CURRENT_TIMESTAMP)
      `);

      // meta_memory_stats 테이블 생성 (마이그레이션 실행)
      db.exec(`
        CREATE TABLE IF NOT EXISTS meta_memory_stats (
          memory_id TEXT PRIMARY KEY,
          recall_count INTEGER DEFAULT 0 NOT NULL,
          success_count INTEGER DEFAULT 0 NOT NULL,
          failure_count INTEGER DEFAULT 0 NOT NULL,
          avg_confidence REAL DEFAULT 0.0 NOT NULL,
          last_recalled_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE
        )
      `);

      // MetaMemoryService 초기화
      const { MetaMemoryService } = await import('../../services/meta-memory-service.js');
      const metaMemoryService = new MetaMemoryService(db);

      // context에 MetaMemoryService 추가
      context.services.metaMemoryService = metaMemoryService;

      // MetaMemoryService.recordRecall을 mock하여 에러 발생하도록 설정
      const originalRecordRecall = metaMemoryService.recordRecall.bind(metaMemoryService);
      vi.spyOn(metaMemoryService, 'recordRecall').mockRejectedValue(new Error('통계 수집 실패'));

      // Mock 검색 결과
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [
          {
            id: memoryId,
            memory_id: memoryId,
            content: 'Test memory',
            type: 'episodic',
            importance: 0.8,
            created_at: new Date().toISOString(),
            final_score: 0.95,
            consolidation_score: 0.9,
            vectorScore: 0.85
          }
        ],
        total_count: 1,
        query_time: 10
      });

      // When: recall 호출
      const params = {
        query: 'test',
        limit: 10
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // Then: recall은 정상적으로 성공해야 함
      expect(resultData.items).toBeDefined();
      expect(resultData.items.length).toBe(1);
      expect(resultData.items[0].memory_id).toBe(memoryId);
      expect(resultData.items[0].content).toBe('Test memory');
      expect(resultData.total_count).toBe(1);

      // 통계 수집이 실패했어도 recall은 성공해야 함
      // (에러가 발생했는지 확인하기 위해 spy 확인)
      expect(metaMemoryService.recordRecall).toHaveBeenCalled();
    });
  });

  describe('source 필드 round-trip (#671)', () => {
    const sourceUri = 'https://github.com/jee1/memento/issues/671';

    beforeEach(() => {
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [
          {
            id: 'mem_source_1',
            memory_id: 'mem_source_1',
            content: 'source round-trip test',
            type: 'semantic',
            importance: 0.7,
            created_at: new Date().toISOString(),
            source: sourceUri,
            final_score: 0.9,
          },
        ],
        total_count: 1,
        query_time: 5,
        text_count: 1,
        vector_count: 0,
      });
    });

    it('remember 시 저장한 source가 recall 응답에 포함된다', async () => {
      const result = await tool.handle(
        { query: 'source', type: 'semantic', include_metadata: true, limit: 5 },
        context,
      );
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items).toHaveLength(1);
      expect(resultData.items[0].source).toBe(sourceUri);
    });
  });
});
