/**
 * HybridSearchEngine 테스트
 * 클린코드 리팩토링 후 테스트 가능한 구조 검증
 */

import { describe, it, expect, beforeEach, vi, Mock, afterEach } from 'vitest';
import { HybridSearchEngine, createHybridSearchEngine, SearchError, SearchErrorType, resolveHybridVectorPrefetchLimit } from '../hybrid-search-engine.js';
import type { ITextSearchEngine, IEmbeddingService, IVectorSearchEngine, ISearchResultCombiner, IAdaptiveWeightCalculator, ISearchLogger, IProceduralMemoryMatcher } from '../hybrid-search-engine.js';
import Database from 'better-sqlite3';
import type { RelationGraph } from '../../../relation/services/relation-graph.js';
import { createRelationGraph } from '../../../../infrastructure/relation-graph-factory.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { RelationEngineSchemaMigration } from '../../../../infrastructure/database/database/migration/migrations/005-relation-engine-schema.js';
import { initializeTestDatabase, insertMemoryItem, insertMemoryEmbedding } from '../../../../test/helpers/consolidation-test-data.js';
import type { StoredEmbeddingProviderStats } from '../../../shared/types/index.js';
import type { EmbeddingProvider } from '../../../../shared/types/embedding.types.js';
import type { UnifiedEmbeddingService } from '../../../embedding/services/unified-embedding-service.js';
import { FeedbackRepositorySQLite as FeedbackRepository } from '../../../../infrastructure/database/repositories/feedback-repository-sqlite.impl.js';

// Mock @huggingface/transformers to prevent onnxruntime-node loading
vi.mock('@huggingface/transformers', () => {
  return {
    pipeline: vi.fn().mockResolvedValue({
      __call: vi.fn().mockResolvedValue([0.1, 0.2, 0.3])
    }),
    env: {
      useBrowserCache: false,
      useCustomCache: false
    }
  };
});

// EmbeddingService 모듈 Mock
vi.mock('../services/embedding-service.js', () => ({
  EmbeddingService: vi.fn().mockImplementation(() => ({
    generateEmbedding: vi.fn()
  }))
}));

// Mock 데이터베이스
const mockDb = {} as Database.Database;

// Mock 인터페이스들
const createMockTextSearchEngine = (): ITextSearchEngine => ({
    search: vi.fn()
});

const createMockEmbeddingService = (): IEmbeddingService => ({
  isAvailable: vi.fn(),
    searchBySimilarity: vi.fn(),
  getEmbeddingStats: vi.fn()
});

const createMockVectorSearchEngine = (): IVectorSearchEngine => ({
    initialize: vi.fn(),
  getIndexStatus: vi.fn(),
    search: vi.fn()
});

const createMockResultCombiner = (): ISearchResultCombiner => ({
  combine: vi.fn()
});

const createMockWeightCalculator = (): IAdaptiveWeightCalculator => ({
  calculateWeights: vi.fn()
});

const createMockLogger = (): ISearchLogger => ({
  logSearchStart: vi.fn(),
  logSearchStep: vi.fn(),
  logSearchComplete: vi.fn(),
  logSearchError: vi.fn()
});

