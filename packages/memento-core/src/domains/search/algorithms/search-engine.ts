/**
 * FTS5와 랭킹 알고리즘을 결합하여 검색 정확도와 성능을 동시에 확보합니다.
 * 전문 검색 인덱스(FTS5)로 빠른 검색을 수행하고, 다차원 랭킹 알고리즘으로 관련성 높은 결과를 제공합니다.
 */

import Database from 'better-sqlite3';
import { mcpLogger } from '../../../server/mcp-logger.js';
import type { MemorySearchResult } from '../../../shared/types/index.js';
import { logger } from '../../../shared/utils/logger.js';
import { FeedbackRepository } from '../../memory/repositories/feedback-repository.js';
import { SearchRanking } from './search-ranking.js';
import { SearchEngineFtsAvailability } from './search-engine/search-engine-fts-availability.js';
import { buildFTSQuery as buildFTSQueryImpl, makeFTSSafe as makeFTSSafeImpl, preprocessQuery as preprocessQueryImpl } from './search-engine/search-engine-fts-query.js';
import {
  applyRanking as applyRankingImpl,
  generateRecallReason as generateRecallReasonFromScores,
} from './search-engine/search-engine-ranking.js';
import { buildSearchStatement } from './search-engine/search-engine-sql-builder.js';
import type { SearchEngineRow, SearchQuery } from './search-engine/search-engine.types.js';

export type { SearchQuery } from './search-engine/search-engine.types.js';

export class SearchEngine {
  private ranking: SearchRanking;
  private ftsAvailability: SearchEngineFtsAvailability;

  constructor() {
    this.ranking = new SearchRanking();
    this.ftsAvailability = new SearchEngineFtsAvailability();
  }

  /**
   * 전문 검색 성능을 향상시키고 관련성 높은 결과를 빠르게 반환합니다.
   * FTS5 인덱스를 활용하여 대용량 데이터에서도 빠른 검색이 가능하도록 최적화합니다.
   */
  async search(
    db: Database.Database,
    query: SearchQuery
  ): Promise<{ items: MemorySearchResult[], total_count: number, query_time: number }> {
    const startTime = process.hrtime.bigint();
    const {
      query: searchQuery,
      filters,
      limit = 10,
      include_score_breakdown: includeScoreBreakdown,
      omit_feedback_in_ranking: omitFeedbackInRanking,
    } = query;

    const hasIdFilter = filters?.id && filters.id.length > 0;

    const statementBuilder = (preferFts: boolean) => buildSearchStatement({
      db,
      searchQuery,
      filters,
      limit,
      hasIdFilter: Boolean(hasIdFilter),
      preferFts,
      checkFTS5Availability: (database) => this.ftsAvailability.checkFTS5Availability(database),
      buildFTSQuery: buildFTSQueryImpl,
      buildReflectionNotesSearchCondition: (database, q) =>
        this.ftsAvailability.buildReflectionNotesSearchCondition(database, q),
    });

    const initialStatement = await statementBuilder(true);
    let { sql, params } = initialStatement;
    const { usedFtsQuery } = initialStatement;

    mcpLogger.logServer('debug', '검색 쿼리 실행', {
      query: sql,
      params: params
    });

    let results: SearchEngineRow[];
    try {
      results = await this.executeQuery(db, sql, params);
    } catch (error) {
      if (!usedFtsQuery) {
        throw error;
      }

      this.ftsAvailability.invalidateFts5Cache(db);
      this.ftsAvailability.logFallbackWarning('FTS5 검색 쿼리 실패, Fallback으로 재시도', {
        error: error instanceof Error ? error.message : String(error)
      });

      ({ sql, params } = await statementBuilder(false));
      results = await this.executeQuery(db, sql, params);
    }

    mcpLogger.logServer('debug', '검색 결과', {
      resultCount: results.length
    });

    let feedbackNetByMemory = new Map<string, number>();
    if (results.length > 0 && !omitFeedbackInRanking) {
      const ids = (results as Array<{ id?: string }>)
        .map((r) => r.id)
        .filter((id): id is string => typeof id === 'string');
      if (ids.length > 0) {
        try {
          feedbackNetByMemory = new FeedbackRepository(db).getNetScores(ids, 90);
        } catch (err) {
          logger.warn('피드백 순합 조회 실패 — 피드백 없이 진행', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    const rankedResults = applyRankingImpl(this.ranking, results, searchQuery, {
      includeBreakdown: includeScoreBreakdown === true,
      feedbackNetByMemory
    });

    const finalResults = rankedResults.slice(0, limit);

    const endTime = process.hrtime.bigint();
    const queryTime = Number(endTime - startTime) / 1_000_000;

    return {
      items: finalResults,
      total_count: finalResults.length,
      query_time: queryTime
    };
  }

  private async executeQuery(db: Database.Database, sql: string, params: unknown[]): Promise<SearchEngineRow[]> {
    return db.prepare(sql).all(...params) as SearchEngineRow[];
  }

  /** @internal 테스트·하위 호환용 위임 */
  private buildFTSQuery(query: string): string {
    return buildFTSQueryImpl(query);
  }

  /** @internal 테스트·하위 호환용 위임 */
  private preprocessQuery(query: string): string {
    return preprocessQueryImpl(query);
  }

  /** @internal 테스트·하위 호환용 위임 */
  private makeFTSSafe(query: string): string {
    return makeFTSSafeImpl(query);
  }

  /** @internal 테스트·하위 호환용 위임 */
  private async checkFTS5Availability(db: Database.Database): Promise<boolean> {
    return this.ftsAvailability.checkFTS5Availability(db);
  }

  /** @internal 테스트·하위 호환용 위임 */
  private checkReflectionNotesAvailability(db: Database.Database): boolean {
    return this.ftsAvailability.checkReflectionNotesAvailability(db);
  }

  /** @internal 테스트·하위 호환용 위임 */
  private applyRanking(
    results: SearchEngineRow[],
    query: string,
    opts?: { includeBreakdown?: boolean; feedbackNetByMemory?: Map<string, number> }
  ): MemorySearchResult[] {
    return applyRankingImpl(this.ranking, results, query, opts);
  }

  /** @internal 테스트·하위 호환용 위임 */
  private generateRecallReason(
    relevance: number,
    recency: number,
    importance: number,
    finalScore: number,
    isFTS: boolean = false
  ): string {
    return generateRecallReasonFromScores(relevance, recency, importance, finalScore, isFTS);
  }
}
