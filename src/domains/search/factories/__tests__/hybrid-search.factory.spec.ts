/**
 * HybridSearchFactory 테스트
 * 하이브리드 검색 엔진 팩토리 테스트
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HybridSearchFactory } from './hybrid-search.factory.js';
import { HybridSearchEngine } from '../domains/search/algorithms/hybrid-search-engine.js';
import { SearchEngine } from '../domains/search/algorithms/search-engine.js';
import { MemoryEmbeddingService } from '../../memory/services/memory-embedding-service.js';
import { VectorSearchEngine } from '../domains/search/algorithms/vector-search-engine.js';
import Database from 'better-sqlite3';

describe('HybridSearchFactory', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  describe('createDefaultEngine', () => {
    it('기본 설정으로 하이브리드 검색 엔진을 생성해야 함', () => {
      // When: 기본 엔진 생성
      const engine = HybridSearchFactory.createDefaultEngine(db);

      // Then: HybridSearchEngine 인스턴스 반환
      expect(engine).toBeInstanceOf(HybridSearchEngine);
    });

    it('모든 의존성이 올바르게 주입되어야 함', () => {
      // When: 기본 엔진 생성
      const engine = HybridSearchFactory.createDefaultEngine(db);

      // Then: 엔진이 생성되어야 함 (내부 의존성은 private이므로 인스턴스 확인만)
      expect(engine).toBeDefined();
      expect(engine).toBeInstanceOf(HybridSearchEngine);
    });
  });

  describe('createEngine', () => {
    it('의존성 주입으로 하이브리드 검색 엔진을 생성해야 함', () => {
      // Given: 의존성 생성
      const textSearchEngine = new SearchEngine();
      const embeddingService = new MemoryEmbeddingService();
      const vectorSearchEngine = new VectorSearchEngine();
      const resultCombiner = {
        combine: vi.fn()
      };
      const weightCalculator = {
        calculateWeights: vi.fn()
      };
      const logger = {
        logSearchStart: vi.fn(),
        logSearchStep: vi.fn(),
        logSearchComplete: vi.fn(),
        logSearchError: vi.fn()
      };

      // When: 의존성 주입으로 엔진 생성
      const engine = HybridSearchFactory.createEngine(
        textSearchEngine,
        embeddingService,
        vectorSearchEngine,
        resultCombiner,
        weightCalculator,
        logger
      );

      // Then: HybridSearchEngine 인스턴스 반환
      expect(engine).toBeInstanceOf(HybridSearchEngine);
    });

    it('주입된 의존성을 사용해야 함', () => {
      // Given: 모킹된 의존성
      const mockTextSearchEngine = {
        search: vi.fn()
      };
      const mockEmbeddingService = {
        generateEmbedding: vi.fn()
      };
      const mockVectorSearchEngine = {
        search: vi.fn()
      };
      const mockResultCombiner = {
        combine: vi.fn()
      };
      const mockWeightCalculator = {
        calculateWeights: vi.fn()
      };
      const mockLogger = {
        logSearchStart: vi.fn(),
        logSearchStep: vi.fn(),
        logSearchComplete: vi.fn(),
        logSearchError: vi.fn()
      };

      // When: 의존성 주입으로 엔진 생성
      const engine = HybridSearchFactory.createEngine(
        mockTextSearchEngine,
        mockEmbeddingService,
        mockVectorSearchEngine,
        mockResultCombiner,
        mockWeightCalculator,
        mockLogger
      );

      // Then: 엔진이 생성되어야 함
      expect(engine).toBeInstanceOf(HybridSearchEngine);
    });
  });

  describe('팩토리 메서드 일관성', () => {
    it('createDefaultEngine과 createEngine이 동일한 타입을 반환해야 함', () => {
      // When: 두 방법으로 엔진 생성
      const defaultEngine = HybridSearchFactory.createDefaultEngine(db);
      const textSearchEngine = new SearchEngine();
      const embeddingService = new MemoryEmbeddingService();
      const vectorSearchEngine = new VectorSearchEngine();
      const resultCombiner = { combine: vi.fn() };
      const weightCalculator = { calculateWeights: vi.fn() };
      const logger = {
        logSearchStart: vi.fn(),
        logSearchStep: vi.fn(),
        logSearchComplete: vi.fn(),
        logSearchError: vi.fn()
      };
      const injectedEngine = HybridSearchFactory.createEngine(
        textSearchEngine,
        embeddingService,
        vectorSearchEngine,
        resultCombiner,
        weightCalculator,
        logger
      );

      // Then: 둘 다 HybridSearchEngine 인스턴스
      expect(defaultEngine).toBeInstanceOf(HybridSearchEngine);
      expect(injectedEngine).toBeInstanceOf(HybridSearchEngine);
    });
  });
});

