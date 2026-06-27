/**
 * 검색 전략 인터페이스 정의
 * Phase 3.3: searchLocal 메서드 분리 - 전략 패턴 적용
 */

import type { NHopSearchResult } from './n-hop-search-service.js';
import type { SearchOptions } from './anchor-interfaces.js';

/**
 * N-hop 검색 결과 타입 (재export)
 */
export type { NHopSearchResult } from './n-hop-search-service.js';

/**
 * 검색 전략 인터페이스
 * 각 검색 단계를 전략 패턴으로 캡슐화
 */
export interface ISearchStrategy {
  /**
   * 전략 이름
   */
  readonly name: string;

  /**
   * 전략 실행
   */
  execute(...args: unknown[]): Promise<unknown>;
}

/**
 * N-hop 검색 전략 인터페이스
 */
export interface INHopSearchStrategy extends ISearchStrategy {
  /**
   * N-hop 검색 수행
   */
  search(
    anchorEmbedding: number[],
    provider: string,
    anchorMemoryId: string,
    threshold: number,
    maxHops: number,
    limit: number,
    useRelations?: boolean
  ): Promise<NHopSearchResult[]>;
}

/**
 * 쿼리 필터 전략 인터페이스
 */
export interface IQueryFilterStrategy extends ISearchStrategy {
  /**
   * 쿼리 기반 필터링 수행
   */
  filter(
    query: string,
    results: NHopSearchResult[],
    provider: string
  ): Promise<NHopSearchResult[]>;
}

/**
 * Fallback 전략 인터페이스
 */
export interface IFallbackStrategy extends ISearchStrategy {
  /**
   * Fallback 검색 수행
   */
  fallback(
    query: string,
    options: SearchOptions | undefined,
    startTime: number | undefined
  ): Promise<any>; // SearchResult는 anchor-interfaces에서 import
}

