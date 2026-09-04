import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mementoConfig } from "../../../../shared/config/index.js";
import { ToolInputValidationError } from "../../../../shared/errors/tool-input-validation-error.js";
import { DatabaseUtils } from "../../../../shared/utils/database.js";
import { describeRecallTool, db, tool, context, hybridSearchEngine } from "./recall-tool.test-setup.js";

describeRecallTool("basics and search", () => {
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

      await expect(tool.handle({ query: 'q', limit: 5 }, context)).rejects.toThrow(ToolInputValidationError);
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

      // RecallSchema Zod refine이 query 누락을 먼저 거절 (ZodError → MCP -32602)
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
      expect(data.items[0].uri).toBe('memento://agent-a/memory/mem-a');
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
      expect(data.total_count).toBe(1);
      expect(data.items[0].memory_id).toBe('mem-proj-a');
      expect(data.items[0].project_id).toBe('proj-a');
      expect(hybridSearchEngine.search).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          filters: expect.objectContaining({ project_id: 'proj-a' }),
        }),
      );
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

});