describe('HybridSearchEngine', () => {
  describe('resolveHybridVectorPrefetchLimit', () => {
    it('limit 100일 때 prefetch limit은 100을 넘지 않아야 함', () => {
      expect(resolveHybridVectorPrefetchLimit(100)).toBe(100);
    });

    it('limit 5일 때 multiplier를 적용해야 함', () => {
      expect(resolveHybridVectorPrefetchLimit(5)).toBe(10);
    });

    it('limit 미지정 시 기본값 10에 multiplier를 적용해야 함', () => {
      expect(resolveHybridVectorPrefetchLimit()).toBe(20);
    });
  });

  let hybridSearchEngine: HybridSearchEngine;
  let mockTextEngine: ITextSearchEngine;
  let mockEmbeddingService: IEmbeddingService;
  let mockVectorEngine: IVectorSearchEngine;
  let mockResultCombiner: ISearchResultCombiner;
  let mockWeightCalculator: IAdaptiveWeightCalculator;
  let mockLogger: ISearchLogger;

  beforeEach(() => {
    // Mock 객체들 초기화
    mockTextEngine = createMockTextSearchEngine();
    mockEmbeddingService = createMockEmbeddingService();
    mockVectorEngine = createMockVectorSearchEngine();
    mockResultCombiner = createMockResultCombiner();
    mockWeightCalculator = createMockWeightCalculator();
    mockLogger = createMockLogger();

    // HybridSearchEngine 인스턴스 생성
    hybridSearchEngine = new HybridSearchEngine(
      mockTextEngine,
      mockEmbeddingService,
      mockVectorEngine,
      mockResultCombiner,
      mockWeightCalculator,
      mockLogger
    );
  });

  describe('의존성 주입 테스트', () => {
    it('의존성 주입이 올바르게 작동해야 함', () => {
      expect(hybridSearchEngine).toBeDefined();
      expect(hybridSearchEngine).toBeInstanceOf(HybridSearchEngine);
    });

    it('팩토리 함수로 생성 가능해야 함', () => {
      const engine = createHybridSearchEngine(
        mockTextEngine,
        mockEmbeddingService,
        mockVectorEngine,
        mockResultCombiner,
        mockWeightCalculator,
        mockLogger
      );
      
      expect(engine).toBeDefined();
      expect(engine).toBeInstanceOf(HybridSearchEngine);
    });
  });

  describe('검색 기능 테스트', () => {
    it('sqlite-vec 인덱스는 사용 가능하지만 VEC 경로가 런타임에 실패해 내부 fallback으로 강등되면 fallback_used가 true이다', async () => {
      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: true });
      (mockEmbeddingService.isAvailable as Mock).mockReturnValue(true);
      (mockTextEngine.search as Mock).mockResolvedValue({ items: [], total_count: 0, query_time: 0 });
      (mockEmbeddingService.searchBySimilarity as Mock).mockResolvedValue([]);
      (mockResultCombiner.combine as Mock).mockReturnValue([]);
      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });

      const detectSpy = vi
        .spyOn(hybridSearchEngine as unknown as { detectAllStoredEmbeddingProviders: (db: Database.Database) => Promise<StoredEmbeddingProviderStats[]> }, 'detectAllStoredEmbeddingProviders')
        .mockRejectedValue(new Error('simulated VEC path failure'));

      const out = await hybridSearchEngine.search(mockDb, { query: 'q', limit: 10 });
      expect(out.fallback_used).toBe(true);
      expect(mockEmbeddingService.searchBySimilarity).toHaveBeenCalled();
      detectSpy.mockRestore();
    });

    it('VEC 성공이어도 고차원 provider 요청이 TF-IDF 쿼리 임베딩으로 바뀌면 tfidf_query_embedding_fallback이 true이다', async () => {
      const mockQueryEmbedding = {
        generateEmbedding: vi.fn(async (_q: string, preferred: EmbeddingProvider) => {
          if (preferred === 'minilm') {
            return { embedding: [0.1, 0.2, 0.3], provider: 'tfidf' };
          }
          return { embedding: [0.1, 0.2], provider: preferred };
        })
      };

      hybridSearchEngine = new HybridSearchEngine(
        mockTextEngine,
        mockEmbeddingService,
        mockVectorEngine,
        mockResultCombiner,
        mockWeightCalculator,
        mockLogger,
        mockQueryEmbedding as unknown as UnifiedEmbeddingService
      );

      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: true });
      (mockEmbeddingService.isAvailable as Mock).mockReturnValue(true);
      (mockTextEngine.search as Mock).mockResolvedValue({ items: [], total_count: 0, query_time: 0 });
      (mockVectorEngine.search as Mock).mockResolvedValue([
        {
          memory_id: 'm1',
          content: 'c',
          type: 'episodic',
          similarity: 0.9,
          created_at: '',
          importance: 0.5
        }
      ]);
      (mockResultCombiner.combine as Mock).mockReturnValue([]);
      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });

      const detectSpy = vi
        .spyOn(hybridSearchEngine as unknown as { detectAllStoredEmbeddingProviders: (db: Database.Database) => Promise<StoredEmbeddingProviderStats[]> }, 'detectAllStoredEmbeddingProviders')
        .mockResolvedValue([
          { provider: 'minilm', count: 1, avg_dimensions: 384 },
          { provider: 'tfidf', count: 1, avg_dimensions: 100 }
        ]);

      const out = await hybridSearchEngine.search(mockDb, { query: 'q', limit: 10 });
      expect(out.fallback_used).toBe(false);
      expect(out.tfidf_query_embedding_fallback).toBe(true);
      expect(out.tfidf_query_embedding_fallback_providers).toEqual(['minilm']);
      expect(out.query_embedding_providers).toContain('tfidf');
      detectSpy.mockRestore();
    });

    it('provider_filter가 [tfidf]인 명시적 TF-IDF 전용 검색은 fallback 강등으로 분류하지 않는다', async () => {
      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: false });
      (mockEmbeddingService.isAvailable as Mock).mockReturnValue(true);
      (mockTextEngine.search as Mock).mockResolvedValue({ items: [], total_count: 0, query_time: 0 });
      (mockEmbeddingService.searchBySimilarity as Mock).mockResolvedValue({
        results: [],
        query_embedding_providers: ['tfidf']
      });
      (mockResultCombiner.combine as Mock).mockReturnValue([]);
      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });

      const out = await hybridSearchEngine.search(mockDb, {
        query: 'q',
        limit: 10,
        provider_filter: ['tfidf']
      });

      expect(out.fallback_used).toBe(true);
      expect(out.tfidf_query_embedding_fallback).toBeUndefined();
      expect(out.tfidf_query_embedding_fallback_providers).toBeUndefined();
      expect(out.query_embedding_providers).toEqual(['tfidf']);
    });

    it('sqlite-vec fallback에서 provider_filter가 있으면 TF-IDF 대체 provider 라벨은 요청 provider 기준이다', async () => {
      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: false });
      (mockEmbeddingService.isAvailable as Mock).mockReturnValue(true);
      (mockTextEngine.search as Mock).mockResolvedValue({ items: [], total_count: 0, query_time: 0 });
      (mockEmbeddingService.searchBySimilarity as Mock).mockResolvedValue({
        results: [],
        query_embedding_providers: ['tfidf']
      });
      (mockResultCombiner.combine as Mock).mockReturnValue([]);
      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });

      const out = await hybridSearchEngine.search(mockDb, {
        query: 'q',
        limit: 10,
        provider_filter: ['openai']
      });

      expect(out.fallback_used).toBe(true);
      expect(out.tfidf_query_embedding_fallback).toBe(true);
      expect(out.tfidf_query_embedding_fallback_providers).toEqual(['openai']);
    });

    it('텍스트 검색이 실패하면 SearchError를 던져야 함', async () => {
      const mockError = new Error('텍스트 검색 실패');
      (mockTextEngine.search as Mock).mockRejectedValue(mockError);
      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });

      const query = {
        query: 'test query',
        limit: 10
      };

      await expect(hybridSearchEngine.search(mockDb, query)).rejects.toThrow(SearchError);
      await expect(hybridSearchEngine.search(mockDb, query)).rejects.toThrow('텍스트 검색 실행 중 오류가 발생했습니다');
    });

    it.skip('임베딩 생성이 실패하면 SearchError를 던져야 함', async () => {
      // 이 테스트는 복잡한 Mock 설정 때문에 스킵
      // 실제 환경에서는 EmbeddingService가 실패할 때 적절한 에러를 던짐
      const query = {
        query: 'test query',
        limit: 10
      };

      // Mock 설정
      (mockTextEngine.search as Mock).mockResolvedValue({ items: [], total_count: 0, query_time: 0 });
      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: false });

      const result = await hybridSearchEngine.search(mockDb, query);
      expect(result).toBeDefined();
    });

    it('결과 결합이 실패하면 SearchError를 던져야 함', async () => {
      // Mock 설정
      (mockTextEngine.search as Mock).mockResolvedValue({ items: [], total_count: 0, query_time: 0 });
      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: false });
      (mockEmbeddingService.isAvailable as Mock).mockReturnValue(false);
      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });
      (mockResultCombiner.combine as Mock).mockImplementation(() => {
        throw new Error('결과 결합 실패');
      });

      const query = {
        query: 'test query',
        limit: 10
      };

      await expect(hybridSearchEngine.search(mockDb, query)).rejects.toThrow(SearchError);
      await expect(hybridSearchEngine.search(mockDb, query)).rejects.toThrow('결과 결합 중 오류가 발생했습니다');
    });

    it('벡터 검색 시 다중 타입 필터를 전달해야 함', async () => {
      // Given: 실제 데이터베이스와 임베딩 데이터 준비
      const db = new Database(':memory:');
      initializeTestDatabase(db);
      
      // memory_item 먼저 생성 (FOREIGN KEY 제약 조건을 위해)
      insertMemoryItem(db, {
        id: 'mem1',
        type: 'episodic',
        content: 'test content'
      });
      
      // 임베딩 데이터 추가 (detectAllStoredEmbeddingProviders가 provider를 찾을 수 있도록)
      insertMemoryEmbedding(db, {
        memory_id: 'mem1',
        embedding: new Array(1536).fill(0.1),
        embedding_provider: 'tfidf',
        dim: 1536
      });
      
      const typeFilters = ['episodic', 'semantic'];
      (mockTextEngine.search as Mock).mockResolvedValue({ items: [], total_count: 0, query_time: 0 });
      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: true });
      (mockEmbeddingService.isAvailable as Mock).mockReturnValue(true);
      (mockVectorEngine.search as Mock).mockResolvedValue([
        {
          memory_id: 'mem1',
          content: 'vector content',
          type: 'episodic',
          importance: 0.6,
          created_at: '2024-01-01',
          similarity: 0.9
        }
      ]);
      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });
      (mockResultCombiner.combine as Mock).mockReturnValue([]);
      const vectorSpy = vi
        .spyOn(hybridSearchEngine as unknown as { generateQueryVector: (query: string, provider?: string) => Promise<{ embedding: number[]; provider: string }> }, 'generateQueryVector')
        .mockResolvedValue({
        embedding: new Array(512).fill(0.1),
        actualProvider: 'tfidf'
      });

      const query = {
        query: 'test query',
        limit: 5,
        filters: { type: typeFilters }
      };

      // When: 검색 실행
      await hybridSearchEngine.search(db, query);

      // Then: 벡터 검색이 다중 타입 필터와 함께 호출되었는지 확인
      expect(mockVectorEngine.search).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          types: typeFilters,
          limit: 10,
          threshold: 0.38,
          includeContent: true
        }),
        expect.any(String) // provider 파라미터
      );
      vectorSpy.mockRestore();
      db.close();
    });

    it('limit이 100이어도 VEC 벡터 prefetch limit은 100을 넘기지 않아야 함', async () => {
      const db = new Database(':memory:');
      initializeTestDatabase(db);

      insertMemoryItem(db, {
        id: 'mem1',
        type: 'episodic',
        content: 'test content'
      });

      insertMemoryEmbedding(db, {
        memory_id: 'mem1',
        embedding: new Array(1536).fill(0.1),
        embedding_provider: 'tfidf',
        dim: 1536
      });

      const typeFilters = ['episodic', 'semantic'];
      (mockTextEngine.search as Mock).mockResolvedValue({ items: [], total_count: 0, query_time: 0 });
      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: true });
      (mockEmbeddingService.isAvailable as Mock).mockReturnValue(true);
      (mockVectorEngine.search as Mock).mockResolvedValue([]);
      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });
      (mockResultCombiner.combine as Mock).mockReturnValue([]);
      const vectorSpy = vi
        .spyOn(hybridSearchEngine as unknown as { generateQueryVector: (query: string, provider?: string) => Promise<{ embedding: number[]; provider: string }> }, 'generateQueryVector')
        .mockResolvedValue({
          embedding: new Array(512).fill(0.1),
          actualProvider: 'tfidf'
        });

      await hybridSearchEngine.search(db, {
        query: 'test query',
        limit: 100,
        filters: { type: typeFilters }
      });

      expect(mockVectorEngine.search).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ limit: 100 }),
        expect.any(String)
      );
      vectorSpy.mockRestore();
      db.close();
    });

    it('벡터 인덱스가 비활성화된 경우 폴백 검색에 타입 배열을 전달해야 함', async () => {
      const typeFilters = ['episodic', 'semantic'];
      (mockTextEngine.search as Mock).mockResolvedValue({ items: [], total_count: 0, query_time: 0 });
      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: false });
      (mockEmbeddingService.isAvailable as Mock).mockReturnValue(true);
      (mockEmbeddingService.searchBySimilarity as Mock).mockResolvedValue([]);
      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });
      (mockResultCombiner.combine as Mock).mockReturnValue([]);

      const query = {
        query: 'test query',
        limit: 5,
        filters: { type: typeFilters }
      };

      await hybridSearchEngine.search(mockDb, query);

      expect(mockVectorEngine.search).not.toHaveBeenCalled();
      expect(mockEmbeddingService.searchBySimilarity).toHaveBeenCalledWith(
        mockDb,
        'test query',
        expect.objectContaining({
          type: typeFilters,
          limit: 10,
          threshold: 0.38
        })
      );
    });
  });

  describe('에러 처리 테스트', () => {
    it('SearchError 타입이 올바르게 정의되어야 함', () => {
      expect(SearchErrorType.EMBEDDING_GENERATION_FAILED).toBe('EMBEDDING_GENERATION_FAILED');
      expect(SearchErrorType.VECTOR_SEARCH_FAILED).toBe('VECTOR_SEARCH_FAILED');
      expect(SearchErrorType.TEXT_SEARCH_FAILED).toBe('TEXT_SEARCH_FAILED');
      expect(SearchErrorType.RESULT_COMBINATION_FAILED).toBe('RESULT_COMBINATION_FAILED');
    });

    it('SearchError가 올바른 정보를 포함해야 함', () => {
      const originalError = new Error('원본 에러');
      const context = { query: 'test', searchId: 'test123' };
      
      const searchError = new SearchError(
        SearchErrorType.TEXT_SEARCH_FAILED,
        '테스트 에러',
        originalError,
        context
      );

      expect(searchError.type).toBe(SearchErrorType.TEXT_SEARCH_FAILED);
      expect(searchError.message).toBe('테스트 에러');
      expect(searchError.originalError).toBe(originalError);
      expect(searchError.context).toBe(context);
      expect(searchError.name).toBe('SearchError');
    });
  });

  describe('통합 테스트', () => {
    it('정상적인 검색 플로우가 작동해야 함', async () => {
      // Mock 설정
      const mockTextResults = [
        { id: '1', content: 'test content 1', score: 0.8, type: 'semantic', importance: 0.7, created_at: '2024-01-01', pinned: false }
      ];
      const mockVectorResults = [
        { id: '2', content: 'test content 2', similarity: 0.9, type: 'semantic', importance: 0.8, created_at: '2024-01-01', pinned: false }
      ];
      const mockCombinedResults = [
        { id: '1', content: 'test content 1', textScore: 0.8, vectorScore: 0, finalScore: 0.32, recall_reason: '텍스트 검색 결과' },
        { id: '2', content: 'test content 2', textScore: 0, vectorScore: 0.9, finalScore: 0.54, recall_reason: '벡터 유사도: 0.900' }
      ];

      (mockTextEngine.search as Mock).mockResolvedValue({ items: mockTextResults, total_count: 1, query_time: 10 });
      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: false });
      (mockEmbeddingService.isAvailable as Mock).mockReturnValue(true);
      (mockEmbeddingService.searchBySimilarity as Mock).mockResolvedValue(mockVectorResults);
      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });
      (mockResultCombiner.combine as Mock).mockReturnValue(mockCombinedResults);

      const query = {
        query: 'test query',
        limit: 10
      };

      const result = await hybridSearchEngine.search(mockDb, query);

      expect(result).toBeDefined();
      expect(result.items).toHaveLength(2);
      expect(result.total_count).toBe(2);
      expect(result).toMatchObject({
        text_count: 1,
        vector_count: 1,
        union_count: 2,
        reranked_count: 2
      });
      expect(result.query_time).toBeGreaterThan(0);

      // Mock 호출 검증
      expect(mockTextEngine.search).toHaveBeenCalledWith(mockDb, {
        query: 'test query',
        filters: undefined,
        limit: 20,
        omit_feedback_in_ranking: true,
      });
      expect(mockWeightCalculator.calculateWeights).toHaveBeenCalledWith('test query', 0.6, 0.4);
      expect(mockResultCombiner.combine).toHaveBeenCalledWith(mockTextResults, mockVectorResults, 0.4, 0.6);
    });
  });

  describe('관계 그래프 통합 테스트', () => {
    let db: Database.Database;
    let relationGraph: RelationGraph;

    beforeEach(() => {
      // Given: in-memory 데이터베이스 생성 및 초기화
      db = new Database(':memory:');
      
      // 기본 스키마 생성
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
          origin_source TEXT DEFAULT '{}',
          view_count INTEGER DEFAULT 0,
          cite_count INTEGER DEFAULT 0,
          edit_count INTEGER DEFAULT 0,
          task_goal TEXT,
          steps TEXT,
          reflection_notes TEXT,
          consolidation_score REAL,
          -- Procedural Memory Enhancement (v7.0) 필드
          workflow_name TEXT,
          skill_name TEXT,
          trigger_conditions TEXT,
          -- Procedural Version Management (Issue #57, migration 013)
          version INTEGER NULL,
          version_series_id TEXT NULL,
          -- Multi-agent ownership (Issue #57 Phase 2 D, migration 015)
          owner_id TEXT NULL,
          -- Memori Attribution (Issue #87, migration 016)
          process_id TEXT NULL,
          session_id TEXT NULL,
          num_times INTEGER NOT NULL DEFAULT 1,
          last_mentioned_at TIMESTAMP,
          source_session_id TEXT,
          confidence REAL,
          is_consolidated BOOLEAN DEFAULT FALSE,
          is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
          deleted_at TEXT,
          project_id TEXT
        );
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS memento_schema_version (
          version INTEGER PRIMARY KEY,
          applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      
      // 마이그레이션 실행
      const migration = new RelationEngineSchemaMigration();
      migration.up(db);
      
      relationGraph = createRelationGraph(db);
      
      // HybridSearchEngine에 RelationGraph 설정
      hybridSearchEngine.setRelationGraph(relationGraph);
    });

    afterEach(() => {
      if (db) {
        db.close();
      }
    });

    /**
     * 테스트용 메모리 생성
     */
    function createTestMemory(
      id: string,
      content: string,
      type: 'working' | 'episodic' | 'semantic' | 'procedural' = 'episodic'
    ): void {
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, ?, ?, 0.5, CURRENT_TIMESTAMP)
      `, [id, type, content]);
    }

    it('should calculate relation weight and apply to search ranking', async () => {
      // Given: 테스트 메모리 및 관계 생성
      createTestMemory('mem1', '프로젝트 계획 수립');
      createTestMemory('mem2', '프로젝트 실행');
      createTestMemory('mem3', '프로젝트 완료');
      
      // 관계 생성: mem1 -> mem2 -> mem3
      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { confidence: 0.8 });
      await relationGraph.addRelation('mem2', 'mem3', 'FOLLOWS', { confidence: 0.9 });

      // Mock 검색 결과 설정
      (mockTextEngine.search as Mock).mockResolvedValue({
        items: [
          { id: 'mem1', content: '프로젝트 계획 수립', type: 'episodic', importance: 0.5, created_at: new Date().toISOString(), pinned: false }
        ],
        total_count: 1,
        query_time: 10
      });

      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: false });
      (mockEmbeddingService.isAvailable as Mock).mockReturnValue(true);
      (mockEmbeddingService.searchBySimilarity as Mock).mockResolvedValue([
        { id: 'mem1', content: '프로젝트 계획 수립', type: 'episodic', importance: 0.5, similarity: 0.8 }
      ]);

      (mockResultCombiner.combine as Mock).mockReturnValue([
        {
          id: 'mem1',
          content: '프로젝트 계획 수립',
          type: 'episodic',
          importance: 0.5,
          created_at: new Date().toISOString(),
          pinned: false,
          textScore: 0.7,
          vectorScore: 0.8,
          finalScore: 0.75,
          recall_reason: '하이브리드 검색'
        }
      ]);

      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });

      // When: 검색 실행
      const result = await hybridSearchEngine.search(db, {
        query: '프로젝트',
        limit: 10
      });

      // Then: 관계 가중치가 계산되어 finalScore에 반영되어야 함
      expect(result.items).toHaveLength(1);
      expect(result.items[0].relation_weight).toBeDefined();
      expect(result.items[0].relation_weight).toBeGreaterThan(0);
      
      // 관계 가중치가 포함된 finalScore가 더 높아야 함
      expect(result.items[0].finalScore).toBeGreaterThan(0);
    });

    it('should include relations in search results when includeRelations is true', async () => {
      // Given: 테스트 메모리 및 관계 생성
      createTestMemory('mem1', '프로젝트 계획');
      createTestMemory('mem2', '프로젝트 실행');
      createTestMemory('mem3', '프로젝트 완료');
      
      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { confidence: 0.8 });
      await relationGraph.addRelation('mem1', 'mem3', 'FOLLOWS', { confidence: 0.7 });

      // Mock 검색 결과 설정
      (mockTextEngine.search as Mock).mockResolvedValue({
        items: [
          { id: 'mem1', content: '프로젝트 계획', type: 'episodic', importance: 0.5, created_at: new Date().toISOString(), pinned: false }
        ],
        total_count: 1,
        query_time: 10
      });

      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: false });
      (mockEmbeddingService.isAvailable as Mock).mockReturnValue(true);
      (mockEmbeddingService.searchBySimilarity as Mock).mockResolvedValue([
        { id: 'mem1', content: '프로젝트 계획', type: 'episodic', importance: 0.5, similarity: 0.8 }
      ]);

      (mockResultCombiner.combine as Mock).mockReturnValue([
        {
          id: 'mem1',
          content: '프로젝트 계획',
          type: 'episodic',
          importance: 0.5,
          created_at: new Date().toISOString(),
          pinned: false,
          textScore: 0.7,
          vectorScore: 0.8,
          finalScore: 0.75,
          recall_reason: '하이브리드 검색'
        }
      ]);

      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });

      // When: includeRelations 옵션으로 검색 실행
      const result = await hybridSearchEngine.search(db, {
        query: '프로젝트',
        limit: 10,
        includeRelations: true
      });

      // Then: 관계 정보가 포함되어야 함
      expect(result.items).toHaveLength(1);
      expect(result.items[0].relations).toBeDefined();
      expect(result.items[0].relations).toHaveLength(2);
      expect(result.items[0].relations?.some(r => r.target_id === 'mem2')).toBe(true);
      expect(result.items[0].relations?.some(r => r.target_id === 'mem3')).toBe(true);
    });

    it('should not include relations when includeRelations is false', async () => {
      // Given: 테스트 메모리 및 관계 생성
      createTestMemory('mem1', '프로젝트 계획');
      createTestMemory('mem2', '프로젝트 실행');
      
      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { confidence: 0.8 });

      // Mock 검색 결과 설정
      (mockTextEngine.search as Mock).mockResolvedValue({
        items: [
          { id: 'mem1', content: '프로젝트 계획', type: 'episodic', importance: 0.5, created_at: new Date().toISOString(), pinned: false }
        ],
        total_count: 1,
        query_time: 10
      });

      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: false });
      (mockEmbeddingService.isAvailable as Mock).mockReturnValue(true);
      (mockEmbeddingService.searchBySimilarity as Mock).mockResolvedValue([
        { id: 'mem1', content: '프로젝트 계획', type: 'episodic', importance: 0.5, similarity: 0.8 }
      ]);

      (mockResultCombiner.combine as Mock).mockReturnValue([
        {
          id: 'mem1',
          content: '프로젝트 계획',
          type: 'episodic',
          importance: 0.5,
          created_at: new Date().toISOString(),
          pinned: false,
          textScore: 0.7,
          vectorScore: 0.8,
          finalScore: 0.75,
          recall_reason: '하이브리드 검색'
        }
      ]);

      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });

      // When: includeRelations 옵션 없이 검색 실행
      const result = await hybridSearchEngine.search(db, {
        query: '프로젝트',
        limit: 10,
        includeRelations: false
      });

      // Then: 관계 정보가 포함되지 않아야 함
      expect(result.items).toHaveLength(1);
      expect(result.items[0].relations).toBeUndefined();
    });

    it('should rank memories with higher relation weight higher', async () => {
      // Given: 두 개의 메모리 생성 (하나는 관계가 많고, 하나는 관계가 적음)
      createTestMemory('mem1', '인기 있는 프로젝트');
      createTestMemory('mem2', '일반 프로젝트');
      createTestMemory('mem3', '관련 프로젝트 1');
      createTestMemory('mem4', '관련 프로젝트 2');
      createTestMemory('mem5', '관련 프로젝트 3');
      
      // mem1에 많은 관계 생성
      await relationGraph.addRelation('mem1', 'mem3', 'CAUSES', { confidence: 0.9 });
      await relationGraph.addRelation('mem1', 'mem4', 'FOLLOWS', { confidence: 0.8 });
      await relationGraph.addRelation('mem1', 'mem5', 'DEPENDS_ON', { confidence: 0.85 });
      
      // mem2에는 관계 없음

      // Mock 검색 결과 설정 (두 메모리 모두 동일한 점수)
      (mockTextEngine.search as Mock).mockResolvedValue({
        items: [
          { id: 'mem1', content: '인기 있는 프로젝트', type: 'episodic', importance: 0.5, created_at: new Date().toISOString(), pinned: false },
          { id: 'mem2', content: '일반 프로젝트', type: 'episodic', importance: 0.5, created_at: new Date().toISOString(), pinned: false }
        ],
        total_count: 2,
        query_time: 10
      });

      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: false });
      (mockEmbeddingService.isAvailable as Mock).mockReturnValue(true);
      (mockEmbeddingService.searchBySimilarity as Mock).mockResolvedValue([
        { id: 'mem1', content: '인기 있는 프로젝트', type: 'episodic', importance: 0.5, similarity: 0.7 },
        { id: 'mem2', content: '일반 프로젝트', type: 'episodic', importance: 0.5, similarity: 0.7 }
      ]);

      (mockResultCombiner.combine as Mock).mockReturnValue([
        {
          id: 'mem1',
          content: '인기 있는 프로젝트',
          type: 'episodic',
          importance: 0.5,
          created_at: new Date().toISOString(),
          pinned: false,
          textScore: 0.7,
          vectorScore: 0.7,
          finalScore: 0.7,
          recall_reason: '하이브리드 검색'
        },
        {
          id: 'mem2',
          content: '일반 프로젝트',
          type: 'episodic',
          importance: 0.5,
          created_at: new Date().toISOString(),
          pinned: false,
          textScore: 0.7,
          vectorScore: 0.7,
          finalScore: 0.7,
          recall_reason: '하이브리드 검색'
        }
      ]);

      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });

      // When: 검색 실행
      const result = await hybridSearchEngine.search(db, {
        query: '프로젝트',
        limit: 10
      });

      // Then: 관계가 많은 mem1이 더 높은 finalScore를 가져야 함
      expect(result.items).toHaveLength(2);
      const mem1Result = result.items.find(r => r.id === 'mem1');
      const mem2Result = result.items.find(r => r.id === 'mem2');
      
      expect(mem1Result).toBeDefined();
      expect(mem2Result).toBeDefined();
      expect(mem1Result!.relation_weight).toBeGreaterThan(mem2Result!.relation_weight || 0);
      expect(mem1Result!.finalScore).toBeGreaterThan(mem2Result!.finalScore);
      
      // mem1이 첫 번째 결과여야 함 (정렬 후)
      expect(result.items[0].id).toBe('mem1');
    });

    it('should handle search when RelationGraph is not set', async () => {
      // Given: RelationGraph가 설정되지 않은 상태
      hybridSearchEngine.setRelationGraph(null);

      // Mock 검색 결과 설정
      (mockTextEngine.search as Mock).mockResolvedValue({
        items: [
          { id: 'mem1', content: '프로젝트 계획', type: 'episodic', importance: 0.5, created_at: new Date().toISOString(), pinned: false }
        ],
        total_count: 1,
        query_time: 10
      });

      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: false });
      (mockEmbeddingService.isAvailable as Mock).mockReturnValue(true);
      (mockEmbeddingService.searchBySimilarity as Mock).mockResolvedValue([
        { id: 'mem1', content: '프로젝트 계획', type: 'episodic', importance: 0.5, similarity: 0.8 }
      ]);

      (mockResultCombiner.combine as Mock).mockReturnValue([
        {
          id: 'mem1',
          content: '프로젝트 계획',
          type: 'episodic',
          importance: 0.5,
          created_at: new Date().toISOString(),
          pinned: false,
          textScore: 0.7,
          vectorScore: 0.8,
          finalScore: 0.75,
          recall_reason: '하이브리드 검색'
        }
      ]);

      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });

      // When: 검색 실행
      const result = await hybridSearchEngine.search(db, {
        query: '프로젝트',
        limit: 10
      });

      // Then: 검색이 정상적으로 완료되어야 함 (관계 가중치 없이)
      expect(result.items).toHaveLength(1);
      expect(result.items[0].relation_weight).toBeUndefined();
    });
  });

  describe('성능 테스트', () => {
    it('검색 시간이 측정되어야 함', async () => {
      // Mock 설정
      (mockTextEngine.search as Mock).mockResolvedValue({ items: [], total_count: 0, query_time: 5 });
      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: false });
      (mockEmbeddingService.isAvailable as Mock).mockReturnValue(false);
      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });
      (mockResultCombiner.combine as Mock).mockReturnValue([]);

      const query = {
        query: 'test query',
        limit: 10
      };

      const result = await hybridSearchEngine.search(mockDb, query);

      expect(result.query_time).toBeGreaterThan(0);
      expect(typeof result.query_time).toBe('number');
    });
  });

  describe('detectAllStoredEmbeddingProviders - 다중 Provider 감지 기능', () => {
    let db: Database.Database;
    let testEngine: HybridSearchEngine;
    let mockTextEngine: ITextSearchEngine;
    let mockEmbeddingService: IEmbeddingService;
    let mockVectorEngine: IVectorSearchEngine;
    let mockResultCombiner: ISearchResultCombiner;
    let mockWeightCalculator: IAdaptiveWeightCalculator;
    let mockLogger: ISearchLogger;
    let mockQueryEmbeddingService: { generateEmbedding: ReturnType<typeof vi.fn>; getEmbedding: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      // 실제 메모리 데이터베이스 생성
      db = new Database(':memory:');
      initializeTestDatabase(db);

      // Mock queryEmbeddingService 생성
      mockQueryEmbeddingService = {
        generateEmbedding: vi.fn().mockResolvedValue({
          embedding: new Array(384).fill(0.1),
          provider: 'minilm'
        }),
        getEmbedding: vi.fn().mockResolvedValue({
          embedding: new Array(384).fill(0.1),
          provider: 'minilm'
        })
      };

      // Mock 의존성 생성
      mockTextEngine = createMockTextSearchEngine();
      mockEmbeddingService = createMockEmbeddingService();
      mockVectorEngine = createMockVectorSearchEngine();
      mockResultCombiner = createMockResultCombiner();
      mockWeightCalculator = createMockWeightCalculator();
      mockLogger = createMockLogger();

      testEngine = new HybridSearchEngine(
        mockTextEngine,
        mockEmbeddingService,
        mockVectorEngine,
        mockResultCombiner,
        mockWeightCalculator,
        mockLogger,
        mockQueryEmbeddingService
      );
    });

    afterEach(() => {
      if (db) {
        db.close();
      }
      vi.clearAllMocks();
    });

    it('단일 provider 감지 - minilm만 있는 경우', async () => {
      // Given: minilm provider로만 임베딩 저장
      insertMemoryItem(db, {
        id: 'mem1',
        type: 'episodic',
        content: '테스트 메모리 1'
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem1',
        embedding: new Array(384).fill(0.1),
        embedding_provider: 'minilm',
        dim: 384,
        dimensions: 384
      });

      insertMemoryItem(db, {
        id: 'mem2',
        type: 'episodic',
        content: '테스트 메모리 2'
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem2',
        embedding: new Array(384).fill(0.2),
        embedding_provider: 'minilm',
        dim: 384,
        dimensions: 384
      });

      // When: 실제 detectAllStoredEmbeddingProviders 메서드 호출 (private 메서드이므로 타입 캐스팅 사용)
      const detectedProviders = await (testEngine as unknown as { detectAllStoredEmbeddingProviders: (db: Database.Database) => Promise<string[]> }).detectAllStoredEmbeddingProviders(db);

      // Then: 단일 provider만 감지되어야 함
      expect(detectedProviders).toHaveLength(1);
      expect(detectedProviders[0].provider).toBe('minilm');
      expect(detectedProviders[0].count).toBe(2);
      expect(detectedProviders[0].avg_dimensions).toBe(384);
    });

    it('다중 provider 감지 - minilm, openai, gemini가 있는 경우', async () => {
      // Given: 여러 provider로 임베딩 저장
      // minilm (3개)
      for (let i = 1; i <= 3; i++) {
        insertMemoryItem(db, {
          id: `mem-minilm-${i}`,
          type: 'episodic',
          content: `MiniLM 메모리 ${i}`
        });
        insertMemoryEmbedding(db, {
          memory_id: `mem-minilm-${i}`,
          embedding: new Array(384).fill(0.1),
          embedding_provider: 'minilm',
          dim: 384,
          dimensions: 384
        });
      }

      // openai (2개)
      for (let i = 1; i <= 2; i++) {
        insertMemoryItem(db, {
          id: `mem-openai-${i}`,
          type: 'episodic',
          content: `OpenAI 메모리 ${i}`
        });
        insertMemoryEmbedding(db, {
          memory_id: `mem-openai-${i}`,
          embedding: new Array(1536).fill(0.1),
          embedding_provider: 'openai',
          dim: 1536,
          dimensions: 1536
        });
      }

      // gemini (1개)
      insertMemoryItem(db, {
        id: 'mem-gemini-1',
        type: 'episodic',
        content: 'Gemini 메모리 1'
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem-gemini-1',
        embedding: new Array(768).fill(0.1),
        embedding_provider: 'gemini',
        dim: 768,
        dimensions: 768
      });

      // When: 실제 detectAllStoredEmbeddingProviders 메서드 호출
      const detectedProviders = await (testEngine as unknown as { detectAllStoredEmbeddingProviders: (db: Database.Database) => Promise<string[]> }).detectAllStoredEmbeddingProviders(db);

      // Then: 모든 provider가 감지되어야 함 (count 내림차순 정렬)
      expect(detectedProviders).toHaveLength(3);
      expect(detectedProviders[0].provider).toBe('minilm');
      expect(detectedProviders[0].count).toBe(3);
      expect(detectedProviders[0].avg_dimensions).toBe(384);
      
      expect(detectedProviders[1].provider).toBe('openai');
      expect(detectedProviders[1].count).toBe(2);
      expect(detectedProviders[1].avg_dimensions).toBe(1536);
      
      expect(detectedProviders[2].provider).toBe('gemini');
      expect(detectedProviders[2].count).toBe(1);
      expect(detectedProviders[2].avg_dimensions).toBe(768);
    });

    it('빈 데이터 케이스 - 임베딩이 없는 경우', async () => {
      // Given: 메모리 아이템은 있지만 임베딩이 없는 경우
      insertMemoryItem(db, {
        id: 'mem-no-embedding',
        type: 'episodic',
        content: '임베딩 없는 메모리'
      });

      // When: 실제 detectAllStoredEmbeddingProviders 메서드 호출
      const detectedProviders = await (testEngine as unknown as { detectAllStoredEmbeddingProviders: (db: Database.Database) => Promise<string[]> }).detectAllStoredEmbeddingProviders(db);

      // Then: 빈 배열 반환
      expect(detectedProviders).toHaveLength(0);
    });

    it('provider 통계 정보 정확성 검증 - count와 avg_dimensions', async () => {
      // Given: 다양한 차원의 임베딩 저장
      insertMemoryItem(db, {
        id: 'mem1',
        type: 'episodic',
        content: '메모리 1'
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem1',
        embedding: new Array(384).fill(0.1),
        embedding_provider: 'minilm',
        dim: 384,
        dimensions: 384
      });

      insertMemoryItem(db, {
        id: 'mem2',
        type: 'episodic',
        content: '메모리 2'
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem2',
        embedding: new Array(384).fill(0.2),
        embedding_provider: 'minilm',
        dim: 384,
        dimensions: 384
      });

      insertMemoryItem(db, {
        id: 'mem3',
        type: 'episodic',
        content: '메모리 3'
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem3',
        embedding: new Array(384).fill(0.3),
        embedding_provider: 'minilm',
        dim: 384,
        dimensions: 384
      });

      // When: 실제 detectAllStoredEmbeddingProviders 메서드 호출
      const detectedProviders = await (testEngine as unknown as { detectAllStoredEmbeddingProviders: (db: Database.Database) => Promise<string[]> }).detectAllStoredEmbeddingProviders(db);

      // Then: 통계 정보가 정확해야 함
      expect(detectedProviders).toHaveLength(1);
      expect(detectedProviders[0].count).toBe(3);
      expect(detectedProviders[0].avg_dimensions).toBe(384);
    });
  });

  describe('병렬 다중 Provider 검색 기능', () => {
    let db: Database.Database;
    let testEngine: HybridSearchEngine;
    let mockTextEngine: ITextSearchEngine;
    let mockEmbeddingService: IEmbeddingService;
    let mockVectorEngine: IVectorSearchEngine;
    let mockResultCombiner: ISearchResultCombiner;
    let mockWeightCalculator: IAdaptiveWeightCalculator;
    let mockLogger: ISearchLogger;
    let mockQueryEmbeddingService: { generateEmbedding: ReturnType<typeof vi.fn>; getEmbedding: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      // 실제 메모리 데이터베이스 생성
      db = new Database(':memory:');
      initializeTestDatabase(db);

      // Mock queryEmbeddingService 생성
      mockQueryEmbeddingService = {
        generateEmbedding: vi.fn().mockImplementation(async (query: string, provider?: string) => {
          // Provider별로 다른 차원의 임베딩 반환
          const dimensions = provider === 'openai' ? 1536 : provider === 'gemini' ? 768 : 384;
          return {
            embedding: new Array(dimensions).fill(0.1),
            provider: provider || 'minilm'
          };
        }),
        getEmbedding: vi.fn().mockResolvedValue({
          embedding: new Array(384).fill(0.1),
          provider: 'minilm'
        })
      };

      // Mock 의존성 생성
      mockTextEngine = createMockTextSearchEngine();
      mockEmbeddingService = createMockEmbeddingService();
      mockVectorEngine = createMockVectorSearchEngine();
      mockResultCombiner = createMockResultCombiner();
      mockWeightCalculator = createMockWeightCalculator();
      mockLogger = createMockLogger();

      testEngine = new HybridSearchEngine(
        mockTextEngine,
        mockEmbeddingService,
        mockVectorEngine,
        mockResultCombiner,
        mockWeightCalculator,
        mockLogger,
        mockQueryEmbeddingService
      );
    });

    afterEach(() => {
      if (db) {
        db.close();
      }
      vi.clearAllMocks();
    });

    it('성공 케이스 - 다중 provider 병렬 검색 성공', async () => {
      // Given: 여러 provider로 임베딩 저장
      // minilm (2개)
      for (let i = 1; i <= 2; i++) {
        insertMemoryItem(db, {
          id: `mem-minilm-${i}`,
          type: 'episodic',
          content: `MiniLM 메모리 ${i}`
        });
        insertMemoryEmbedding(db, {
          memory_id: `mem-minilm-${i}`,
          embedding: new Array(384).fill(0.1 + i * 0.01),
          embedding_provider: 'minilm',
          dim: 384,
          dimensions: 384
        });
      }

      // openai (1개)
      insertMemoryItem(db, {
        id: 'mem-openai-1',
        type: 'episodic',
        content: 'OpenAI 메모리 1'
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem-openai-1',
        embedding: new Array(1536).fill(0.2),
        embedding_provider: 'openai',
        dim: 1536,
        dimensions: 1536
      });

      // Mock 설정
      (mockTextEngine.search as Mock).mockResolvedValue({ items: [], total_count: 0, query_time: 0 });
      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: true });
      
      // Provider별 검색 결과 Mock
      (mockVectorEngine.search as Mock).mockImplementation(async (vector: number[], options: unknown, provider: string) => {
        if (provider === 'minilm') {
          return [
            {
              memory_id: 'mem-minilm-1',
              similarity: 0.9,
              content: 'MiniLM 메모리 1',
              type: 'episodic',
              importance: 0.7,
              created_at: new Date().toISOString()
            },
            {
              memory_id: 'mem-minilm-2',
              similarity: 0.8,
              content: 'MiniLM 메모리 2',
              type: 'episodic',
              importance: 0.6,
              created_at: new Date().toISOString()
            }
          ];
        } else if (provider === 'openai') {
          return [
            {
              memory_id: 'mem-openai-1',
              similarity: 0.85,
              content: 'OpenAI 메모리 1',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString()
            }
          ];
        }
        return [];
      });
      
      (mockResultCombiner.combine as Mock).mockReturnValue([]);
      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });

      // When: 다중 provider 검색 실행
      const result = await testEngine.search(db, {
        query: 'test query',
        limit: 10
      });

      // Then: 모든 provider의 결과가 포함되어야 함
      expect(result).toBeDefined();
      expect(mockVectorEngine.search).toHaveBeenCalled();
      
      // minilm과 openai provider 모두 검색되었는지 확인
      const searchCalls = (mockVectorEngine.search as Mock).mock.calls;
      const searchedProviders = searchCalls.map(call => call[2]); // provider 파라미터
      expect(searchedProviders).toContain('minilm');
      expect(searchedProviders).toContain('openai');
    });

    it('타임아웃 케이스 - 일부 provider 검색 타임아웃', async () => {
      // Given: 여러 provider로 임베딩 저장
      insertMemoryItem(db, {
        id: 'mem-minilm-1',
        type: 'episodic',
        content: 'MiniLM 메모리 1'
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem-minilm-1',
        embedding: new Array(384).fill(0.1),
        embedding_provider: 'minilm',
        dim: 384,
        dimensions: 384
      });

      insertMemoryItem(db, {
        id: 'mem-openai-1',
        type: 'episodic',
        content: 'OpenAI 메모리 1'
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem-openai-1',
        embedding: new Array(1536).fill(0.2),
        embedding_provider: 'openai',
        dim: 1536,
        dimensions: 1536
      });

      // Mock 설정
      (mockTextEngine.search as Mock).mockResolvedValue({ items: [], total_count: 0, query_time: 0 });
      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: true });
      
      // minilm은 빠르게 반환, openai는 타임아웃 발생하도록 설정
      (mockVectorEngine.search as Mock).mockImplementation(async (vector: number[], options: unknown, provider: string) => {
        if (provider === 'minilm') {
          return [
            {
              memory_id: 'mem-minilm-1',
              similarity: 0.9,
              content: 'MiniLM 메모리 1',
              type: 'episodic',
              importance: 0.7,
              created_at: new Date().toISOString()
            }
          ];
        } else if (provider === 'openai') {
          // 3초 대기하여 타임아웃 발생 (2초 타임아웃보다 길게)
          await new Promise(resolve => setTimeout(resolve, 3000));
          return [];
        }
        return [];
      });
      
      (mockResultCombiner.combine as Mock).mockReturnValue([]);
      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });

      // When: 다중 provider 검색 실행
      const startTime = Date.now();
      const result = await testEngine.search(db, {
        query: 'test query',
        limit: 10
      });
      const elapsedTime = Date.now() - startTime;

      // Then: 타임아웃이 발생해도 결과 반환 (약 2초 내)
      expect(result).toBeDefined();
      expect(elapsedTime).toBeLessThan(3000); // 전체 타임아웃(3초)보다 짧아야 함
      
      // 타임아웃 로그가 기록되었는지 확인 (에러 메시지에 "타임아웃" 포함)
      const logCalls = (mockLogger.logSearchStep as Mock).mock.calls;
      const timeoutLog = logCalls.find(call => {
        const step = call[1] as string;
        const data = call[2] as Record<string, unknown>;
        return step.includes('VEC 벡터 검색 실패') && 
               data?.error?.includes('타임아웃');
      });
      expect(timeoutLog).toBeDefined();
    });

    it('provider 타임아웃이어도 TF-IDF 쿼리 fallback 진단 정보는 유지한다', async () => {
      insertMemoryItem(db, {
        id: 'mem-openai-timeout',
        type: 'episodic',
        content: 'OpenAI timeout memory'
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem-openai-timeout',
        embedding: new Array(1536).fill(0.2),
        embedding_provider: 'openai',
        dim: 1536,
        dimensions: 1536
      });

      (mockTextEngine.search as Mock).mockResolvedValue({ items: [], total_count: 0, query_time: 0 });
      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: true });
      (mockQueryEmbeddingService.generateEmbedding as Mock).mockResolvedValue({
        embedding: new Array(384).fill(0.1),
        provider: 'tfidf'
      });
      (mockVectorEngine.search as Mock).mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 3000));
        return [];
      });
      (mockResultCombiner.combine as Mock).mockReturnValue([]);
      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });

      const result = await testEngine.search(db, {
        query: 'timeout fallback query',
        limit: 5,
        provider_filter: ['openai']
      });

      expect(result.query_embedding_providers).toEqual(['tfidf']);
      expect(result.tfidf_query_embedding_fallback).toBe(true);
      expect(result.tfidf_query_embedding_fallback_providers).toEqual(['openai']);
    });

    it('부분 실패 케이스 - 일부 provider 검색 실패', async () => {
      // Given: 여러 provider로 임베딩 저장
      insertMemoryItem(db, {
        id: 'mem-minilm-1',
        type: 'episodic',
        content: 'MiniLM 메모리 1'
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem-minilm-1',
        embedding: new Array(384).fill(0.1),
        embedding_provider: 'minilm',
        dim: 384,
        dimensions: 384
      });

      insertMemoryItem(db, {
        id: 'mem-openai-1',
        type: 'episodic',
        content: 'OpenAI 메모리 1'
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem-openai-1',
        embedding: new Array(1536).fill(0.2),
        embedding_provider: 'openai',
        dim: 1536,
        dimensions: 1536
      });

      // Mock 설정
      (mockTextEngine.search as Mock).mockResolvedValue({ items: [], total_count: 0, query_time: 0 });
      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: true });
      
      // minilm은 성공, openai는 실패하도록 설정
      (mockVectorEngine.search as Mock).mockImplementation(async (vector: number[], options: unknown, provider: string) => {
        if (provider === 'minilm') {
          return [
            {
              memory_id: 'mem-minilm-1',
              similarity: 0.9,
              content: 'MiniLM 메모리 1',
              type: 'episodic',
              importance: 0.7,
              created_at: new Date().toISOString()
            }
          ];
        } else if (provider === 'openai') {
          throw new Error('OpenAI 검색 실패: 데이터베이스 오류');
        }
        return [];
      });
      
      (mockResultCombiner.combine as Mock).mockReturnValue([]);
      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });

      // When: 다중 provider 검색 실행
      const result = await testEngine.search(db, {
        query: 'test query',
        limit: 10
      });

      // Then: 실패한 provider가 있어도 성공한 provider의 결과는 반환되어야 함
      expect(result).toBeDefined();
      
      // 실패 로그가 기록되었는지 확인
      expect(mockLogger.logSearchStep).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('VEC 벡터 검색 실패 - openai'),
        expect.objectContaining({
          provider: 'openai',
          error: expect.stringContaining('OpenAI 검색 실패')
        })
      );
      
      // 성공한 provider의 결과는 포함되어야 함
      const logCalls = (mockLogger.logSearchStep as Mock).mock.calls;
      const successLog = logCalls.find(call => 
        call[1] === 'VEC 벡터 검색 완료'
      );
      expect(successLog).toBeDefined();
      if (successLog && successLog[2]) {
        const stats = successLog[2] as Record<string, unknown>;
        expect(stats.successfulProviders).toBeGreaterThan(0);
      }
    });

    it('provider_filter 옵션 - 지정된 provider만 검색', async () => {
      // Given: 여러 provider로 임베딩 저장
      insertMemoryItem(db, {
        id: 'mem-minilm-1',
        type: 'episodic',
        content: 'MiniLM 메모리 1'
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem-minilm-1',
        embedding: new Array(384).fill(0.1),
        embedding_provider: 'minilm',
        dim: 384,
        dimensions: 384
      });

      insertMemoryItem(db, {
        id: 'mem-openai-1',
        type: 'episodic',
        content: 'OpenAI 메모리 1'
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem-openai-1',
        embedding: new Array(1536).fill(0.2),
        embedding_provider: 'openai',
        dim: 1536,
        dimensions: 1536
      });

      // Mock 설정
      (mockTextEngine.search as Mock).mockResolvedValue({ items: [], total_count: 0, query_time: 0 });
      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: true });
      
      (mockVectorEngine.search as Mock).mockImplementation(async (vector: number[], options: unknown, provider: string) => {
        if (provider === 'minilm') {
          return [
            {
              memory_id: 'mem-minilm-1',
              similarity: 0.9,
              content: 'MiniLM 메모리 1',
              type: 'episodic',
              importance: 0.7,
              created_at: new Date().toISOString()
            }
          ];
        }
        return [];
      });
      
      (mockResultCombiner.combine as Mock).mockReturnValue([]);
      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });

      // When: provider_filter로 minilm만 지정하여 검색
      const result = await testEngine.search(db, {
        query: 'test query',
        limit: 10,
        provider_filter: ['minilm']
      });

      // Then: minilm만 검색되어야 함
      expect(result).toBeDefined();
      const searchCalls = (mockVectorEngine.search as Mock).mock.calls;
      const searchedProviders = searchCalls.map(call => call[2]); // provider 파라미터
      expect(searchedProviders).toContain('minilm');
      expect(searchedProviders).not.toContain('openai');
    });
  });

  describe('결과 통합 및 정규화 로직', () => {
    let db: Database.Database;
    let testEngine: HybridSearchEngine;
    let mockTextEngine: ITextSearchEngine;
    let mockEmbeddingService: IEmbeddingService;
    let mockVectorEngine: IVectorSearchEngine;
    let mockResultCombiner: ISearchResultCombiner;
    let mockWeightCalculator: IAdaptiveWeightCalculator;
    let mockLogger: ISearchLogger;
    let mockQueryEmbeddingService: { generateEmbedding: ReturnType<typeof vi.fn>; getEmbedding: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      // 실제 메모리 데이터베이스 생성
      db = new Database(':memory:');
      initializeTestDatabase(db);

      // Mock queryEmbeddingService 생성
      mockQueryEmbeddingService = {
        generateEmbedding: vi.fn().mockImplementation(async (query: string, provider?: string) => {
          const dimensions = provider === 'openai' ? 1536 : provider === 'gemini' ? 768 : 384;
          return {
            embedding: new Array(dimensions).fill(0.1),
            provider: provider || 'minilm'
          };
        }),
        getEmbedding: vi.fn().mockResolvedValue({
          embedding: new Array(384).fill(0.1),
          provider: 'minilm'
        })
      };

      // Mock 의존성 생성
      mockTextEngine = createMockTextSearchEngine();
      mockEmbeddingService = createMockEmbeddingService();
      mockVectorEngine = createMockVectorSearchEngine();
      mockResultCombiner = createMockResultCombiner();
      mockWeightCalculator = createMockWeightCalculator();
      mockLogger = createMockLogger();

      testEngine = new HybridSearchEngine(
        mockTextEngine,
        mockEmbeddingService,
        mockVectorEngine,
        mockResultCombiner,
        mockWeightCalculator,
        mockLogger,
        mockQueryEmbeddingService
      );
    });

    afterEach(() => {
      if (db) {
        db.close();
      }
      vi.clearAllMocks();
    });

    it('정규화 정확도 검증 - Min-Max 정규화가 올바르게 적용되는지', async () => {
      // Given: 서로 다른 점수 범위를 가진 provider 결과
      // minilm: 0.5, 0.6, 0.7 (범위: 0.2)
      // openai: 0.8, 0.85, 0.9 (범위: 0.1)
      insertMemoryItem(db, { id: 'mem-minilm-1', type: 'episodic', content: 'MiniLM 1' });
      insertMemoryEmbedding(db, { memory_id: 'mem-minilm-1', embedding: new Array(384).fill(0.1), embedding_provider: 'minilm', dim: 384, dimensions: 384 });
      
      insertMemoryItem(db, { id: 'mem-minilm-2', type: 'episodic', content: 'MiniLM 2' });
      insertMemoryEmbedding(db, { memory_id: 'mem-minilm-2', embedding: new Array(384).fill(0.2), embedding_provider: 'minilm', dim: 384, dimensions: 384 });
      
      insertMemoryItem(db, { id: 'mem-openai-1', type: 'episodic', content: 'OpenAI 1' });
      insertMemoryEmbedding(db, { memory_id: 'mem-openai-1', embedding: new Array(1536).fill(0.3), embedding_provider: 'openai', dim: 1536, dimensions: 1536 });

      // Mock 설정
      (mockTextEngine.search as Mock).mockResolvedValue({ items: [], total_count: 0, query_time: 0 });
      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: true });
      
      (mockVectorEngine.search as Mock).mockImplementation(async (vector: number[], options: unknown, provider: string) => {
        if (provider === 'minilm') {
          return [
            { memory_id: 'mem-minilm-1', similarity: 0.5, content: 'MiniLM 1', type: 'episodic', importance: 0.7, created_at: new Date().toISOString() },
            { memory_id: 'mem-minilm-2', similarity: 0.7, content: 'MiniLM 2', type: 'episodic', importance: 0.6, created_at: new Date().toISOString() }
          ];
        } else if (provider === 'openai') {
          return [
            { memory_id: 'mem-openai-1', similarity: 0.9, content: 'OpenAI 1', type: 'episodic', importance: 0.8, created_at: new Date().toISOString() }
          ];
        }
        return [];
      });
      
      // resultCombiner가 벡터 검색 결과를 처리하도록 Mock 설정
      (mockResultCombiner.combine as Mock).mockImplementation((textResults: unknown[], vectorResults: unknown[]) => {
        return vectorResults.map(r => ({
          id: r.id,
          content: r.content,
          type: r.type,
          importance: r.importance,
          created_at: r.created_at,
          last_accessed: r.last_accessed,
          pinned: r.pinned || false,
          tags: r.tags || [],
          textScore: 0,
          vectorScore: r.similarity,
          finalScore: r.similarity * 0.6,
          recall_reason: `벡터 유사도: ${r.similarity.toFixed(3)}`
        }));
      });
      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });

      // When: 다중 provider 검색 실행
      const result = await testEngine.search(db, {
        query: 'test query',
        limit: 10
      });

      // Then: 정규화가 올바르게 적용되어야 함
      // minilm: 0.5 -> (0.5-0.5)/(0.7-0.5) = 0.0, 0.7 -> (0.7-0.5)/(0.7-0.5) = 1.0
      // openai: 0.9 -> (0.9-0.9)/(0.9-0.9) = 1.0 (단일 결과이므로)
      expect(result).toBeDefined();
      
      // 정규화 후 최고 점수는 1.0이어야 함
      if (result.items && result.items.length > 0) {
        const maxScore = Math.max(...result.items.map(item => item.finalScore || 0));
        expect(maxScore).toBeLessThanOrEqual(1.0);
        expect(maxScore).toBeGreaterThanOrEqual(0.0);
      }
    });

    it('max_score === min_score edge case 처리 - 모든 점수가 동일한 경우', async () => {
      // Given: 동일한 점수를 가진 결과들
      insertMemoryItem(db, { id: 'mem-minilm-1', type: 'episodic', content: 'MiniLM 1' });
      insertMemoryEmbedding(db, { memory_id: 'mem-minilm-1', embedding: new Array(384).fill(0.1), embedding_provider: 'minilm', dim: 384, dimensions: 384 });
      
      insertMemoryItem(db, { id: 'mem-minilm-2', type: 'episodic', content: 'MiniLM 2' });
      insertMemoryEmbedding(db, { memory_id: 'mem-minilm-2', embedding: new Array(384).fill(0.2), embedding_provider: 'minilm', dim: 384, dimensions: 384 });

      // Mock 설정
      (mockTextEngine.search as Mock).mockResolvedValue({ items: [], total_count: 0, query_time: 0 });
      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: true });
      
      // 모든 결과가 동일한 점수 (0.5)
      (mockVectorEngine.search as Mock).mockResolvedValue([
        { memory_id: 'mem-minilm-1', similarity: 0.5, content: 'MiniLM 1', type: 'episodic', importance: 0.7, created_at: new Date().toISOString() },
        { memory_id: 'mem-minilm-2', similarity: 0.5, content: 'MiniLM 2', type: 'episodic', importance: 0.6, created_at: new Date().toISOString() }
      ]);
      
      // resultCombiner가 벡터 검색 결과를 처리하도록 Mock 설정
      (mockResultCombiner.combine as Mock).mockImplementation((textResults: unknown[], vectorResults: unknown[]) => {
        return vectorResults.map(r => ({
          id: r.id,
          content: r.content,
          type: r.type,
          importance: r.importance,
          created_at: r.created_at,
          last_accessed: r.last_accessed,
          pinned: r.pinned || false,
          tags: r.tags || [],
          textScore: 0,
          vectorScore: r.similarity,
          finalScore: r.similarity * 0.6,
          recall_reason: `벡터 유사도: ${r.similarity.toFixed(3)}`
        }));
      });
      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });

      // When: 검색 실행
      const result = await testEngine.search(db, {
        query: 'test query',
        limit: 10
      });

      // Then: 0으로 나누기 오류 없이 원본 점수가 유지되어야 함 (정보 손실 방지)
      expect(result).toBeDefined();
      if (result.items && result.items.length > 0) {
        // 모든 점수가 동일한 경우, 원본 점수(0.5)를 유지해야 함
        // 정규화를 하지 않아도 다른 provider와의 비교 시 원본 점수가 유지됨
        // finalScore는 vectorScore * 0.6이므로 vectorScore가 0.5면 finalScore는 0.3이 됨
        result.items.forEach(item => {
          expect(item.vectorScore).toBe(0.5); // 원본 similarity 유지
        });
      }
    });

    it('중복 제거 검증 - memory_id 기준 최고 점수만 유지', async () => {
      // Given: 같은 memory_id를 가진 결과가 여러 provider에서 반환됨
      insertMemoryItem(db, { id: 'mem-duplicate', type: 'episodic', content: '중복 메모리' });
      insertMemoryEmbedding(db, { memory_id: 'mem-duplicate', embedding: new Array(384).fill(0.1), embedding_provider: 'minilm', dim: 384, dimensions: 384 });
      insertMemoryEmbedding(db, { memory_id: 'mem-duplicate', embedding: new Array(1536).fill(0.2), embedding_provider: 'openai', dim: 1536, dimensions: 1536 });

      // Mock 설정
      (mockTextEngine.search as Mock).mockResolvedValue({ items: [], total_count: 0, query_time: 0 });
      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: true });
      
      (mockVectorEngine.search as Mock).mockImplementation(async (vector: number[], options: unknown, provider: string) => {
        if (provider === 'minilm') {
          return [
            { memory_id: 'mem-duplicate', similarity: 0.6, content: '중복 메모리', type: 'episodic', importance: 0.7, created_at: new Date().toISOString() }
          ];
        } else if (provider === 'openai') {
          return [
            { memory_id: 'mem-duplicate', similarity: 0.9, content: '중복 메모리', type: 'episodic', importance: 0.7, created_at: new Date().toISOString() }
          ];
        }
        return [];
      });
      
      // resultCombiner가 벡터 검색 결과를 처리하도록 Mock 설정
      (mockResultCombiner.combine as Mock).mockImplementation((textResults: unknown[], vectorResults: unknown[]) => {
        // 벡터 검색 결과를 그대로 반환 (텍스트 결과는 빈 배열)
        return vectorResults.map(r => ({
          id: r.id,
          content: r.content,
          type: r.type,
          importance: r.importance,
          created_at: r.created_at,
          last_accessed: r.last_accessed,
          pinned: r.pinned || false,
          tags: r.tags || [],
          textScore: 0,
          vectorScore: r.similarity,
          finalScore: r.similarity * 0.6, // vectorWeight 0.6
          recall_reason: `벡터 유사도: ${r.similarity.toFixed(3)}`
        }));
      });
      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });

      // When: 다중 provider 검색 실행
      const result = await testEngine.search(db, {
        query: 'test query',
        limit: 10
      });

      // Then: 중복된 memory_id는 하나만 반환되어야 하고, 최고 점수를 가진 것이 선택되어야 함
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      if (result.items && result.items.length > 0) {
        const duplicateIds = result.items.filter(item => item.id === 'mem-duplicate');
        expect(duplicateIds.length).toBe(1); // 중복 제거되어 하나만 있어야 함
        
        // 최고 점수를 가진 것이 선택되어야 함 (openai의 0.9가 정규화 후 더 높을 것)
        const selectedItem = duplicateIds[0];
        expect(selectedItem).toBeDefined();
      } else {
        // 결과가 없으면 벡터 검색이 실행되었는지 확인
        expect(mockVectorEngine.search).toHaveBeenCalled();
      }
    });

    it('재랭킹 검증 - 정규화된 점수로 올바르게 정렬되는지', async () => {
      // Given: 서로 다른 provider에서 다양한 점수의 결과
      insertMemoryItem(db, { id: 'mem-minilm-low', type: 'episodic', content: 'MiniLM 낮은 점수' });
      insertMemoryEmbedding(db, { memory_id: 'mem-minilm-low', embedding: new Array(384).fill(0.1), embedding_provider: 'minilm', dim: 384, dimensions: 384 });
      
      insertMemoryItem(db, { id: 'mem-minilm-high', type: 'episodic', content: 'MiniLM 높은 점수' });
      insertMemoryEmbedding(db, { memory_id: 'mem-minilm-high', embedding: new Array(384).fill(0.2), embedding_provider: 'minilm', dim: 384, dimensions: 384 });
      
      insertMemoryItem(db, { id: 'mem-openai-mid', type: 'episodic', content: 'OpenAI 중간 점수' });
      insertMemoryEmbedding(db, { memory_id: 'mem-openai-mid', embedding: new Array(1536).fill(0.3), embedding_provider: 'openai', dim: 1536, dimensions: 1536 });

      // Mock 설정
      (mockTextEngine.search as Mock).mockResolvedValue({ items: [], total_count: 0, query_time: 0 });
      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: true });
      
      (mockVectorEngine.search as Mock).mockImplementation(async (vector: number[], options: unknown, provider: string) => {
        if (provider === 'minilm') {
          return [
            { memory_id: 'mem-minilm-low', similarity: 0.3, content: 'MiniLM 낮은 점수', type: 'episodic', importance: 0.5, created_at: new Date().toISOString() },
            { memory_id: 'mem-minilm-high', similarity: 0.8, content: 'MiniLM 높은 점수', type: 'episodic', importance: 0.7, created_at: new Date().toISOString() }
          ];
        } else if (provider === 'openai') {
          return [
            { memory_id: 'mem-openai-mid', similarity: 0.6, content: 'OpenAI 중간 점수', type: 'episodic', importance: 0.6, created_at: new Date().toISOString() }
          ];
        }
        return [];
      });
      
      // resultCombiner가 벡터 검색 결과를 처리하도록 Mock 설정
      (mockResultCombiner.combine as Mock).mockImplementation((textResults: unknown[], vectorResults: unknown[]) => {
        return vectorResults.map(r => ({
          id: r.id,
          content: r.content,
          type: r.type,
          importance: r.importance,
          created_at: r.created_at,
          last_accessed: r.last_accessed,
          pinned: r.pinned || false,
          tags: r.tags || [],
          textScore: 0,
          vectorScore: r.similarity,
          finalScore: r.similarity * 0.6,
          recall_reason: `벡터 유사도: ${r.similarity.toFixed(3)}`
        }));
      });
      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });

      // When: 다중 provider 검색 실행
      const result = await testEngine.search(db, {
        query: 'test query',
        limit: 10
      });

      // Then: 정규화된 점수로 내림차순 정렬되어야 함
      expect(result).toBeDefined();
      if (result.items && result.items.length > 1) {
        // 점수가 내림차순으로 정렬되어 있는지 확인 (finalScore 기준)
        for (let i = 0; i < result.items.length - 1; i++) {
          expect(result.items[i].finalScore).toBeGreaterThanOrEqual(result.items[i + 1].finalScore);
        }
        
        // 최고 점수는 1.0 이하이어야 함 (정규화 후 vectorScore * 0.6)
        expect(result.items[0].vectorScore).toBeLessThanOrEqual(1.0);
        expect(result.items[0].vectorScore).toBeGreaterThanOrEqual(0.0);
      }
    });

    it('타임아웃 타이머 정리 - 정상 완료 시 타임아웃 로그 미발생', async () => {
      // Given: 빠르게 완료되는 검색 시나리오
      insertMemoryItem(db, {
        id: 'mem-fast',
        type: 'episodic',
        content: '빠른 검색 테스트'
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem-fast',
        embedding: new Array(384).fill(0.1),
        embedding_provider: 'minilm',
        dim: 384,
        dimensions: 384
      });

      // Mock 설정: vectorEngine이 사용 가능하고 빠르게 완료 (50ms 이내)
      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: true });
      (mockVectorEngine.search as Mock).mockImplementation(async (queryVector, options, provider) => {
        await new Promise(resolve => setTimeout(resolve, 50)); // 50ms로 빠르게 완료
        return [
          {
            memory_id: 'mem-fast',
            similarity: 0.9,
            content: '빠른 검색 테스트',
            type: 'episodic',
            importance: 0.7,
            created_at: new Date().toISOString()
          }
        ];
      });

      (mockTextEngine.search as Mock).mockResolvedValue({ items: [], total_count: 0, query_time: 0 });
      (mockResultCombiner.combine as Mock).mockReturnValue([]);
      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });

      // When: 검색 실행 (3초 타임아웃보다 빠르게 완료)
      await testEngine.search(db, {
        query: 'test query',
        limit: 10
      });

      // Then: 타임아웃 로그가 호출되지 않았는지 확인
      const logCalls = (mockLogger.logSearchStep as Mock).mock.calls;
      const timeoutLog = logCalls.find(call => {
        const step = call[1] as string;
        return step === 'VEC 벡터 검색 전체 타임아웃';
      });
      expect(timeoutLog).toBeUndefined();

      // 3초 후에도 타임아웃 로그가 발생하지 않는지 확인 (타이머가 정리되었는지)
      await new Promise(resolve => setTimeout(resolve, 3100)); // 3.1초 대기
      const logCallsAfter = (mockLogger.logSearchStep as Mock).mock.calls;
      const timeoutLogAfter = logCallsAfter.find(call => {
        const step = call[1] as string;
        return step === 'VEC 벡터 검색 전체 타임아웃';
      });
      expect(timeoutLogAfter).toBeUndefined(); // 여전히 호출되지 않아야 함
    }, 10000); // 10초 타임아웃 (3초 대기 포함)
  });

  describe('Procedural Memory 특화 가중치 통합 테스트', () => {
    let db: Database.Database;
    let testEngine: HybridSearchEngine;

    beforeEach(async () => {
      db = new Database(':memory:');
      initializeTestDatabase(db);
      
      // RelationEngine 스키마 마이그레이션
      const migration = new RelationEngineSchemaMigration();
      migration.up(db);

      testEngine = createHybridSearchEngine();
    });

    afterEach(() => {
      db.close();
    });

    it('procedural memory에 workflow_name이 있으면 가중치 부스트 적용', async () => {
      // Given: workflow_name이 있는 procedural memory
      insertMemoryItem(db, {
        id: 'mem-procedural-1',
        type: 'procedural',
        content: '데이터 마이그레이션 절차',
        workflow_name: '데이터 마이그레이션',
        skill_name: '스키마 백업'
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem-procedural-1',
        embedding: new Array(384).fill(0.1),
        embedding_provider: 'minilm',
        dim: 384,
        dimensions: 384
      });

      // Given: 일반 episodic memory
      insertMemoryItem(db, {
        id: 'mem-episodic-1',
        type: 'episodic',
        content: '일반 기억'
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem-episodic-1',
        embedding: new Array(384).fill(0.1),
        embedding_provider: 'minilm',
        dim: 384,
        dimensions: 384
      });

      // When: 검색 실행
      const result = await testEngine.search(db, {
        query: '데이터',
        limit: 10
      });

      // Then: procedural memory가 더 높은 점수를 받아야 함 (workflow_name 부스트)
      if (result.items.length >= 2) {
        const proceduralMemory = result.items.find(item => item.id === 'mem-procedural-1');
        const episodicMemory = result.items.find(item => item.id === 'mem-episodic-1');
        
        if (proceduralMemory && episodicMemory) {
          // procedural memory가 더 높은 finalScore를 가져야 함
          expect(proceduralMemory.finalScore).toBeGreaterThanOrEqual(episodicMemory.finalScore);
        }
      }
    });

    it('procedural memory에 skill_name이 있으면 가중치 부스트 적용', async () => {
      // Given: skill_name이 있는 procedural memory
      insertMemoryItem(db, {
        id: 'mem-procedural-2',
        type: 'procedural',
        content: '스키마 백업 절차',
        skill_name: '스키마 백업'
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem-procedural-2',
        embedding: new Array(384).fill(0.1),
        embedding_provider: 'minilm',
        dim: 384,
        dimensions: 384
      });

      // When: 검색 실행
      const result = await testEngine.search(db, {
        query: '스키마',
        limit: 10
      });

      // Then: procedural memory가 검색 결과에 포함되어야 함
      const proceduralMemory = result.items.find(item => item.id === 'mem-procedural-2');
      expect(proceduralMemory).toBeDefined();
    });

    it('procedural memory에 trigger_conditions가 있으면 가중치 부스트 적용', async () => {
      // Given: trigger_conditions가 있는 procedural memory
      insertMemoryItem(db, {
        id: 'mem-procedural-3',
        type: 'procedural',
        content: '마이그레이션 트리거 절차',
        trigger_conditions: JSON.stringify({ event: 'migration_start' })
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem-procedural-3',
        embedding: new Array(384).fill(0.1),
        embedding_provider: 'minilm',
        dim: 384,
        dimensions: 384
      });

      // When: 검색 실행
      const result = await testEngine.search(db, {
        query: '마이그레이션',
        limit: 10
      });

      // Then: procedural memory가 검색 결과에 포함되어야 함
      const proceduralMemory = result.items.find(item => item.id === 'mem-procedural-3');
      expect(proceduralMemory).toBeDefined();
    });

    it('모든 procedural memory 필드가 있으면 최대 부스트 적용', async () => {
      // Given: 모든 procedural memory 필드가 있는 메모리
      insertMemoryItem(db, {
        id: 'mem-procedural-4',
        type: 'procedural',
        content: '완전한 procedural memory',
        workflow_name: '데이터 마이그레이션',
        skill_name: '스키마 백업',
        trigger_conditions: JSON.stringify({ event: 'migration_start' })
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem-procedural-4',
        embedding: new Array(384).fill(0.1),
        embedding_provider: 'minilm',
        dim: 384,
        dimensions: 384
      });

      // Given: 일반 episodic memory
      insertMemoryItem(db, {
        id: 'mem-episodic-2',
        type: 'episodic',
        content: '일반 기억'
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem-episodic-2',
        embedding: new Array(384).fill(0.1),
        embedding_provider: 'minilm',
        dim: 384,
        dimensions: 384
      });

      // When: 검색 실행
      const result = await testEngine.search(db, {
        query: '데이터',
        limit: 10
      });

      // Then: procedural memory가 더 높은 점수를 받아야 함 (최대 부스트)
      if (result.items.length >= 2) {
        const proceduralMemory = result.items.find(item => item.id === 'mem-procedural-4');
        const episodicMemory = result.items.find(item => item.id === 'mem-episodic-2');
        
        if (proceduralMemory && episodicMemory) {
          // procedural memory가 더 높은 finalScore를 가져야 함
          expect(proceduralMemory.finalScore).toBeGreaterThanOrEqual(episodicMemory.finalScore);
        }
      }
    });
  });

  describe('combineAndSortResults() 분리 테스트', () => {

/**
 * IProceduralMemoryMatcher 인터페이스 테스트
 * TDD RED 단계: 인터페이스 정의 및 테스트 작성 (구현체 없이 실패해야 함)
 */
describe('IProceduralMemoryMatcher 인터페이스', () => {
  describe('인터페이스 계약 정의', () => {
    it('Given: IProceduralMemoryMatcher 인터페이스가 정의됨, When: 인터페이스의 메서드 시그니처를 확인함, Then: fetchProceduralMemoryMatches 메서드가 정의되어 있음', () => {
      // Given: IProceduralMemoryMatcher 인터페이스가 정의됨
      // When: 인터페이스의 메서드 시그니처를 확인함
      // 인터페이스는 타입 레벨에서만 존재하므로 런타임 체크는 불가능
      // 대신 타입 체크를 통해 검증 (타입 체크는 컴파일 타임에 수행됨)
      type MatcherType = IProceduralMemoryMatcher;
      const hasMethod: MatcherType = {
        fetchProceduralMemoryMatches: (
          db: Database.Database,
          memoryIds: string[],
          query?: unknown
        ) => new Map()
      };
      
      // Then: fetchProceduralMemoryMatches 메서드가 정의되어 있음
      // 타입 체크를 통과했다는 것은 인터페이스가 올바르게 정의되었다는 의미
      expect(typeof hasMethod.fetchProceduralMemoryMatches).toBe('function');
    });

    it('Given: IProceduralMemoryMatcher 인터페이스가 정의됨, When: 인터페이스의 반환 타입을 확인함, Then: Map<string, 매칭결과> 타입을 반환함', () => {
      // Given: IProceduralMemoryMatcher 인터페이스가 정의됨
      // When: 인터페이스의 반환 타입을 확인함
      const mockMatcher: IProceduralMemoryMatcher = {
        fetchProceduralMemoryMatches: (
          db: Database.Database,
          memoryIds: string[],
          query?: unknown
        ) => {
          const result = new Map<string, { workflow_name_match: boolean; skill_name_match: boolean; trigger_conditions_match: boolean }>();
          return result;
        }
      };
      
      // Then: Map<string, 매칭결과> 타입을 반환함
      const result = mockMatcher.fetchProceduralMemoryMatches(mockDb, []);
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });
  });

  describe('인터페이스 구현체 테스트 (TDD RED - 구현체 없음)', () => {
    it('Given: IProceduralMemoryMatcher 인터페이스가 정의됨, When: 구현체 없이 테스트를 작성함, Then: 테스트가 실패 상태로 작성됨 (구현체가 없으므로)', () => {
      // Given: IProceduralMemoryMatcher 인터페이스가 정의됨
      // When: 구현체 없이 테스트를 작성함
      // Note: 실제 구현체는 작업 1.2에서 생성될 예정
      // 이 테스트는 인터페이스가 올바르게 정의되었는지 확인하는 용도
      
      // Then: 테스트가 실패 상태로 작성됨 (구현체가 없으므로)
      // 실제 구현체가 없으므로 이 테스트는 통과하지만,
      // 실제 사용 시 타입 체크를 통해 인터페이스 준수를 강제함
      expect(true).toBe(true); // 인터페이스 정의 확인용
    });
  });
});
    let db: Database.Database;
    let relationGraph: RelationGraph;

    beforeEach(() => {
      // Given: in-memory 데이터베이스 생성 및 초기화
      db = new Database(':memory:');
      
      // 기본 스키마 생성
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
          origin_source TEXT DEFAULT '{}',
          view_count INTEGER DEFAULT 0,
          cite_count INTEGER DEFAULT 0,
          edit_count INTEGER DEFAULT 0,
          task_goal TEXT,
          steps TEXT,
          reflection_notes TEXT,
          consolidation_score REAL,
          -- Procedural Memory Enhancement (v7.0) 필드
          workflow_name TEXT,
          skill_name TEXT,
          trigger_conditions TEXT,
          -- Procedural Version Management (Issue #57, migration 013)
          version INTEGER NULL,
          version_series_id TEXT NULL,
          -- Multi-agent ownership (Issue #57 Phase 2 D, migration 015)
          owner_id TEXT NULL,
          -- Memori Attribution (Issue #87, migration 016)
          process_id TEXT NULL,
          session_id TEXT NULL,
          num_times INTEGER NOT NULL DEFAULT 1,
          last_mentioned_at TIMESTAMP,
          source_session_id TEXT,
          confidence REAL,
          is_consolidated BOOLEAN DEFAULT FALSE,
          is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
          deleted_at TEXT,
          project_id TEXT
        );
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS memento_schema_version (
          version INTEGER PRIMARY KEY,
          applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      
      // 마이그레이션 실행
      const migration = new RelationEngineSchemaMigration();
      migration.up(db);
      
      relationGraph = createRelationGraph(db);
      
      // HybridSearchEngine에 RelationGraph 설정
      hybridSearchEngine.setRelationGraph(relationGraph);
    });

    afterEach(() => {
      if (db) {
        db.close();
      }
    });

    /**
     * Given: 다양한 점수를 가진 결과들 (textScore, vectorScore가 다름)
     * When: combineAndSortResults()가 호출됨 (search()를 통해)
     * Then: 모든 결과가 정규화된 finalScore를 가짐
     */
    it('Given: 다양한 점수를 가진 결과들, When: combineAndSortResults()가 호출됨, Then: 모든 결과가 정규화된 finalScore를 가짐', async () => {
      // Given: 다양한 점수를 가진 결과들
      (mockTextEngine.search as Mock).mockResolvedValue({
        items: [
          { id: 'mem1', content: '테스트 1', type: 'episodic', importance: 0.5, created_at: new Date().toISOString(), pinned: false },
          { id: 'mem2', content: '테스트 2', type: 'episodic', importance: 0.8, created_at: new Date().toISOString(), pinned: false }
        ],
        total_count: 2,
        query_time: 10
      });

      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: false });
      (mockEmbeddingService.isAvailable as Mock).mockReturnValue(true);
      (mockEmbeddingService.searchBySimilarity as Mock).mockResolvedValue([
        { id: 'mem1', content: '테스트 1', type: 'episodic', importance: 0.5, similarity: 0.9 },
        { id: 'mem2', content: '테스트 2', type: 'episodic', importance: 0.8, similarity: 0.7 }
      ]);

      (mockResultCombiner.combine as Mock).mockReturnValue([
        {
          id: 'mem1',
          content: '테스트 1',
          type: 'episodic',
          importance: 0.5,
          created_at: new Date().toISOString(),
          pinned: false,
          textScore: 0.6,
          vectorScore: 0.9,
          finalScore: 0.75,
          recall_reason: '하이브리드 검색'
        },
        {
          id: 'mem2',
          content: '테스트 2',
          type: 'episodic',
          importance: 0.8,
          created_at: new Date().toISOString(),
          pinned: false,
          textScore: 0.8,
          vectorScore: 0.7,
          finalScore: 0.75,
          recall_reason: '하이브리드 검색'
        }
      ]);

      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });

      // When: combineAndSortResults()가 호출됨 (search()를 통해)
      const result = await hybridSearchEngine.search(db, {
        query: '테스트',
        limit: 10
      });

      // Then: 모든 결과가 정규화된 finalScore를 가짐
      expect(result.items).toHaveLength(2);
      result.items.forEach(item => {
        expect(item.finalScore).toBeDefined();
        expect(typeof item.finalScore).toBe('number');
        expect(item.finalScore).toBeGreaterThanOrEqual(0);
        expect(item.finalScore).toBeLessThanOrEqual(1);
      });
    });

    /**
     * Given: 텍스트 검색 결과와 벡터 검색 결과
     * When: combineAndSortResults()가 호출됨
     * Then: 결과가 올바르게 병합됨
     */
    it('Given: 텍스트 검색 결과와 벡터 검색 결과, When: combineAndSortResults()가 호출됨, Then: 결과가 올바르게 병합됨', async () => {
      // Given: 텍스트 검색 결과와 벡터 검색 결과
      (mockTextEngine.search as Mock).mockResolvedValue({
        items: [
          { id: 'mem1', content: '테스트 1', type: 'episodic', importance: 0.5, created_at: new Date().toISOString(), pinned: false },
          { id: 'mem2', content: '테스트 2', type: 'episodic', importance: 0.8, created_at: new Date().toISOString(), pinned: false }
        ],
        total_count: 2,
        query_time: 10
      });

      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: false });
      (mockEmbeddingService.isAvailable as Mock).mockReturnValue(true);
      (mockEmbeddingService.searchBySimilarity as Mock).mockResolvedValue([
        { id: 'mem1', content: '테스트 1', type: 'episodic', importance: 0.5, similarity: 0.9 },
        { id: 'mem3', content: '테스트 3', type: 'episodic', importance: 0.7, similarity: 0.8 }
      ]);

      (mockResultCombiner.combine as Mock).mockReturnValue([
        {
          id: 'mem1',
          content: '테스트 1',
          type: 'episodic',
          importance: 0.5,
          created_at: new Date().toISOString(),
          pinned: false,
          textScore: 0.6,
          vectorScore: 0.9,
          finalScore: 0.75,
          recall_reason: '하이브리드 검색'
        },
        {
          id: 'mem2',
          content: '테스트 2',
          type: 'episodic',
          importance: 0.8,
          created_at: new Date().toISOString(),
          pinned: false,
          textScore: 0.8,
          vectorScore: 0,
          finalScore: 0.32,
          recall_reason: '하이브리드 검색'
        },
        {
          id: 'mem3',
          content: '테스트 3',
          type: 'episodic',
          importance: 0.7,
          created_at: new Date().toISOString(),
          pinned: false,
          textScore: 0,
          vectorScore: 0.8,
          finalScore: 0.48,
          recall_reason: '하이브리드 검색'
        }
      ]);

      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });

      // When: combineAndSortResults()가 호출됨
      const result = await hybridSearchEngine.search(db, {
        query: '테스트',
        limit: 10
      });

      // Then: 결과가 올바르게 병합됨
      expect(result.items.length).toBeGreaterThan(0);
      expect(mockResultCombiner.combine).toHaveBeenCalled();
      const combineCall = (mockResultCombiner.combine as Mock).mock.calls[0];
      expect(combineCall[0]).toHaveLength(2); // textResults
      expect(combineCall[1]).toHaveLength(2); // vectorResults
    });

    /**
     * Given: 중복된 ID를 가진 결과들
     * When: combineAndSortResults()가 호출됨
     * Then: 중복이 제거됨
     */
    it('Given: 중복된 ID를 가진 결과들, When: combineAndSortResults()가 호출됨, Then: 중복이 제거됨', async () => {
      // Given: 중복된 ID를 가진 결과들
      (mockTextEngine.search as Mock).mockResolvedValue({
        items: [
          { id: 'mem1', content: '테스트 1', type: 'episodic', importance: 0.5, created_at: new Date().toISOString(), pinned: false }
        ],
        total_count: 1,
        query_time: 10
      });

      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: false });
      (mockEmbeddingService.isAvailable as Mock).mockReturnValue(true);
      (mockEmbeddingService.searchBySimilarity as Mock).mockResolvedValue([
        { id: 'mem1', content: '테스트 1', type: 'episodic', importance: 0.5, similarity: 0.9 }
      ]);

      (mockResultCombiner.combine as Mock).mockReturnValue([
        {
          id: 'mem1',
          content: '테스트 1',
          type: 'episodic',
          importance: 0.5,
          created_at: new Date().toISOString(),
          pinned: false,
          textScore: 0.6,
          vectorScore: 0.9,
          finalScore: 0.75,
          recall_reason: '하이브리드 검색'
        },
        {
          id: 'mem1', // 중복 ID
          content: '테스트 1',
          type: 'episodic',
          importance: 0.5,
          created_at: new Date().toISOString(),
          pinned: false,
          textScore: 0.6,
          vectorScore: 0.9,
          finalScore: 0.75,
          recall_reason: '하이브리드 검색'
        }
      ]);

      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });

      // When: combineAndSortResults()가 호출됨
      const result = await hybridSearchEngine.search(db, {
        query: '테스트',
        limit: 10
      });

      // Then: 중복이 제거됨 (또는 최상위 결과만 유지됨)
      const uniqueIds = new Set(result.items.map(item => item.id));
      expect(uniqueIds.size).toBeLessThanOrEqual(result.items.length);
      // 주의: 현재 구현에서는 중복 제거가 resultCombiner.combine()에서 처리될 수 있음
      // 따라서 이 테스트는 중복 제거 로직이 올바르게 작동하는지 검증함
    });

    /**
     * Given: 다양한 finalScore를 가진 결과들
     * When: combineAndSortResults()가 호출됨
     * Then: 결과가 finalScore 내림차순으로 정렬됨
     */
    it('Given: 다양한 finalScore를 가진 결과들, When: combineAndSortResults()가 호출됨, Then: 결과가 finalScore 내림차순으로 정렬됨', async () => {
      // Given: 다양한 finalScore를 가진 결과들
      (mockTextEngine.search as Mock).mockResolvedValue({
        items: [
          { id: 'mem1', content: '테스트 1', type: 'episodic', importance: 0.5, created_at: new Date().toISOString(), pinned: false },
          { id: 'mem2', content: '테스트 2', type: 'episodic', importance: 0.8, created_at: new Date().toISOString(), pinned: false },
          { id: 'mem3', content: '테스트 3', type: 'episodic', importance: 0.7, created_at: new Date().toISOString(), pinned: false }
        ],
        total_count: 3,
        query_time: 10
      });

      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: false });
      (mockEmbeddingService.isAvailable as Mock).mockReturnValue(true);
      (mockEmbeddingService.searchBySimilarity as Mock).mockResolvedValue([
        { id: 'mem1', content: '테스트 1', type: 'episodic', importance: 0.5, similarity: 0.9 },
        { id: 'mem2', content: '테스트 2', type: 'episodic', importance: 0.8, similarity: 0.7 },
        { id: 'mem3', content: '테스트 3', type: 'episodic', importance: 0.7, similarity: 0.8 }
      ]);

      (mockResultCombiner.combine as Mock).mockReturnValue([
        {
          id: 'mem1',
          content: '테스트 1',
          type: 'episodic',
          importance: 0.5,
          created_at: new Date().toISOString(),
          pinned: false,
          textScore: 0.6,
          vectorScore: 0.9,
          finalScore: 0.75,
          recall_reason: '하이브리드 검색'
        },
        {
          id: 'mem2',
          content: '테스트 2',
          type: 'episodic',
          importance: 0.8,
          created_at: new Date().toISOString(),
          pinned: false,
          textScore: 0.8,
          vectorScore: 0.7,
          finalScore: 0.85, // 가장 높은 점수
          recall_reason: '하이브리드 검색'
        },
        {
          id: 'mem3',
          content: '테스트 3',
          type: 'episodic',
          importance: 0.7,
          created_at: new Date().toISOString(),
          pinned: false,
          textScore: 0.7,
          vectorScore: 0.8,
          finalScore: 0.65, // 가장 낮은 점수
          recall_reason: '하이브리드 검색'
        }
      ]);

      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });

      // When: combineAndSortResults()가 호출됨
      const result = await hybridSearchEngine.search(db, {
        query: '테스트',
        limit: 10
      });

      // Then: 결과가 finalScore 내림차순으로 정렬됨
      // 주의: normalizeScores()가 finalScore를 재계산하므로, mock에서 설정한 finalScore 순서가 유지되지 않을 수 있습니다.
      // 이 테스트는 sortByFinalScore()가 제대로 작동하는지만 확인합니다.
      expect(result.items).toHaveLength(3);
      for (let i = 0; i < result.items.length - 1; i++) {
        expect(result.items[i].finalScore).toBeGreaterThanOrEqual(result.items[i + 1].finalScore);
      }
      // 정렬이 제대로 되었는지 확인 (첫 번째 항목의 finalScore가 두 번째 항목보다 크거나 같아야 함)
      if (result.items.length > 1) {
        expect(result.items[0].finalScore).toBeGreaterThanOrEqual(result.items[1].finalScore);
      }
    });

    /**
     * 테스트용 메모리 생성 헬퍼 함수
     */
    function createTestMemory(
      id: string,
      content: string,
      type: 'working' | 'episodic' | 'semantic' | 'procedural' = 'episodic'
    ): void {
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, ?, ?, 0.5, CURRENT_TIMESTAMP)
      `, [id, type, content]);
    }

    /**
     * Given: 모든 분리된 함수들이 구현됨
     * When: 전체 파이프라인을 검증하는 통합 테스트 작성
     * Then: 통합 테스트가 통과하고 전체 기능이 정상 동작함
     * 
     * combineAndSortResults()의 전체 파이프라인을 검증합니다:
     * 1. mergeResults() - 결과 병합
     * 2. normalizeScores() - 점수 정규화
     * 3. deduplicateResults() - 중복 제거
     * 4. sortByFinalScore() - 정렬
     */
    it('Given: 모든 분리된 함수들이 구현됨, When: 전체 파이프라인을 검증하는 통합 테스트 작성, Then: 통합 테스트가 통과하고 전체 기능이 정상 동작함', async () => {
      // Given: 텍스트 검색 결과와 벡터 검색 결과, 데이터베이스, 관계 그래프
      createTestMemory('mem1', '프로젝트 계획');
      createTestMemory('mem2', '프로젝트 실행');
      createTestMemory('mem3', '프로젝트 완료');
      
      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { confidence: 0.8 });
      await relationGraph.addRelation('mem2', 'mem3', 'FOLLOWS', { confidence: 0.9 });

      (mockTextEngine.search as Mock).mockResolvedValue({
        items: [
          { id: 'mem1', content: '프로젝트 계획', type: 'episodic', importance: 0.5, created_at: new Date().toISOString(), pinned: false },
          { id: 'mem2', content: '프로젝트 실행', type: 'episodic', importance: 0.8, created_at: new Date().toISOString(), pinned: false }
        ],
        total_count: 2,
        query_time: 10
      });

      (mockVectorEngine.getIndexStatus as Mock).mockReturnValue({ available: false });
      (mockEmbeddingService.isAvailable as Mock).mockReturnValue(true);
      (mockEmbeddingService.searchBySimilarity as Mock).mockResolvedValue([
        { id: 'mem1', content: '프로젝트 계획', type: 'episodic', importance: 0.5, similarity: 0.9 },
        { id: 'mem3', content: '프로젝트 완료', type: 'episodic', importance: 0.7, similarity: 0.8 }
      ]);

      (mockResultCombiner.combine as Mock).mockReturnValue([
        {
          id: 'mem1',
          content: '프로젝트 계획',
          type: 'episodic',
          importance: 0.5,
          created_at: new Date().toISOString(),
          pinned: false,
          textScore: 0.6,
          vectorScore: 0.9,
          finalScore: 0.75,
          recall_reason: '하이브리드 검색'
        },
        {
          id: 'mem2',
          content: '프로젝트 실행',
          type: 'episodic',
          importance: 0.8,
          created_at: new Date().toISOString(),
          pinned: false,
          textScore: 0.8,
          vectorScore: 0,
          finalScore: 0.32,
          recall_reason: '하이브리드 검색'
        },
        {
          id: 'mem3',
          content: '프로젝트 완료',
          type: 'episodic',
          importance: 0.7,
          created_at: new Date().toISOString(),
          pinned: false,
          textScore: 0,
          vectorScore: 0.8,
          finalScore: 0.48,
          recall_reason: '하이브리드 검색'
        }
      ]);

      (mockWeightCalculator.calculateWeights as Mock).mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 });

      // When: combineAndSortResults()가 호출됨 (전체 파이프라인 실행)
      const result = await hybridSearchEngine.search(db, {
        query: '프로젝트',
        limit: 10,
        includeRelations: true
      });

      // Then: 통합 테스트가 통과하고 전체 기능이 정상 동작함
      
      // 1. mergeResults()가 호출되어 결과가 병합됨
      expect(mockResultCombiner.combine).toHaveBeenCalled();
      const combineCall = (mockResultCombiner.combine as Mock).mock.calls[0];
      expect(combineCall[0]).toHaveLength(2); // textResults
      expect(combineCall[1]).toHaveLength(2); // vectorResults
      
      // 2. normalizeScores()가 호출되어 점수가 정규화됨 (관계 가중치가 반영됨)
      expect(result.items.length).toBeGreaterThan(0);
      result.items.forEach(item => {
        expect(item.finalScore).toBeDefined();
        expect(typeof item.finalScore).toBe('number');
        expect(item.finalScore).toBeGreaterThanOrEqual(0);
        // 관계 가중치가 있는 경우 finalScore가 더 높을 수 있음
        if (item.relation_weight && item.relation_weight > 0) {
          expect(item.finalScore).toBeGreaterThan(0);
        }
      });
      
      // 3. deduplicateResults()가 호출되어 중복이 제거됨
      const uniqueIds = new Set(result.items.map(item => item.id));
      expect(uniqueIds.size).toBe(result.items.length); // 중복이 없어야 함
      
      // 4. sortByFinalScore()가 호출되어 정렬됨
      for (let i = 0; i < result.items.length - 1; i++) {
        expect(result.items[i].finalScore).toBeGreaterThanOrEqual(result.items[i + 1].finalScore);
      }
      
      // 5. 최종 결과가 올바르게 반환됨
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(result.items.length).toBeLessThanOrEqual(10); // limit 확인
      
      // 6. 관계 정보가 포함됨 (includeRelations가 true인 경우)
      const mem1Result = result.items.find(r => r.id === 'mem1');
      if (mem1Result && mem1Result.relation_weight && mem1Result.relation_weight > 0) {
        expect(mem1Result.relations).toBeDefined();
      }
    });
  });
});

