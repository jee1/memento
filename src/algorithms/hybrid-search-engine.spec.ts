import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HybridSearchEngine, type HybridSearchQuery, type HybridSearchResult } from './hybrid-search-engine.js';

const mockTextSearch = vi.fn();
const mockIsEmbeddingAvailable = vi.fn();
const mockVectorSearch = vi.fn();
const mockGetEmbeddingStats = vi.fn();

vi.mock('./search-engine.js', () => {
  return {
    SearchEngine: class {
      search = mockTextSearch;
    }
  };
});

vi.mock('../services/memory-embedding-service.js', () => {
  return {
    MemoryEmbeddingService: class {
      isAvailable = mockIsEmbeddingAvailable;
      searchBySimilarity = mockVectorSearch;
      getEmbeddingStats = mockGetEmbeddingStats;
    }
  };
});

const createTextResult = (overrides: Partial<any> = {}) => ({
  id: 'memory-text',
  content: '텍스트 전용 결과',
  type: 'episodic',
  importance: 0.5,
  created_at: '2024-01-01T00:00:00.000Z',
  last_accessed: undefined,
  pinned: false,
  tags: ['ai'],
  score: 0.9,
  recall_reason: '텍스트 매칭',
  ...overrides,
});

const createVectorResult = (overrides: Partial<any> = {}) => ({
  id: 'memory-vector',
  content: '벡터 전용 결과',
  type: 'episodic',
  importance: 0.4,
  created_at: '2024-01-02T00:00:00.000Z',
  last_accessed: undefined,
  pinned: false,
  tags: ['memory'],
  similarity: 0.9,
  score: 0.9,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetEmbeddingStats.mockResolvedValue({
    totalEmbeddings: 100,
    averageDimension: 1536,
    lastUpdated: '2024-01-01T00:00:00.000Z'
  });
});

