/**
 * 벡터 검색 파사드 테스트
 * 통합 테스트 및 의존성 주입 검증
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock @xenova/transformers to prevent sharp module loading issues
vi.mock('@xenova/transformers', () => {
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

import { VectorSearchFacade } from './vector-search-facade';
import type { 
  VectorSearchRepository, 
  VectorIndexRepository, 
  VectorPerformanceRepository 
} from '../../shared/interfaces/database.interface';
import type { 
  VectorSearchQuery, 
  VectorSearchResult, 
  VectorIndexStatus,
  PerformanceTestResult 
} from '../../shared/types/vector-search.types';

// Mock 리포지토리들 생성
const createMockRepositories = () => ({
  searchRepository: {
    search: vi.fn(),
    hybridSearch: vi.fn(),
    getIndexStatus: vi.fn(),
    rebuildIndex: vi.fn(),
    getTableName: vi.fn(),
    checkVecAvailability: vi.fn()
  },
  
  indexRepository: {
    getIndexStatus: vi.fn(),
    rebuildIndex: vi.fn(),
    checkAvailability: vi.fn()
  },
  
  performanceRepository: {
    runPerformanceTest: vi.fn()
  }
});

describe('VectorSearchFacade', () => {
  let facade: VectorSearchFacade;
  let mockRepositories: ReturnType<typeof createMockRepositories>;

  beforeEach(() => {
    mockRepositories = createMockRepositories();
    facade = new VectorSearchFacade(
      mockRepositories.searchRepository,
      mockRepositories.indexRepository,
      mockRepositories.performanceRepository
    );
  });

  describe('search', () => {
    it('should delegate search to search service', async () => {
      // Given
      const query: VectorSearchQuery = {
        queryVector: new Array(512).fill(0.1),
        options: { limit: 10 },
        provider: 'tfidf'
      };
      
      const expectedResults: VectorSearchResult[] = [
        {
          memory_id: 'test-1',
          similarity: 0.8,
          content: 'Test content',
          type: 'semantic',
          importance: 0.7,
          created_at: '2024-01-01T00:00:00Z',
          pinned: false
        }
      ];

      mockRepositories.searchRepository.search.mockResolvedValue(expectedResults);

      // When
      const results = await facade.search(query);

      // Then
      expect(results).toEqual(expectedResults);
      expect(mockRepositories.searchRepository.search).toHaveBeenCalledWith(query);
    });
  });

  describe('hybridSearch', () => {
    it('should delegate hybrid search to search service', async () => {
      // Given
      const query: VectorSearchQuery = {
        queryVector: new Array(512).fill(0.1),
        textQuery: 'test query',
        options: { limit: 10 },
        provider: 'tfidf'
      };

      const expectedResults: VectorSearchResult[] = [
        {
          memory_id: 'test-1',
          similarity: 0.9,
          content: 'Test content',
          type: 'semantic',
          importance: 0.8,
          created_at: '2024-01-01T00:00:00Z',
          pinned: false
        }
      ];

      mockRepositories.searchRepository.hybridSearch.mockResolvedValue(expectedResults);

      // When
      const results = await facade.hybridSearch(query);

      // Then
      expect(results).toEqual(expectedResults);
      expect(mockRepositories.searchRepository.hybridSearch).toHaveBeenCalledWith(query);
    });
  });

  it('should delegate unified search to search service', async () => {
    const expected = { providers: [], unified: [] };
    (facade as any).searchService = {
      unifiedSearch: vi.fn().mockResolvedValue(expected)
    };

    const result = await facade.unifiedSearch(
      {
        query: {
          queryVector: new Array(512).fill(0.1),
          options: { limit: 5 },
          provider: 'minilm'
        }
      },
      {} as any
    );

    expect(result).toBe(expected);
    expect((facade as any).searchService.unifiedSearch).toHaveBeenCalled();
  });

  describe('getIndexStatus', () => {
    it('should delegate to index manager', () => {
      // Given
      const expectedStatus: VectorIndexStatus = {
        available: true,
        tableExists: true,
        recordCount: 100,
        dimensions: 384,
        vecExtensionLoaded: true
      };

      mockRepositories.indexRepository.getIndexStatus.mockReturnValue(expectedStatus);

      // When
      const status = facade.getIndexStatus();

      // Then
      expect(status).toEqual(expectedStatus);
      expect(mockRepositories.indexRepository.getIndexStatus).toHaveBeenCalled();
    });
  });

  describe('rebuildIndex', () => {
    it('should delegate to index manager', async () => {
      // Given
      mockRepositories.indexRepository.rebuildIndex.mockResolvedValue(true);

      // When
      const result = await facade.rebuildIndex();

      // Then
      expect(result).toBe(true);
      expect(mockRepositories.indexRepository.rebuildIndex).toHaveBeenCalled();
    });
  });

  describe('isAvailable', () => {
    it('should delegate to index manager', () => {
      // Given
      mockRepositories.indexRepository.checkAvailability.mockReturnValue(true);

      // When
      const available = facade.isAvailable();

      // Then
      expect(available).toBe(true);
      expect(mockRepositories.indexRepository.checkAvailability).toHaveBeenCalled();
    });
  });

  describe('runPerformanceTest', () => {
    it('should delegate to performance tester', async () => {
      // Given
      const queryVector = new Array(384).fill(0.1);
      const iterations = 5;
      const expectedResult: PerformanceTestResult = {
        averageTime: 25.5,
        minTime: 20,
        maxTime: 30,
        results: 10,
        successRate: 1.0
      };

      mockRepositories.performanceRepository.runPerformanceTest.mockResolvedValue(expectedResult);

      // When
      const result = await facade.runPerformanceTest(queryVector, iterations);

      // Then
      expect(result).toEqual(expectedResult);
      expect(mockRepositories.performanceRepository.runPerformanceTest).toHaveBeenCalledWith(queryVector, iterations);
    });
  });

  describe('analyzePerformance', () => {
    it('should analyze performance results', () => {
      // Given
      const result: PerformanceTestResult = {
        averageTime: 25.5,
        minTime: 20,
        maxTime: 30,
        results: 10,
        successRate: 1.0
      };

      // When
      const analysis = facade.analyzePerformance(result);

      // Then
      expect(analysis.performance).toBe('good');
      expect(analysis.recommendations).toHaveLength(0);
    });
  });

  describe('generatePerformanceReport', () => {
    it('should generate performance report', () => {
      // Given
      const result: PerformanceTestResult = {
        averageTime: 25.5,
        minTime: 20,
        maxTime: 30,
        results: 10,
        successRate: 1.0
      };

      // When
      const report = facade.generatePerformanceReport(result);

      // Then
      expect(report).toContain('벡터 검색 성능 테스트 리포트');
      expect(report).toContain('평균 응답 시간: 25.50ms');
    });
  });

  describe('getStatusSummary', () => {
    it('should get status summary from index manager', () => {
      // Given
      const expectedStatus: VectorIndexStatus = {
        available: true,
        tableExists: true,
        recordCount: 50,
        dimensions: 384,
        vecExtensionLoaded: true
      };

      mockRepositories.indexRepository.getIndexStatus.mockReturnValue(expectedStatus);

      // When
      const summary = facade.getStatusSummary();

      // Then
      expect(summary).toContain('사용가능');
      expect(summary).toContain('존재');
      expect(summary).toContain('50개');
    });
  });

  describe('getSystemStatus', () => {
    it('should return comprehensive system status', () => {
      // Given
      const expectedStatus: VectorIndexStatus = {
        available: true,
        tableExists: true,
        recordCount: 100,
        dimensions: 384,
        vecExtensionLoaded: true
      };

      mockRepositories.indexRepository.getIndexStatus.mockReturnValue(expectedStatus);
      mockRepositories.indexRepository.checkAvailability.mockReturnValue(true);

      // When
      const systemStatus = facade.getSystemStatus();

      // Then
      expect(systemStatus.available).toBe(true);
      expect(systemStatus.indexStatus).toEqual(expectedStatus);
      expect(systemStatus.summary).toContain('사용가능');
    });
  });
});
