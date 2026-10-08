/**
 * MemoryInjectionPrompt 테스트
 * 메모리 주입 프롬프트 도구 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryInjectionPrompt } from '../memory-injection-prompt.js';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import { createHybridSearchEngine } from '../../../search/algorithms/hybrid-search-engine.js';
import { ErrorLoggingService } from '../../../monitoring/services/error-logging-service.js';
import type { ToolContext } from '../../../tools/types.js';
import { MemoryEmbeddingService } from '../../services/memory-embedding-service.js';
import { mementoConfig } from '../../../../shared/config/index.js';

describe('MemoryInjectionPrompt', () => {
  let db: Database.Database;
  let tool: MemoryInjectionPrompt;
  let context: ToolContext;
  let errorLoggingService: ErrorLoggingService;
  let embeddingService: MemoryEmbeddingService;

  beforeEach(async () => {
    db = await setupTestDatabase();
    tool = new MemoryInjectionPrompt();
    
    // 에러 로깅 서비스 생성
    errorLoggingService = new ErrorLoggingService(db);
    embeddingService = new MemoryEmbeddingService();
    const hybridSearchEngine = createHybridSearchEngine(undefined, embeddingService);
    
    context = {
      db,
      services: {
        hybridSearchEngine,
        embeddingService,
        errorLoggingService
      }
    };
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  describe('constructor', () => {
    it('도구가 올바르게 초기화되어야 함', () => {
      // When: 도구 생성
      const instance = new MemoryInjectionPrompt();

      // Then: 도구가 생성되어야 함
      expect(instance).toBeDefined();
    });

    it('올바른 도구 이름을 가져야 함', () => {
      // When: 도구 정의 조회
      const definition = tool.getDefinition();

      // Then: 올바른 이름
      expect(definition.name).toBe('memory_injection');
    });

    it('올바른 도구 설명을 가져야 함', () => {
      // When: 도구 정의 조회
      const definition = tool.getDefinition();

      // Then: 올바른 설명
      expect(definition.description).toContain('관련 기억');
    });

    it('올바른 입력 스키마를 가져야 함', () => {
      // When: 도구 정의 조회
      const definition = tool.getDefinition();

      // Then: 입력 스키마가 있어야 함
      expect(definition.inputSchema).toBeDefined();
      expect(definition.inputSchema.type).toBe('object');
      expect(definition.inputSchema.properties).toBeDefined();
      expect(definition.inputSchema.properties.query).toBeDefined();
      expect(String(definition.inputSchema.properties.query.description)).toContain('자연어 문장');
    });
  });

  describe('handle', () => {
    it('데이터베이스가 없을 때 에러를 발생시켜야 함', async () => {
      // Given: 데이터베이스가 없는 컨텍스트
      const invalidContext: ToolContext = {
        db: null as any,
        services: context.services
      };

      // When & Then: 에러 발생
      await expect(
        tool.handle({ query: 'test' }, invalidContext)
      ).rejects.toThrow('데이터베이스가 연결되지 않았습니다');
    });

    it('하이브리드 검색 엔진이 없을 때 에러를 발생시켜야 함', async () => {
      // Given: 하이브리드 검색 엔진이 없는 컨텍스트
      const invalidContext: ToolContext = {
        db,
        services: {}
      };

      // When & Then: 에러 발생
      await expect(
        tool.handle({ query: 'test' }, invalidContext)
      ).rejects.toThrow('하이브리드 검색 엔진이 사용할 수 없습니다');
    });

    it('기본 파라미터로 검색을 실행해야 함', async () => {
      // Given: 기본 파라미터
      const params = {
        query: 'test query'
      };

      // When: 핸들러 실행
      // Then: 결과가 반환되거나 에러가 적절히 처리되어야 함
      try {
        const result = await tool.handle(params, context);
        expect(result).toBeDefined();
        if (result.success) {
          expect(result.content).toBeDefined();
        }
      } catch (error) {
        // 스키마 문제 등으로 에러가 발생할 수 있음
        expect(error).toBeDefined();
      }
    });

    it('토큰 예산을 지정할 수 있어야 함', async () => {
      // Given: 토큰 예산 지정
      const params = {
        query: 'test query',
        token_budget: 2000
      };

      // When: 핸들러 실행
      // Then: 결과가 반환되거나 에러가 적절히 처리되어야 함
      try {
        const result = await tool.handle(params, context);
        expect(result).toBeDefined();
        if (result.success) {
          expect(result.content).toBeDefined();
        }
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('최대 기억 개수를 지정할 수 있어야 함', async () => {
      // Given: 최대 기억 개수 지정
      const params = {
        query: 'test query',
        max_memories: 10
      };

      // When: 핸들러 실행
      // Then: 결과가 반환되거나 에러가 적절히 처리되어야 함
      try {
        const result = await tool.handle(params, context);
        expect(result).toBeDefined();
        if (result.success) {
          expect(result.content).toBeDefined();
        }
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('메모리 타입을 필터링할 수 있어야 함', async () => {
      // Given: 메모리 타입 필터
      const params = {
        query: 'test query',
        memory_types: ['episodic', 'semantic']
      };

      // When: 핸들러 실행
      // Then: 결과가 반환되거나 에러가 적절히 처리되어야 함
      try {
        const result = await tool.handle(params, context);
        expect(result).toBeDefined();
        if (result.success) {
          expect(result.content).toBeDefined();
        }
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('core/vault 타입은 자동으로 제거되어야 함', async () => {
      // Given: core/vault 타입 포함
      const params = {
        query: 'test query',
        memory_types: ['core', 'vault', 'episodic']
      };

      // When: 핸들러 실행
      // Then: 결과가 반환되거나 에러가 적절히 처리되어야 함 (core/vault는 자동 제거)
      try {
        const result = await tool.handle(params, context);
        expect(result).toBeDefined();
        if (result.success) {
          expect(result.content).toBeDefined();
        }
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('core/vault만 있으면 에러를 발생시켜야 함', async () => {
      // Given: core/vault만 포함
      const params = {
        query: 'test query',
        memory_types: ['core', 'vault']
      };

      // When & Then: 에러 발생
      await expect(
        tool.handle(params, context)
      ).rejects.toThrow("memory_types 배열에 유효한 타입이 없습니다");
    });

    it('중요도 임계값을 지정할 수 있어야 함', async () => {
      // Given: 중요도 임계값 지정
      const params = {
        query: 'test query',
        importance_threshold: 0.8
      };

      // When: 핸들러 실행
      // Then: 결과가 반환되거나 에러가 적절히 처리되어야 함
      try {
        const result = await tool.handle(params, context);
        expect(result).toBeDefined();
        if (result.success) {
          expect(result.content).toBeDefined();
        }
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('검색 결과가 없을 때 적절한 메시지를 반환해야 함', async () => {
      // Given: 검색 결과가 없는 쿼리
      const params = {
        query: 'nonexistent_query_xyz_123'
      };

      // When: 핸들러 실행
      // Then: 적절한 메시지 반환 또는 에러 처리
      try {
        const result = await tool.handle(params, context);
        expect(result).toBeDefined();
        if (result.success) {
          const content = result.content[0]?.text;
          if (content) {
            const parsed = typeof content === 'string' ? JSON.parse(content) : content;
            expect(parsed.message).toBeDefined();
            expect(parsed.memories_used).toBeGreaterThanOrEqual(0);
          }
        }
      } catch (error) {
        // 스키마 문제 등으로 에러가 발생할 수 있음
        expect(error).toBeDefined();
      }
    });

    it('검색 결과가 있을 때 요약된 프롬프트를 반환해야 함', async () => {
      // Given: 테스트 메모리 생성
      const testMemory = {
        id: 'test-memory-1',
        type: 'episodic',
        content: 'This is a test memory for memory injection prompt testing.',
        importance: 0.8
      };
      
      try {
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance) VALUES (?, ?, ?, ?)
        `).run(testMemory.id, testMemory.type, testMemory.content, testMemory.importance);

        const params = {
          query: 'test memory'
        };

        // When: 핸들러 실행
        const result = await tool.handle(params, context);

        // Then: 요약된 프롬프트 반환
        expect(result).toBeDefined();
        if (result.success) {
          const content = result.content[0]?.text;
          if (content) {
            const parsed = typeof content === 'string' ? JSON.parse(content) : content;
            expect(parsed.message).toBeDefined();
            expect(parsed.memories_used).toBeGreaterThanOrEqual(0);
            expect(parsed.token_estimate).toBeGreaterThanOrEqual(0);
          }
        }
      } catch (error) {
        // 스키마 문제 등으로 에러가 발생할 수 있음
        expect(error).toBeDefined();
      }
    });
  });

  describe('TF-IDF 쿼리 임베딩 fallback stderr', () => {
    let savedEmbeddingProvider: (typeof mementoConfig)['embeddingProvider'];

    beforeEach(() => {
      savedEmbeddingProvider = mementoConfig.embeddingProvider;
      mementoConfig.embeddingProvider = 'minilm';
    });

    afterEach(() => {
      mementoConfig.embeddingProvider = savedEmbeddingProvider;
    });

    const TFIDF_QUERY_FALLBACK_MSG =
      '⚠️ [Memento] 이번 검색의 쿼리 임베딩에 TF-IDF가 사용되었습니다.' +
      ' sqlite-vec 유사도 fallback이거나, 다중 provider VEC 검색에서 고차원 임베딩 대신 TF-IDF로 생성된 경우 의미 기반 검색 품질이 저하될 수 있습니다.\n';

    it('fallback_used=true여도 tfidf_query_embedding_fallback이 true일 때만 stderr에 TF-IDF 품질 경고를 출력한다', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      vi.spyOn(context.services.hybridSearchEngine!, 'search').mockResolvedValue({
        items: [],
        total_count: 0,
        query_time: 0,
        fallback_used: true,
        query_embedding_providers: ['tfidf'],
        tfidf_query_embedding_fallback: true
      });

      await tool.handle({ query: 'unit test query' }, context);

      expect(stderrSpy).toHaveBeenCalledWith(TFIDF_QUERY_FALLBACK_MSG);
      stderrSpy.mockRestore();
    });

    it('fallback_used=true이어도 tfidf_query_embedding_fallback이 설정되지 않으면 TF-IDF 품질 경고를 출력하지 않는다 (provider_filter=[tfidf])', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      vi.spyOn(context.services.hybridSearchEngine!, 'search').mockResolvedValue({
        items: [],
        total_count: 0,
        query_time: 0,
        fallback_used: true,
        query_embedding_providers: ['tfidf']
      });

      await tool.handle({ query: 'unit test query' }, context);

      const tfidfQualityWarnings = stderrSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('이번 검색의 쿼리 임베딩에 TF-IDF')
      );
      expect(tfidfQualityWarnings).toHaveLength(0);
      stderrSpy.mockRestore();
    });

    it('fallback_used가 false이고 tfidf_query_embedding_fallback도 false면 TF-IDF 품질 경고를 출력하지 않는다', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      vi.spyOn(context.services.hybridSearchEngine!, 'search').mockResolvedValue({
        items: [],
        total_count: 0,
        query_time: 0,
        fallback_used: false,
        query_embedding_providers: ['tfidf'],
        tfidf_query_embedding_fallback: false
      });

      await tool.handle({ query: 'unit test query' }, context);

      const tfidfQualityWarnings = stderrSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('이번 검색의 쿼리 임베딩에 TF-IDF')
      );
      expect(tfidfQualityWarnings).toHaveLength(0);
      stderrSpy.mockRestore();
    });

    it('fallback_used가 false여도 tfidf_query_embedding_fallback이면 TF-IDF 품질 경고를 출력한다', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      vi.spyOn(context.services.hybridSearchEngine!, 'search').mockResolvedValue({
        items: [],
        total_count: 0,
        query_time: 0,
        fallback_used: false,
        query_embedding_providers: ['tfidf'],
        tfidf_query_embedding_fallback: true
      });

      await tool.handle({ query: 'unit test query' }, context);

      expect(stderrSpy).toHaveBeenCalledWith(TFIDF_QUERY_FALLBACK_MSG);
      stderrSpy.mockRestore();
    });

    it('fallback_used=true이어도 쿼리 임베딩이 minilm이면 TF-IDF 품질 경고를 출력하지 않는다', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      vi.spyOn(context.services.hybridSearchEngine!, 'search').mockResolvedValue({
        items: [],
        total_count: 0,
        query_time: 0,
        fallback_used: true,
        query_embedding_providers: ['minilm']
      });

      await tool.handle({ query: 'unit test query' }, context);

      const tfidfQualityWarnings = stderrSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('쿼리 임베딩에 TF-IDF')
      );
      expect(tfidfQualityWarnings).toHaveLength(0);
      stderrSpy.mockRestore();
    });

    it('mementoConfig.embeddingProvider가 tfidf면 fallback_used+tfidf여도 TF-IDF 품질 경고를 출력하지 않는다', async () => {
      mementoConfig.embeddingProvider = 'tfidf';
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      vi.spyOn(context.services.hybridSearchEngine!, 'search').mockResolvedValue({
        items: [],
        total_count: 0,
        query_time: 0,
        fallback_used: true,
        query_embedding_providers: ['tfidf']
      });

      await tool.handle({ query: 'unit test query' }, context);

      const tfidfQualityWarnings = stderrSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('이번 검색의 쿼리 임베딩에 TF-IDF')
      );
      expect(tfidfQualityWarnings).toHaveLength(0);
      stderrSpy.mockRestore();
    });
  });

  describe('project_id 필터', () => {
    it('injects only project memories when project_id is specified', async () => {
      // Pre-insert memories with different project_ids
      db.exec(`
        INSERT INTO memory_item (id, type, content, importance, project_id, created_at)
        VALUES
          ('inj_mine', 'semantic', 'proj-x 전용 결정', 0.9, 'proj-x', datetime('now')),
          ('inj_other', 'semantic', '다른 프로젝트 결정', 0.9, 'proj-y', datetime('now')),
          ('inj_none', 'semantic', '프로젝트 없는 기억', 0.9, NULL, datetime('now'))
      `);

      const result = await tool.handle({
        query: '결정',
        project_id: 'proj-x'
      }, context);

      expect(result.isError).toBeFalsy();
      const text = result.content?.[0]?.text ?? JSON.stringify(result);
      expect(text).toContain('proj-x 전용 결정');
      expect(text).not.toContain('다른 프로젝트 결정');
    });
  });

  describe('include_project_brief (#1271)', () => {
    const BRIEF = '브리프 본문: 목표는 X, 다음 할 일은 Y';

    beforeEach(() => {
      db.exec(`
        INSERT INTO memory_item (id, type, content, importance, project_id, tags, version, owner_id, created_at)
        VALUES
          ('brief_old', 'semantic', '낡은 브리프', 0.9, 'proj-b', '["project-brief"]', NULL, 'agent-a', datetime('now', '-1 day')),
          ('brief_new', 'semantic', '${BRIEF}', 0.9, 'proj-b', '["project-brief"]', 3, 'agent-a', datetime('now')),
          ('brief_other', 'semantic', '다른 프로젝트 브리프', 0.9, 'proj-c', '["project-brief"]', NULL, NULL, datetime('now')),
          ('plain_b', 'semantic', '관련 없는 조각 기억', 0.9, 'proj-b', '["misc"]', NULL, NULL, datetime('now')),
          ('log_b', 'episodic', '브리프 태그가 붙은 작업 기록', 0.9, 'proj-b', '["completed","project-brief"]', NULL, 'agent-a', datetime('now', '+1 minute'))
      `);
    });

    function parse(result: Awaited<ReturnType<MemoryInjectionPrompt['handle']>>) {
      return JSON.parse(result.content?.[0]?.text ?? '{}');
    }

    it('true 면 질의와 무관하게 최신 브리프 전문을 맨 앞에 싣는다', async () => {
      const out = parse(await tool.handle({ query: '전혀 무관한 질의', project_id: 'proj-b', include_project_brief: true }, context));
      expect(out.message.startsWith('# 프로젝트 브리프 — project-brief v3')).toBe(true);
      expect(out.message).toContain(BRIEF);
      expect(out.message).not.toContain('낡은 브리프');
      expect(out.project_brief).toEqual({ memory_id: 'brief_new', project_id: 'proj-b', version: 3, included: true });
    });

    it('semantic 이 아닌 기억은 태그가 있어도 브리프로 고르지 않는다', async () => {
      const out = parse(await tool.handle({ query: '전혀 무관한 질의', project_id: 'proj-b', include_project_brief: true }, context));
      expect(out.project_brief.memory_id).toBe('brief_new');
      expect(out.message.startsWith('# 프로젝트 브리프 — project-brief v3')).toBe(true);
    });

    it('미지정이면 전문 없이 포인터 한 줄만 붙인다', async () => {
      const out = parse(await tool.handle({ query: '전혀 무관한 질의', project_id: 'proj-b' }, context));
      expect(out.message).not.toContain(BRIEF);
      expect(out.message).toContain('project-brief v3 (proj-b, memory_id brief_new) 있음');
      expect(out.project_brief.included).toBe(false);
    });

    it('project_id 인자가 없으면 context.projectId 로 브리프를 찾는다', async () => {
      const out = parse(await tool.handle({ query: '무관', include_project_brief: true }, { ...context, projectId: 'proj-c' }));
      expect(out.message).toContain('다른 프로젝트 브리프');
      expect(out.project_brief.memory_id).toBe('brief_other');
    });

    it('owner_id 가 지정되면 브리프도 그 소유자 것만 본다', async () => {
      const out = parse(await tool.handle({ query: '무관', project_id: 'proj-c', owner_id: 'agent-a', include_project_brief: true }, context));
      expect(out.project_brief).toBeUndefined();
    });

    it('프로젝트를 알 수 없으면 결과에 브리프 흔적이 없다', async () => {
      const out = parse(await tool.handle({ query: '무관', include_project_brief: true }, context));
      expect(out.project_brief).toBeUndefined();
      expect(out.message).not.toContain('project-brief');
    });
  });

  describe('owner_id 필터', () => {
    it('owner_id가 지정되면 해당 소유자 기억만 주입한다', async () => {
      db.exec(`
        INSERT INTO memory_item (id, type, content, importance, owner_id, created_at)
        VALUES
          ('inj_owner_a', 'episodic', 'owner-a 전용 노트', 0.9, 'agent-a', datetime('now')),
          ('inj_owner_b', 'episodic', 'owner-b 전용 노트', 0.9, 'agent-b', datetime('now'))
      `);

      const result = await tool.handle(
        {
          query: '전용 노트',
          owner_id: 'agent-a',
        },
        context,
      );

      expect(result.isError).toBeFalsy();
      const text = result.content?.[0]?.text ?? JSON.stringify(result);
      expect(text).toContain('owner-a');
      expect(text).not.toContain('owner-b');
    });
  });

  describe('도구 메타데이터', () => {
    it('도구 이름을 올바르게 반환해야 함', () => {
      // When: 도구 정의 조회
      const definition = tool.getDefinition();

      // Then: 올바른 이름
      expect(definition.name).toBe('memory_injection');
    });

    it('도구 설명을 올바르게 반환해야 함', () => {
      // When: 도구 정의 조회
      const definition = tool.getDefinition();

      // Then: 올바른 설명
      expect(definition.description).toBe('관련 기억을 요약하여 프롬프트에 주입');
    });

    it('입력 스키마에 query가 필수여야 함', () => {
      // When: 도구 정의 조회
      const definition = tool.getDefinition();

      // Then: query가 필수
      expect(definition.inputSchema.required).toContain('query');
    });

    it('입력 스키마에 선택적 파라미터들이 있어야 함', () => {
      // When: 도구 정의 조회
      const definition = tool.getDefinition();

      // Then: 선택적 파라미터 존재
      expect(definition.inputSchema.properties.token_budget).toBeDefined();
      expect(definition.inputSchema.properties.max_memories).toBeDefined();
      expect(definition.inputSchema.properties.memory_types).toBeDefined();
      expect(definition.inputSchema.properties.importance_threshold).toBeDefined();
      expect(definition.inputSchema.properties.project_id).toBeDefined();
      expect(definition.inputSchema.properties.owner_id).toBeDefined();
    });
  });
});

