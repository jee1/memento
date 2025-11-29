/**
 * 하이브리드 검색 엔진 팩토리
 * 의존성 주입 및 객체 생성 관리
 */

import { HybridSearchEngine } from '../algorithms/hybrid-search-engine.js';
import { SearchEngine } from '../algorithms/search-engine.js';
import { MemoryEmbeddingService } from '../domains/memory/services/memory-embedding-service.js';
import { VectorSearchEngine } from '../algorithms/vector-search-engine.js';
import type { Database } from 'better-sqlite3';

// Mock implementations for missing services
class MockSearchResultCombiner {
  combine(textResults: any[], vectorResults: any[], textWeight: number, vectorWeight: number): any[] {
    return [...vectorResults, ...textResults];
  }
}

class MockAdaptiveWeightCalculator {
  calculateWeights(query: string, vectorWeight: number, textWeight: number): { vectorWeight: number, textWeight: number } {
    return { vectorWeight: 0.6, textWeight: 0.4 };
  }
}

class MockSearchLogger {
  logSearchStart(query: string): void {
    console.log(`Search started: ${query}`);
  }
  
  logSearchStep(step: string, details?: any): void {
    console.log(`Search step: ${step}`, details);
  }
  
  logSearchComplete(searchId: string, result: { items: unknown[]; total_count: number }, queryTime: number): void {
    console.log(`Search completed: ${searchId}, Results: ${result.total_count}, Duration: ${queryTime}ms`);
  }
  
  logSearchError(query: string, error: Error): void {
    console.error(`Search error: ${query}`, error);
  }
}

/**
 * 하이브리드 검색 엔진 팩토리
 */
export class HybridSearchFactory {
  /**
   * 기본 설정으로 하이브리드 검색 엔진 생성
   */
  static createDefaultEngine(db: Database): HybridSearchEngine {
    const textSearchEngine = new SearchEngine();
    const embeddingService = new MemoryEmbeddingService();
    const vectorSearchEngine = new VectorSearchEngine();
    const resultCombiner = new MockSearchResultCombiner();
    const weightCalculator = new MockAdaptiveWeightCalculator();
    const logger = new MockSearchLogger();

    return new HybridSearchEngine(
      textSearchEngine,
      embeddingService,
      vectorSearchEngine,
      resultCombiner,
      weightCalculator,
      logger
    );
  }

  /**
   * 의존성 주입으로 하이브리드 검색 엔진 생성
   */
  static createEngine(
    textSearchEngine: any,
    embeddingService: any,
    vectorSearchEngine: any,
    resultCombiner: any,
    weightCalculator: any,
    logger: any
  ): HybridSearchEngine {
    return new HybridSearchEngine(
      textSearchEngine,
      embeddingService,
      vectorSearchEngine,
      resultCombiner,
      weightCalculator,
      logger
    );
  }
}
