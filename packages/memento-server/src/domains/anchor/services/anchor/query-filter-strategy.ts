/**
 * 쿼리 필터 전략 구현
 * Phase 3.5: searchLocal 메서드 분리 - 전략 패턴 적용
 */

import type { IQueryFilterStrategy, NHopSearchResult } from './search-strategy-interfaces.js';
import type { QueryFilterService } from './query-filter-service.js';

/**
 * 쿼리 필터 전략 구현
 * Phase 2.4의 QueryFilterService를 래핑하여 전략 패턴 적용
 */
export class QueryFilterStrategy implements IQueryFilterStrategy {
  readonly name = 'QueryFilterStrategy';
  private queryFilterService: QueryFilterService;

  constructor(queryFilterService: QueryFilterService) {
    if (!queryFilterService) {
      throw new Error('QueryFilterService is required');
    }
    this.queryFilterService = queryFilterService;
  }

  /**
   * 쿼리 기반 필터링 수행
   */
  async filter(
    query: string,
    results: NHopSearchResult[],
    provider: string
  ): Promise<NHopSearchResult[]> {
    return this.queryFilterService.filterByQuery(query, results, provider);
  }

  /**
   * 전략 실행 (ISearchStrategy 인터페이스 구현)
   */
  async execute(...args: any[]): Promise<NHopSearchResult[]> {
    return this.filter(
      args[0], // query
      args[1], // results
      args[2]  // provider
    );
  }
}

