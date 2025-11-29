/**
 * 리팩토링된 벡터 검색 엔진 테스트
 * 기존 인터페이스와의 호환성 검증
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  VectorSearchEngineRefactored,
  getVectorSearchEngine,
  createVectorSearchEngine,
  resetVectorSearchEngine
} from './vector-search-engine-refactored';
import Database from 'better-sqlite3';

// Mock Database
vi.mock('better-sqlite3');
const MockDatabase = Database as any;

// Mock @xenova/transformers to prevent onnxruntime-node loading
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

// Mock VectorSearchContainer to prevent native module loading
vi.mock('../services/vector-search/vector-search-container', () => {
  return {
    VectorSearchContainer: {
      getInstance: vi.fn()
    }
  };
});

// Import after mocking to ensure mocked version is used
import { VectorSearchContainer } from '../../vector-search/vector-search-container';

describe('VectorSearchEngineRefactored', () => {
  let engine: VectorSearchEngineRefactored;
  let mockDb: any;
  let mockContainer: any;

  beforeEach(() => {
    // Mock Database 인스턴스
    mockDb = {
      prepare: vi.fn(),
      exec: vi.fn(),
      close: vi.fn(),
      isOpen: vi.fn().mockReturnValue(true)
    };

    // Mock Container
    mockContainer = {
      setDatabase: vi.fn(),
      getFacade: vi.fn(),
      isConnected: vi.fn().mockReturnValue(true),
      reset: vi.fn()
    };

    // Container 싱글톤 모킹
    vi.spyOn(VectorSearchContainer, 'getInstance').mockReturnValue(mockContainer);

    engine = new VectorSearchEngineRefactored();
  });

  afterEach(() => {
    // Mock 정리
    vi.clearAllMocks();
    // Spy 복원
    vi.restoreAllMocks();
    // 인스턴스 정리
    engine = null as any;
    mockDb = null;
    mockContainer = null;
  });

  describe('initialize', () => {
    it('should initialize database connection', () => {
      // When
      engine.initialize(mockDb);

      // Then
      expect(mockContainer.setDatabase).toHaveBeenCalledWith(mockDb);
    });
  });

  describe('search', () => {
    it('should perform vector search', async () => {
      // Given
      const queryVector = new Array(384).fill(0.1);
      const options = { limit: 10 };
      const provider = 'tfidf';
      
      const expectedResults = [
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

      const mockFacade = {
        search: vi.fn().mockResolvedValue(expectedResults)
      };
      mockContainer.getFacade.mockReturnValue(mockFacade as any);

      // When
      const results = await engine.search(queryVector, options, provider);

      // Then
      expect(results).toEqual(expectedResults);
      expect(mockFacade.search).toHaveBeenCalledWith({
        queryVector,
        options,
        provider
      });
    });
  });

  describe('hybridSearch', () => {
    it('should perform hybrid search', async () => {
      // Given
      const queryVector = new Array(384).fill(0.1);
      const textQuery = 'test query';
      const options = { limit: 10 };
      const provider = 'tfidf';

      const expectedResults = [
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

      const mockFacade = {
        hybridSearch: vi.fn().mockResolvedValue(expectedResults)
      };
      mockContainer.getFacade.mockReturnValue(mockFacade as any);

      // When
      const results = await engine.hybridSearch(queryVector, textQuery, options, provider);

      // Then
      expect(results).toEqual(expectedResults);
      expect(mockFacade.hybridSearch).toHaveBeenCalledWith({
        queryVector,
        textQuery,
        options,
        provider
      });
    });
  });

  describe('getIndexStatus', () => {
    it('should return index status', () => {
      // Given
      const expectedStatus = {
        available: true,
        tableExists: true,
        recordCount: 100,
        dimensions: 384,
        vecExtensionLoaded: true
      };

      const mockFacade = {
        getIndexStatus: vi.fn().mockReturnValue(expectedStatus)
      };
      mockContainer.getFacade.mockReturnValue(mockFacade as any);

      // When
      const status = engine.getIndexStatus();

      // Then
      expect(status).toEqual(expectedStatus);
      expect(mockFacade.getIndexStatus).toHaveBeenCalled();
    });
  });

  describe('rebuildIndex', () => {
    it('should rebuild index', async () => {
      // Given
      const mockFacade = {
        rebuildIndex: vi.fn().mockResolvedValue(true)
      };
      mockContainer.getFacade.mockReturnValue(mockFacade as any);

      // When
      const result = await engine.rebuildIndex();

      // Then
      expect(result).toBe(true);
      expect(mockFacade.rebuildIndex).toHaveBeenCalled();
    });
  });

  describe('performanceTest', () => {
    it('should run performance test', async () => {
      // Given
      const queryVector = new Array(384).fill(0.1);
      const iterations = 5;
      
      const expectedResult = {
        averageTime: 25.5,
        minTime: 20,
        maxTime: 30,
        results: 10,
        successRate: 1.0
      };

      const mockFacade = {
        runPerformanceTest: vi.fn().mockResolvedValue(expectedResult)
      };
      mockContainer.getFacade.mockReturnValue(mockFacade as any);

      // When
      const result = await engine.performanceTest(queryVector, iterations);

      // Then
      expect(result).toEqual(expectedResult);
      expect(mockFacade.runPerformanceTest).toHaveBeenCalledWith(queryVector, iterations);
    });
  });

  describe('getDimensions', () => {
    it('should return default dimensions', () => {
      // When
      const dimensions = engine.getDimensions();

      // Then
      expect(dimensions).toBe(384);
    });
  });

  describe('isAvailable', () => {
    it('should return availability status', () => {
      // Given
      const mockFacade = {
        isAvailable: vi.fn().mockReturnValue(true)
      };
      mockContainer.getFacade.mockReturnValue(mockFacade as any);

      // When
      const available = engine.isAvailable();

      // Then
      expect(available).toBe(true);
      expect(mockFacade.isAvailable).toHaveBeenCalled();
    });
  });

  describe('isConnected', () => {
    it('should return connection status', () => {
      // Given
      mockContainer.isConnected.mockReturnValue(true);

      // When
      const connected = engine.isConnected();

      // Then
      expect(connected).toBe(true);
      expect(mockContainer.isConnected).toHaveBeenCalled();
    });
  });
});

describe('Factory Functions', () => {
  describe('getVectorSearchEngine', () => {
    it('should return singleton instance', () => {
      // When
      const engine1 = getVectorSearchEngine();
      const engine2 = getVectorSearchEngine();

      // Then
      expect(engine1).toBeInstanceOf(VectorSearchEngineRefactored);
      expect(engine2).toBeInstanceOf(VectorSearchEngineRefactored);
    });
  });

  describe('createVectorSearchEngine', () => {
    it('should create new instance', () => {
      // When
      const engine = createVectorSearchEngine();

      // Then
      expect(engine).toBeInstanceOf(VectorSearchEngineRefactored);
    });
  });

  describe('resetVectorSearchEngine', () => {
    it('should reset container', () => {
      // Given
      const mockContainer = {
        reset: vi.fn()
      };
      vi.spyOn(VectorSearchContainer, 'getInstance').mockReturnValue(mockContainer as any);

      // When
      resetVectorSearchEngine();

      // Then
      expect(mockContainer.reset).toHaveBeenCalled();
    });
  });
});
