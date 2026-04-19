/**
 * 하이브리드 검색 엔진 팩토리
 * 의존성 주입 및 객체 생성 관리
 */

import {
  HybridSearchEngine,
  AdaptiveWeightCalculator,
  resolveQueryUnifiedEmbeddingForHybridSearch,
} from '../algorithms/hybrid-search-engine.js';
import type {
  ITextSearchEngine,
  IEmbeddingService,
  IVectorSearchEngine,
  ISearchResultCombiner,
  IAdaptiveWeightCalculator,
  ISearchLogger,
  HybridSearchQuery,
} from '../algorithms/hybrid-search-engine.js';
import { SearchEngine } from '../algorithms/search-engine.js';
import { SearchResultCombiner } from '../algorithms/search-result-combiner.js';
import { MemoryEmbeddingService } from '../../memory/services/memory-embedding-service.js';
import { VectorSearchEngine } from '../algorithms/vector-search-engine.js';
import { logger } from '../../../shared/utils/logger.js';
import type { Database } from 'better-sqlite3';

class DefaultSearchLogger implements ISearchLogger {
  logSearchStart(searchId: string, query: HybridSearchQuery): void {
    logger.debug('하이브리드 검색 시작', { searchId, query: query.query });
  }

  logSearchStep(searchId: string, step: string, data: unknown): void {
    logger.debug(`하이브리드 검색 단계: ${step}`, { searchId, data });
  }

  logSearchComplete(
    searchId: string,
    result: { items: unknown[]; total_count: number },
    queryTime: number
  ): void {
    logger.info('하이브리드 검색 완료', {
      searchId,
      resultCount: result.total_count,
      queryTime,
    });
  }

  logSearchError(searchId: string, error: unknown, query: HybridSearchQuery): void {
    logger.error('하이브리드 검색 오류', { searchId, error, query: query.query });
  }
}

export interface CreateDefaultHybridEngineOptions {
  /** 지정 시 해당 TOML에서 랭킹 가중치 로드 (미지정 시 기본 config/ranking-weights.toml 등) */
  rankingWeightsPath?: string;
}

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
    const resultCombiner = new SearchResultCombiner();
    const weightCalculator = new AdaptiveWeightCalculator();
    const searchLogger = new DefaultSearchLogger();

    return new HybridSearchEngine(
      textSearchEngine,
      emb,
      vectorSearchEngine,
      resultCombiner,
      weightCalculator,
      searchLogger,
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
    textSearchEngine: ITextSearchEngine,
    embeddingService: IEmbeddingService,
    vectorSearchEngine: IVectorSearchEngine,
    resultCombiner: ISearchResultCombiner,
    weightCalculator: IAdaptiveWeightCalculator,
    searchLogger: ISearchLogger
  ): HybridSearchEngine {
    const queryUnified = resolveQueryUnifiedEmbeddingForHybridSearch(embeddingService);
    return new HybridSearchEngine(
      textSearchEngine,
      embeddingService,
      vectorSearchEngine,
      resultCombiner,
      weightCalculator,
      searchLogger,
      queryUnified
    );
  }
}
