/**
 * Fallback 검색 서비스 인터페이스 및 구현
 * Phase 2.5: anchor-search-service.ts 분리
 */

import type Database from 'better-sqlite3';
import type { HybridSearchEngine } from '../../../search/algorithms/hybrid-search-engine.js';
import type { SearchOptions, SearchResult } from './anchor-interfaces.js';
import { logger } from '../../../../shared/utils/logger.js';

/**
 * Fallback 검색 서비스 인터페이스
 */
export interface IFallbackSearchService {
  /**
   * 전역 검색으로 Fallback
   */
  fallbackToGlobalSearch(
    query: string,
    options: SearchOptions | undefined,
    startTime: number | undefined
  ): Promise<SearchResult>;
}

/**
 * Fallback 검색 서비스 구현
 */
export class FallbackSearchService implements IFallbackSearchService {
  private db: Database.Database | null = null;
  private hybridSearchEngine: HybridSearchEngine | null = null;

  /**
   * 데이터베이스 설정
   */
  setDatabase(db: Database.Database): void {
    if (!db) {
      throw new Error('Database instance is required');
    }
    this.db = db;
  }

  /**
   * 하이브리드 검색 엔진 설정
   */
  setHybridSearchEngine(hybridSearchEngine: HybridSearchEngine): void {
    if (!hybridSearchEngine) {
      throw new Error('HybridSearchEngine is required');
    }
    this.hybridSearchEngine = hybridSearchEngine;
  }

  /**
   * 전역 검색으로 Fallback
   */
  async fallbackToGlobalSearch(
    query: string,
    options: SearchOptions | undefined,
    startTime: number | undefined
  ): Promise<SearchResult> {
    if (!this.hybridSearchEngine) {
      throw new Error('HybridSearchEngine is not set. Call setHybridSearchEngine() first.');
    }

    if (!this.db) {
      throw new Error('Database is not set.');
    }

    const limit = options?.limit ?? 10;
    const fallbackStartTime = Date.now();

    try {
      // HybridSearchEngine을 사용한 전역 검색
      const globalSearchResult = await this.hybridSearchEngine.search(this.db, {
        query: query,
        limit: limit,
        vectorWeight: options?.vector_weight,
        textWeight: options?.text_weight
      });

      // HybridSearchResult를 SearchResult 형식으로 변환
      const convertedItems = globalSearchResult.items.map(item => ({
        id: item.id,
        content: item.content,
        type: item.type,
        similarity: item.finalScore,
        importance: item.importance,
        created_at: item.created_at,
        tags: item.tags,
        hop_distance: undefined
      }));

      const queryTime = startTime ? Date.now() - startTime : Date.now() - fallbackStartTime;

      return {
        items: convertedItems,
        total_count: convertedItems.length,
        local_results_count: 0,
        fallback_used: true,
        query_time: queryTime
      };
    } catch (error) {
      logger.error('Global search fallback failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      const queryTime = startTime ? Date.now() - startTime : 0;
      
      return {
        items: [],
        total_count: 0,
        local_results_count: 0,
        fallback_used: true,
        query_time: queryTime
      };
    }
  }
}