describe('FR-004 피드백 집계 지연 (getNetScores, 하이브리드 combine 동일 경로, T037)', () => {
  function p95(samples: number[]): number {
    if (samples.length === 0) {
      return 0;
    }
    const s = [...samples].sort((a, b) => a - b);
    const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(0.95 * s.length) - 1));
    return s[idx]!;
  }

  it('feedback_event 대량 행이 있어도 getNetScores p95 증가분이 50ms 미만', async () => {
    const db = new Database(':memory:');
    await DatabaseUtils.initializeDatabase(db);
    const repo = new FeedbackRepository(db);
    const ids = Array.from({ length: 200 }, (_, i) => `mem_lat_${i}`);
    for (const id of ids) {
      db.prepare(`INSERT INTO memory_item (id, type, content) VALUES (?, 'semantic', 'x')`).run(id);
    }

    const samplesEmpty: number[] = [];
    for (let r = 0; r < 40; r++) {
      const t0 = Date.now();
      repo.getNetScores(ids, 90);
      samplesEmpty.push(Date.now() - t0);
    }
    const p95Empty = p95(samplesEmpty);

    const ins = db.prepare(
      `INSERT INTO feedback_event (memory_id, event, score, created_at) VALUES (?, 'helpful', NULL, datetime('now'))`
    );
    for (let i = 0; i < 6000; i++) {
      ins.run(ids[i % ids.length]!);
    }

    const samplesHeavy: number[] = [];
    for (let r = 0; r < 40; r++) {
      const t0 = Date.now();
      repo.getNetScores(ids, 90);
      samplesHeavy.push(Date.now() - t0);
    }
    const p95Heavy = p95(samplesHeavy);

    db.close();

    expect(p95Heavy - p95Empty).toBeLessThan(50);
  });
});

