/**
 * N-hop 검색 전략 구현
 * Phase 3.4: searchLocal 메서드 분리 - 전략 패턴 적용
 */

import type { INHopSearchStrategy, NHopSearchResult } from './search-strategy-interfaces.js';
import { NHopSearchService } from './n-hop-search-service.js';

/**
 * N-hop 검색 전략 구현
 * Phase 2.3의 NHopSearchService를 래핑하여 전략 패턴 적용
 */
export class NHopSearchStrategy implements INHopSearchStrategy {
  readonly name = 'NHopSearchStrategy';
  private nHopSearchService: NHopSearchService;

  constructor(nHopSearchService: NHopSearchService) {
    if (!nHopSearchService) {
      throw new Error('NHopSearchService is required');
    }
    this.nHopSearchService = nHopSearchService;
  }

  /**
   * N-hop 검색 수행
   */
  async search(
    anchorEmbedding: number[] | null,
    provider: string,
    anchorMemoryId: string,
    threshold: number,
    maxHops: number,
    limit: number,
    useRelations: boolean = true
  ): Promise<NHopSearchResult[]> {
    return this.nHopSearchService.searchNHop(
      anchorEmbedding,
      provider,
      anchorMemoryId,
      threshold,
      maxHops,
      limit,
      useRelations
    );
  }

  /**
   * 전략 실행 (ISearchStrategy 인터페이스 구현)
   */
  async execute(...args: unknown[]): Promise<NHopSearchResult[]> {
    return this.search(
      args[0] as number[] | null, // anchorEmbedding
      args[1] as string, // provider
      args[2] as string, // anchorMemoryId
      args[3] as number, // threshold
      args[4] as number, // maxHops
      args[5] as number, // limit
      args[6] as boolean | undefined // useRelations
    );
  }
}
