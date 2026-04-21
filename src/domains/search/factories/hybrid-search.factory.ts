/**
 * 하이브리드 검색 엔진 팩토리
 * 의존성 주입 및 객체 생성 관리
 */

import type { Database } from 'better-sqlite3';
import { logger } from '../../../shared/utils/logger.js';
import { MemoryEmbeddingService } from '../../memory/services/memory-embedding-service.js';
import { HybridSearchEngine,resolveQueryUnifiedEmbeddingForHybridSearch } from '../algorithms/hybrid-search-engine.js';
import { SearchEngine } from '../algorithms/search-engine.js';
import { VectorSearchEngine } from '../algorithms/vector-search-engine.js';

// Mock implementations for missing services
class MockSearchResultCombiner {
  combine(textResults: any[], vectorResults: any[], _textWeight: number, _vectorWeight: number): any[] {
    return [...vectorResults, ...textResults];
  }
}

class MockAdaptiveWeightCalculator {
  calculateWeights(_query: string, _vectorWeight: number, _textWeight: number): { vectorWeight: number, textWeight: number } {
    return { vectorWeight: 0.6, textWeight: 0.4 };
  }
}

class MockSearchLogger {
  logSearchStart(query: string): void {
    logger.info('검색 시작', { query });
  }
  
  logSearchStep(step: string, details?: any): void {
    logger.debug('검색 단계', { step, details });
  }
  
  logSearchComplete(searchId: string, result: { items: unknown[]; total_count: number }, queryTime: number): void {
    logger.info('검색 완료', {
      searchId,
      resultCount: result.total_count,
      duration: queryTime
    });
  }
  
  logSearchError(query: string, error: Error): void {
    logger.error('검색 에러', {
      query,
      error: error.message
    });
  }
}

export interface CreateDefaultHybridEngineOptions {
  /** 지정 시 해당 TOML에서 랭킹 가중치 로드 (미지정 시 기본 config/ranking-weights.toml 등) */
  rankingWeightsPath?: string;
}

/**
 * 하이브리드 검색 엔진 팩토리
 */
export class HybridSearchFactory {
  /**
   * 기본 설정으로 하이브리드 검색 엔진 생성
   */
  static createDefaultEngine(
    db: Database,
    embeddingService?: MemoryEmbeddingService,
    options?: CreateDefaultHybridEngineOptions
  ): HybridSearchEngine {
    const textSearchEngine = new SearchEngine();
    const emb = embeddingService ?? new MemoryEmbeddingService();
    const vectorSearchEngine = new VectorSearchEngine();
    const resultCombiner = new MockSearchResultCombiner();
    const weightCalculator = new MockAdaptiveWeightCalculator();
    const logger = new MockSearchLogger();

    return new HybridSearchEngine(
      textSearchEngine,
      emb,
      vectorSearchEngine,
      resultCombiner,
      weightCalculator,
      logger,
      resolveQueryUnifiedEmbeddingForHybridSearch(emb),
      undefined,
      undefined,
      options?.rankingWeightsPath
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
    const queryUnified = resolveQueryUnifiedEmbeddingForHybridSearch(embeddingService);
    return new HybridSearchEngine(
      textSearchEngine,
      embeddingService,
      vectorSearchEngine,
      resultCombiner,
      weightCalculator,
      logger,
      queryUnified
    );
  }
}
