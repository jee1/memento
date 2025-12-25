/**
 * Fallback 전략 구현
 * Phase 3.5: searchLocal 메서드 분리 - 전략 패턴 적용
 */

import type { IFallbackStrategy } from './search-strategy-interfaces.js';
import type { SearchOptions, SearchResult } from './anchor-interfaces.js';
import { FallbackSearchService } from './fallback-search-service.js';

/**
 * Fallback 전략 구현
 * Phase 2.5의 FallbackSearchService를 래핑하여 전략 패턴 적용
 */
export class FallbackStrategy implements IFallbackStrategy {
  readonly name = 'FallbackStrategy';
  private fallbackSearchService: FallbackSearchService;

  constructor(fallbackSearchService: FallbackSearchService) {
    if (!fallbackSearchService) {
      throw new Error('FallbackSearchService is required');
    }
    this.fallbackSearchService = fallbackSearchService;
  }

  /**
   * Fallback 검색 수행
   */
  async fallback(
    query: string,
    options: SearchOptions | undefined,
    startTime: number | undefined
  ): Promise<SearchResult> {
    return this.fallbackSearchService.fallbackToGlobalSearch(query, options, startTime);
  }

  /**
   * 전략 실행 (ISearchStrategy 인터페이스 구현)
   */
  async execute(...args: any[]): Promise<SearchResult> {
    return this.fallback(
      args[0], // query
      args[1], // options
      args[2]  // startTime
    );
  }
}