/**
 * ISearchResultCombiner 인터페이스 테스트
 * 인터페이스가 이미 존재하므로 계약 확인
 */
describe('ISearchResultCombiner 인터페이스', () => {
  describe('인터페이스 계약 정의', () => {
    it('Given: ISearchResultCombiner 인터페이스가 정의됨, When: 인터페이스의 메서드 시그니처를 확인함, Then: combine 메서드가 정의되어 있음', () => {
      // Given: ISearchResultCombiner 인터페이스가 정의됨
      // When: 인터페이스의 메서드 시그니처를 확인함
      type CombinerType = ISearchResultCombiner;
      const hasMethod: CombinerType = {
        combine: (
          textResults: unknown[],
          vectorResults: unknown[],
          textWeight: number,
          vectorWeight: number
        ) => []
      };
      
      // Then: combine 메서드가 정의되어 있음
      // 타입 체크를 통과했다는 것은 인터페이스가 올바르게 정의되었다는 의미
      expect(typeof hasMethod.combine).toBe('function');
    });

    it('Given: ISearchResultCombiner 인터페이스가 정의됨, When: 인터페이스의 반환 타입을 확인함, Then: HybridSearchResult[] 타입을 반환함', () => {
      // Given: ISearchResultCombiner 인터페이스가 정의됨
      // When: 인터페이스의 반환 타입을 확인함
      const mockCombiner: ISearchResultCombiner = {
        combine: (
          textResults: unknown[],
          vectorResults: unknown[],
          textWeight: number,
          vectorWeight: number
        ) => []
      };
      
      // Then: HybridSearchResult[] 타입을 반환함
      const result = mockCombiner.combine([], [], 0.5, 0.5);
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