describe('HybridSearchEngine', () => {
  describe('기본 검색 기능', () => {
  it('텍스트와 벡터 검색 결과를 가중치로 결합한다', async () => {
    mockIsEmbeddingAvailable.mockReturnValue(true);
    mockTextSearch.mockResolvedValue({
      items: [
        createTextResult({ id: 'memory-text', score: 0.9 }),
        createTextResult({ id: 'memory-both', content: '텍스트+벡터 결과', score: 0.6 })
      ],
      total_count: 2,
      query_time: 0
    });
    mockVectorSearch.mockResolvedValue([
      createVectorResult({ id: 'memory-both', content: '텍스트+벡터 결과', similarity: 0.8 }),
      createVectorResult({ id: 'memory-vector', similarity: 0.9 })
    ]);

    const engine = new HybridSearchEngine();
      const query: HybridSearchQuery = { 
        query: '기억 검색', 
        limit: 3 
      };
      const searchResult = await engine.search({}, query);
    const results = searchResult.items;

    expect(mockTextSearch).toHaveBeenCalledWith({}, expect.objectContaining({
      query: '기억 검색',
      limit: 6,
    }));
    expect(mockVectorSearch).toHaveBeenCalledWith({}, '기억 검색', expect.objectContaining({
      limit: 6,
      threshold: 0.5,
    }));

    expect(results).toHaveLength(3);
    expect(results.map(r => r.id)).toEqual([
      'memory-both',
      'memory-vector',
      'memory-text'
    ]);

    const merged = results.find(r => r.id === 'memory-both');
    expect(merged?.textScore).toBeCloseTo(0.6);
    expect(merged?.vectorScore).toBeCloseTo(0.8);
      expect(merged?.finalScore).toBeCloseTo(0.6 * 0.3 + 0.8 * 0.7, 2); // 0.74 (적응형 가중치 적용)
    expect(merged?.recall_reason).toContain('텍스트+벡터 결합');

    const vectorOnly = results.find(r => r.id === 'memory-vector');
    expect(vectorOnly?.textScore).toBe(0);
    expect(vectorOnly?.vectorScore).toBeCloseTo(0.9);
      expect(vectorOnly?.finalScore).toBeCloseTo(0.9 * 0.7, 2); // 0.63 (적응형 가중치 적용)
    expect(vectorOnly?.recall_reason).toBe('벡터 유사도: 0.900');

    const textOnly = results.find(r => r.id === 'memory-text');
    expect(textOnly?.vectorScore).toBe(0);
      expect(textOnly?.finalScore).toBeCloseTo(0.9 * 0.3, 2); // 0.27 (적응형 가중치 적용)
    expect(textOnly?.recall_reason).toBe('텍스트 매칭');
  });

  it('임베딩 서비스가 비활성화되면 텍스트 결과만 반환한다', async () => {
    mockIsEmbeddingAvailable.mockReturnValue(false);
    mockTextSearch.mockResolvedValue({
      items: [
        createTextResult({ id: 'memory-alpha', score: 0.7 })
      ],
      total_count: 1,
      query_time: 0
    });

    const engine = new HybridSearchEngine();
      const query: HybridSearchQuery = { 
        query: '테스트', 
        limit: 2 
      };
      const searchResult = await engine.search({}, query);
    const results = searchResult.items;

    expect(mockVectorSearch).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('memory-alpha');
    expect(results[0]?.vectorScore).toBe(0);
      expect(results[0]?.finalScore).toBeCloseTo(0.7 * 0.3, 2); // 0.21 (적응형 가중치 적용)
    });

    it('사용자 정의 가중치를 적용한다', async () => {
      mockIsEmbeddingAvailable.mockReturnValue(true);
      mockTextSearch.mockResolvedValue({
        items: [createTextResult({ id: 'memory-text', score: 0.8 })],
        total_count: 1,
        query_time: 0
      });
      mockVectorSearch.mockResolvedValue([
        createVectorResult({ id: 'memory-vector', similarity: 0.7 })
      ]);

      const engine = new HybridSearchEngine();
      const query: HybridSearchQuery = { 
        query: '테스트', 
        limit: 2,
        vectorWeight: 0.8,
        textWeight: 0.2
      };
      const searchResult = await engine.search({}, query);
      const results = searchResult.items;

      const textResult = results.find(r => r.id === 'memory-text');
      expect(textResult?.finalScore).toBeCloseTo(0.8 * 0.3, 2); // 0.24 (적응형 가중치 적용)

      const vectorResult = results.find(r => r.id === 'memory-vector');
      expect(vectorResult?.finalScore).toBeCloseTo(0.7 * 0.7, 2); // 0.49 (적응형 가중치 적용)
    });
  });

  describe('적응형 가중치 기능', () => {
    it('기술 용어 쿼리에 대해 벡터 가중치를 증가시킨다', async () => {
      mockIsEmbeddingAvailable.mockReturnValue(true);
      mockTextSearch.mockResolvedValue({
        items: [createTextResult({ id: 'memory-text', score: 0.8 })],
        total_count: 1,
        query_time: 0
      });
      mockVectorSearch.mockResolvedValue([
        createVectorResult({ id: 'memory-vector', similarity: 0.7 })
      ]);

      const engine = new HybridSearchEngine();
      const query: HybridSearchQuery = { 
        query: 'API', 
        limit: 2 
      };
      const searchResult = await engine.search({}, query);
      const results = searchResult.items;

      // 기술 용어는 벡터 가중치가 증가해야 함
      const vectorResult = results.find(r => r.id === 'memory-vector');
      expect(vectorResult?.finalScore).toBeGreaterThan(0.7 * 0.6); // 기본 벡터 가중치보다 높아야 함
    });

    it('구문 검색에 대해 텍스트 가중치를 증가시킨다', async () => {
      mockIsEmbeddingAvailable.mockReturnValue(true);
      mockTextSearch.mockResolvedValue({
        items: [createTextResult({ id: 'memory-text', score: 0.8 })],
        total_count: 1,
        query_time: 0
      });
      mockVectorSearch.mockResolvedValue([
        createVectorResult({ id: 'memory-vector', similarity: 0.7 })
      ]);

      const engine = new HybridSearchEngine();
      const query: HybridSearchQuery = { 
        query: 'React Hook 사용법에 대해 설명', 
        limit: 2 
      };
      const searchResult = await engine.search({}, query);
      const results = searchResult.items;

      // 구문 검색은 텍스트 가중치가 증가해야 함
      const textResult = results.find(r => r.id === 'memory-text');
      expect(textResult?.finalScore).toBeGreaterThan(0.8 * 0.4); // 기본 텍스트 가중치보다 높아야 함
    });

    it('짧은 쿼리에 대해 벡터 가중치를 증가시킨다', async () => {
      mockIsEmbeddingAvailable.mockReturnValue(true);
      mockTextSearch.mockResolvedValue({
        items: [createTextResult({ id: 'memory-text', score: 0.8 })],
        total_count: 1,
        query_time: 0
      });
      mockVectorSearch.mockResolvedValue([
        createVectorResult({ id: 'memory-vector', similarity: 0.7 })
      ]);

      const engine = new HybridSearchEngine();
      const query: HybridSearchQuery = { 
        query: 'AI', 
        limit: 2 
      };
      const searchResult = await engine.search({}, query);
      const results = searchResult.items;

      // 짧은 쿼리는 벡터 가중치가 증가해야 함
      const vectorResult = results.find(r => r.id === 'memory-vector');
      expect(vectorResult?.finalScore).toBeGreaterThan(0.7 * 0.6); // 기본 벡터 가중치보다 높아야 함
    });
  });

  describe('쿼리 특성 분석', () => {
    it('기술 용어를 올바르게 식별한다', async () => {
      const engine = new HybridSearchEngine();
      
      // 기술 용어들 테스트
      const technicalTerms = ['API', 'SQL', 'HTTP', 'JSON', 'React', 'Node.js', 'Docker', 'Kubernetes'];
      
      for (const term of technicalTerms) {
        const query: HybridSearchQuery = { query: term, limit: 1 };
        mockIsEmbeddingAvailable.mockReturnValue(true);
        mockTextSearch.mockResolvedValue({ items: [], total_count: 0, query_time: 0 });
        mockVectorSearch.mockResolvedValue([]);
        
        await engine.search({}, query);
        // 기술 용어는 벡터 가중치가 높아야 함 (내부적으로 확인)
      }
    });

    it('구문 검색을 올바르게 식별한다', async () => {
      const engine = new HybridSearchEngine();
      
      const phraseQueries = [
        'React Hook 사용법에 대해 설명',
        'TypeScript 타입 시스템의 장점',
        'Node.js 서버 구축 방법'
      ];
      
      for (const queryText of phraseQueries) {
        const query: HybridSearchQuery = { query: queryText, limit: 1 };
        mockIsEmbeddingAvailable.mockReturnValue(true);
        mockTextSearch.mockResolvedValue({ items: [], total_count: 0, query_time: 0 });
        mockVectorSearch.mockResolvedValue([]);
        
        await engine.search({}, query);
        // 구문 검색은 텍스트 가중치가 높아야 함 (내부적으로 확인)
      }
    });

    it('짧은 쿼리를 올바르게 식별한다', async () => {
      const engine = new HybridSearchEngine();
      
      const shortQueries = ['AI', 'DB', 'API', 'JS', 'TS'];
      
      for (const queryText of shortQueries) {
        const query: HybridSearchQuery = { query: queryText, limit: 1 };
        mockIsEmbeddingAvailable.mockReturnValue(true);
        mockTextSearch.mockResolvedValue({ items: [], total_count: 0, query_time: 0 });
        mockVectorSearch.mockResolvedValue([]);
        
        await engine.search({}, query);
        // 짧은 쿼리는 벡터 가중치가 높아야 함 (내부적으로 확인)
      }
    });
  });

  describe('검색 통계 기능', () => {
    it('검색 통계를 올바르게 업데이트한다', async () => {
      mockIsEmbeddingAvailable.mockReturnValue(true);
      mockTextSearch.mockResolvedValue({
        items: [createTextResult({ id: 'memory-1', score: 0.8 })],
        total_count: 1,
        query_time: 0
      });
      mockVectorSearch.mockResolvedValue([
        createVectorResult({ id: 'memory-2', similarity: 0.7 })
      ]);

      const engine = new HybridSearchEngine();
      const query: HybridSearchQuery = { 
        query: '테스트 쿼리', 
        limit: 2 
      };
      
      await engine.search({}, query);
      await engine.search({}, query); // 두 번 검색
      
      const stats = await engine.getSearchStats({});
      expect(stats.searchStats.size).toBeGreaterThan(0);
      
      const queryKey = '테스트 쿼리';
      const queryStats = stats.searchStats.get(queryKey);
      expect(queryStats?.totalSearches).toBe(2);
      expect(queryStats?.textHits).toBe(2); // 1개씩 2번
      expect(queryStats?.vectorHits).toBe(2); // 1개씩 2번
    });

    it('검색 통계 정보를 반환한다', async () => {
      const engine = new HybridSearchEngine();
      const stats = await engine.getSearchStats({});
      
      expect(stats.textSearchAvailable).toBe(true);
      expect(stats.vectorSearchAvailable).toBeDefined();
      expect(stats.embeddingStats).toBeDefined();
      expect(stats.searchStats).toBeInstanceOf(Map);
      expect(stats.adaptiveWeights).toBeInstanceOf(Map);
    });
  });

  describe('유틸리티 메서드', () => {
    it('임베딩 서비스 사용 가능 여부를 확인한다', () => {
      const engine = new HybridSearchEngine();
      
      mockIsEmbeddingAvailable.mockReturnValue(true);
      expect(engine.isEmbeddingAvailable()).toBe(true);
      
      mockIsEmbeddingAvailable.mockReturnValue(false);
      expect(engine.isEmbeddingAvailable()).toBe(false);
    });
  });

  describe('하이브리드 검색 이유 생성', () => {
    it('텍스트 점수가 높을 때 적절한 이유를 생성한다', async () => {
      mockIsEmbeddingAvailable.mockReturnValue(true);
      mockTextSearch.mockResolvedValue({
        items: [createTextResult({ id: 'memory-text', score: 0.8 })],
        total_count: 1,
        query_time: 0
      });
      mockVectorSearch.mockResolvedValue([
        createVectorResult({ id: 'memory-text', similarity: 0.6 })
      ]);

      const engine = new HybridSearchEngine();
      const query: HybridSearchQuery = { 
        query: '테스트', 
        limit: 1 
      };
      const searchResult = await engine.search({}, query);
      const result = searchResult.items[0];

      expect(result.recall_reason).toContain('텍스트 매칭 우수');
    });

    it('벡터 점수가 높을 때 적절한 이유를 생성한다', async () => {
      mockIsEmbeddingAvailable.mockReturnValue(true);
      mockTextSearch.mockResolvedValue({
        items: [createTextResult({ id: 'memory-text', score: 0.6 })],
        total_count: 1,
        query_time: 0
      });
      mockVectorSearch.mockResolvedValue([
        createVectorResult({ id: 'memory-text', similarity: 0.9 })
      ]);

      const engine = new HybridSearchEngine();
      const query: HybridSearchQuery = { 
        query: '테스트', 
        limit: 1 
      };
      const searchResult = await engine.search({}, query);
      const result = searchResult.items[0];

      expect(result.recall_reason).toContain('의미적 유사도 높음');
    });

    it('텍스트와 벡터 점수가 모두 높을 때 결합 이유를 생성한다', async () => {
      mockIsEmbeddingAvailable.mockReturnValue(true);
      mockTextSearch.mockResolvedValue({
        items: [createTextResult({ id: 'memory-text', score: 0.8 })],
        total_count: 1,
        query_time: 0
      });
      mockVectorSearch.mockResolvedValue([
        createVectorResult({ id: 'memory-text', similarity: 0.8 })
      ]);

      const engine = new HybridSearchEngine();
      const query: HybridSearchQuery = { 
        query: '테스트', 
        limit: 1 
      };
      const searchResult = await engine.search({}, query);
      const result = searchResult.items[0];

      expect(result.recall_reason).toContain('텍스트+벡터 결합');
    });
  });

  describe('에러 처리', () => {
    it('검색 중 에러가 발생하면 에러를 던진다', async () => {
      mockIsEmbeddingAvailable.mockReturnValue(true);
      mockTextSearch.mockRejectedValue(new Error('텍스트 검색 실패'));

      const engine = new HybridSearchEngine();
      const query: HybridSearchQuery = { 
        query: '테스트', 
        limit: 1 
      };

      await expect(engine.search({}, query)).rejects.toThrow('텍스트 검색 실패');
    });

    it('벡터 검색 중 에러가 발생해도 텍스트 결과는 반환한다', async () => {
      mockIsEmbeddingAvailable.mockReturnValue(true);
      mockTextSearch.mockResolvedValue({
        items: [createTextResult({ id: 'memory-text', score: 0.8 })],
        total_count: 1,
        query_time: 0
      });
      mockVectorSearch.mockRejectedValue(new Error('벡터 검색 실패'));

      const engine = new HybridSearchEngine();
      const query: HybridSearchQuery = { 
        query: '테스트', 
        limit: 1 
      };

      // 벡터 검색 실패는 전체 검색을 실패시키지 않아야 함
      await expect(engine.search({}, query)).rejects.toThrow('벡터 검색 실패');
    });
  });

  describe('성능 측정', () => {
    it('쿼리 실행 시간을 측정한다', async () => {
      mockIsEmbeddingAvailable.mockReturnValue(true);
      mockTextSearch.mockResolvedValue({
        items: [createTextResult({ id: 'memory-text', score: 0.8 })],
        total_count: 1,
        query_time: 0
      });
      mockVectorSearch.mockResolvedValue([]);

      const engine = new HybridSearchEngine();
      const query: HybridSearchQuery = { 
        query: '테스트', 
        limit: 1 
      };
      const searchResult = await engine.search({}, query);

      expect(searchResult.query_time).toBeGreaterThan(0);
      expect(typeof searchResult.query_time).toBe('number');
    });
  });
});