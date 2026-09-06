/**
 * Local 검색 서비스 구현
 * Phase 3.6: searchLocal 메서드 분리 - 파이프라인 단계별 메서드 분리
 */

import type Database from 'better-sqlite3';
import { logger } from '../../../../shared/utils/logger.js';
import type { AnchorSlot,IAnchorCacheService,SearchOptions } from './anchor-interfaces.js';
import type { AnchorInfoRow,QueryResult } from './database-types.js';
import type { IFallbackSearchService } from './fallback-search-service.js';
import type { INHopSearchService, NHopSearchResult } from './n-hop-search-service.js';
import type { IQueryFilterService } from './query-filter-service.js';

/**
 * 앵커 정보 및 임베딩
 */
export interface AnchorWithEmbedding {
  memory_id: string;
  embedding: { embedding: number[]; provider: string };
}

/**
 * Local 검색 서비스
 * searchLocal 메서드의 각 단계를 메서드로 분리
 */
export class LocalSearchService {
  private db: Database.Database | null = null;
  private cacheService: IAnchorCacheService;
  private nHopSearchService: INHopSearchService;
  private queryFilterService: IQueryFilterService;
  private fallbackSearchService: IFallbackSearchService;

  constructor(
    cacheService: IAnchorCacheService,
    nHopSearchService: INHopSearchService,
    queryFilterService: IQueryFilterService,
    fallbackSearchService: IFallbackSearchService
  ) {
    this.cacheService = cacheService;
    this.nHopSearchService = nHopSearchService;
    this.queryFilterService = queryFilterService;
    this.fallbackSearchService = fallbackSearchService;
  }

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
   * 앵커 정보 및 임베딩 조회
   */
  async getAnchorWithEmbedding(
    agentId: string,
    slot: AnchorSlot
  ): Promise<AnchorWithEmbedding | null> {
    if (!this.db) {
      throw new Error('Database is not set. Call setDatabase() first.');
    }

    // 앵커 정보 조회
    const anchorInfo = this.db.prepare(`
      SELECT memory_id
      FROM anchor
      WHERE agent_id = ? AND slot = ?
    `).get(agentId, slot) as QueryResult<AnchorInfoRow>;

    if (!anchorInfo || !anchorInfo.memory_id) {
      return null;
    }

    // 앵커 임베딩 조회
    const anchorEmbedding = await this.cacheService.getAnchorEmbedding(anchorInfo.memory_id);
    if (!anchorEmbedding) {
      throw new Error(`Embedding not found for anchor memory_id: ${anchorInfo.memory_id}`);
    }

    return {
      memory_id: anchorInfo.memory_id,
      embedding: anchorEmbedding
    };
  }

  /**
   * N-hop 검색 수행
   */
  async performNHopSearch(
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
   * 쿼리 필터링 적용
   */
  async applyQueryFilter(
    query: string | undefined,
    results: NHopSearchResult[],
    provider: string
  ): Promise<NHopSearchResult[]> {
    if (!query || query.trim().length === 0) {
      return results;
    }

    return this.queryFilterService.filterByQuery(query, results, provider);
  }

  /**
   * Fallback 처리
   */
  async handleFallback(
    query: string | undefined,
    localResults: Array<{
      id: string;
      content: string;
      type: string;
      similarity: number;
      hop_distance: number;
      importance: number;
      created_at: string;
      tags?: string[];
    }>,
    minResults: number,
    options: SearchOptions | undefined,
    startTime: number
  ): Promise<{
    items: Array<{
      id: string;
      content: string;
      type: string;
      similarity: number;
      hop_distance: number;
      importance: number;
      created_at: string;
      tags?: string[];
    }>;
    totalCount: number;
    fallbackUsed: boolean;
  }> {
    // Fallback 조건: query가 있고 localCount < minResults
    if (!query || query.trim().length === 0 || localResults.length >= minResults) {
      return {
        items: localResults,
        totalCount: localResults.length,
        fallbackUsed: false
      };
    }

    try {
      logger.info('Fallback to global search', {
        localCount: localResults.length,
        minResults
      });

      const limit = options?.limit ?? 10;
      const fallbackResult = await this.fallbackSearchService.fallbackToGlobalSearch(
        query,
        { ...options, limit: limit - localResults.length },
        startTime
      );

      // Local 결과와 Fallback 결과 병합 (중복 제거)
      const localMemoryIds = new Set(localResults.map(r => r.id));
      type FallbackItem = { id: string; content: string; importance: number; type: string; created_at: string; similarity?: number; hop_distance?: number; tags?: string[] };
      const fallbackItems = (fallbackResult.items as FallbackItem[])
        .filter((item) => !localMemoryIds.has(item.id))
        .map((item) => ({
          id: item.id,
          content: item.content,
          type: item.type,
          similarity: item.similarity ?? 0,
          hop_distance: item.hop_distance ?? 999,
          importance: item.importance ?? 0.5,
          created_at: item.created_at ?? new Date().toISOString(),
          tags: item.tags ?? undefined
        }))

      // 병합 후 similarity 내림차순으로 재정렬한다 (#868). 정렬 없이 local을 앞에 붙이면
      // 더 나쁜 local 결과가 #1로 노출된다(대시보드는 payload 순서를 그대로 순위로 쓴다).
      // 동점은 hop_distance 오름차순 — 같은 점수면 local(hop 1~3)이 fallback(hop 999)보다 앞.
      const finalResults = [...localResults, ...fallbackItems]
        .sort((a, b) => b.similarity - a.similarity || a.hop_distance - b.hop_distance)
        .slice(0, limit);

      logger.info('Fallback completed', {
        localCount: localResults.length,
        fallbackCount: fallbackItems.length,
        totalCount: finalResults.length
      });

      return {
        items: finalResults,
        totalCount: finalResults.length,
        fallbackUsed: true
      };
    } catch (error) {
      logger.error('Fallback failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        items: localResults,
        totalCount: localResults.length,
        fallbackUsed: false
      };
    }
  }
}
