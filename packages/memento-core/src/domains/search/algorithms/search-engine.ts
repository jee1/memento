/**
 * FTS5와 랭킹 알고리즘을 결합하여 검색 정확도와 성능을 동시에 확보합니다.
 * 전문 검색 인덱스(FTS5)로 빠른 검색을 수행하고, 다차원 랭킹 알고리즘으로 관련성 높은 결과를 제공합니다.
 */

import { SearchRanking, type SearchFeatures } from './search-ranking.js';
import type { MemorySearchFilters, MemorySearchResult } from '../../../shared/types/index.js';
import type { ScoreBreakdown } from '../../../shared/types/search.types.js';
import { FeedbackRepository, sigmoidNormalizedNet } from '../../memory/repositories/feedback-repository.js';
import Database from 'better-sqlite3';
import { getStopWords } from '../../../shared/utils/stopwords.js';
import { mementoConfig } from '../../../shared/config/index.js';
import { HYBRID_SEARCH } from '../../../shared/config/constants.js';
import { shouldUseFallback } from '../../../shared/utils/fts5-migration-status.js';
import { mcpLogger } from '../../../server/mcp-logger.js';
import { logger } from '../../../shared/utils/logger.js';

export interface SearchQuery {
  query: string;
  filters?: MemorySearchFilters | undefined;
  limit?: number | undefined;
  /** true이면 텍스트 전용 랭킹 경로에서도 score_breakdown 포함 (하이브리드와 동일 계약) */
  include_score_breakdown?: boolean | undefined;
  /**
   * true이면 텍스트 랭킹에서 피드백 가중치를 적용하지 않음.
   * 하이브리드 검색은 combineAndSortResults → normalizeScores에서만 피드를 반영해 이중 가산을 막는다.
   */
  omit_feedback_in_ranking?: boolean | undefined;
}


type SearchEngineRow = {
  id: string;
  content: string;
  type: string;
  importance: number;
  created_at: Date | string;
  last_accessed?: Date | string | null;
  pinned: boolean | number;
  tags?: string | null;
  fts_rank?: number | null;
  consolidation_score?: number | string | null;
  task_goal?: string | null;
  steps?: string | null;
  reflection_notes?: string | null;
  workflow_name?: string | null;
  skill_name?: string | null;
  trigger_conditions?: string | null;
  version?: number | null;
  version_series_id?: string | null;
  owner_id?: string | null;
  process_id?: string | null;
  session_id?: string | null;
  num_times?: number | string | null;
  last_mentioned_at?: Date | string | null;
  project_id?: string | null;
} & Record<string, unknown>;

export class SearchEngine {
  private ranking: SearchRanking;
  private cachedFts5Availability = new WeakSet<Database.Database>();
  private cachedReflectionNotesAvailability = new WeakSet<Database.Database>();
  private emittedTestReflectionNotesConfigFallbackWarnings = new Set<string>();

  constructor() {
    this.ranking = new SearchRanking();
  }

  private isTestEnvironment(): boolean {
    return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  }

  private logFallbackWarning(message: string, data?: Record<string, unknown>): void {
    mcpLogger.logServer('warn', message, data);
  }

  private logReflectionNotesConfigFallbackWarning(): void {
    const message = '설정으로 인해 reflection_notes Fallback 활성화';

    if (
      this.isTestEnvironment() &&
      this.emittedTestReflectionNotesConfigFallbackWarnings.has(message)
    ) {
      mcpLogger.logServer('info', message);
      return;
    }

    this.emittedTestReflectionNotesConfigFallbackWarnings.add(message);
    mcpLogger.logServer('warn', message);
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
    
    // ID로 직접 조회할 때는 이미 대상이 명확하므로 불필요한 텍스트 검색을 생략하여 성능을 최적화합니다.
    const hasIdFilter = filters?.id && filters.id.length > 0;
    
    const buildSearchStatement = async (
      preferFts: boolean
    ): Promise<{ sql: string; params: unknown[]; usedFtsQuery: boolean }> => {
      let sql: string;
      const params: unknown[] = [];
      let usedFtsQuery = false;

      // 전문 검색 인덱스를 활용하여 빠르고 정확한 검색 결과를 제공합니다.
      if (!hasIdFilter && searchQuery.trim().length > 0) {
        const ftsAvailable = preferFts ? await this.checkFTS5Availability(db) : false;

        if (ftsAvailable) {
          const ftsQuery = this.buildFTSQuery(searchQuery);

          // 빈 쿼리로 인한 FTS5 오류를 방지하고 모든 결과를 반환합니다.
          if (ftsQuery === '""' || ftsQuery.length === 0) {
            sql = `
              SELECT
                m.id, m.content, m.type, m.importance, m.created_at,
                m.last_accessed, m.pinned, m.tags, m.source,
                m.consolidation_score,
                m.task_goal, m.steps, m.reflection_notes,
                m.workflow_name, m.skill_name, m.trigger_conditions,
                m.version, m.version_series_id,
                m.privacy_scope, m.origin_source, m.owner_id, m.process_id, m.session_id,
                m.num_times, m.last_mentioned_at, m.project_id,
                0 as fts_rank
              FROM memory_item m
            `;
          } else {
            usedFtsQuery = true;
            sql = `
              SELECT
                m.id, m.content, m.type, m.importance, m.created_at,
                m.last_accessed, m.pinned, m.tags, m.source,
                m.consolidation_score,
                m.task_goal, m.steps, m.reflection_notes,
                m.workflow_name, m.skill_name, m.trigger_conditions,
                m.version, m.version_series_id,
                m.privacy_scope, m.origin_source, m.owner_id, m.process_id, m.session_id,
                m.num_times, m.last_mentioned_at, m.project_id,
                memory_item_fts.rank as fts_rank
              FROM memory_item_fts
              JOIN memory_item m ON memory_item_fts.rowid = m.rowid
              WHERE memory_item_fts MATCH ?
            `;
            params.push(ftsQuery);
          }
        } else {
          // FTS5가 없는 환경에서도 검색 기능이 동작하도록 호환성을 보장합니다.
          const likeQuery = `%${searchQuery}%`;

          // reflection_notes 검색 조건 추가 (Fallback)
          const reflectionNotesCondition = this.buildReflectionNotesSearchCondition(db, searchQuery);
          const reflectionNotesLike = reflectionNotesCondition ? ` OR ${reflectionNotesCondition}` : '';
          const reflectionNotesParams = reflectionNotesCondition ? [likeQuery] : [];

          // SQL Injection 방지를 위해 템플릿 리터럴 대신 문자열 연결 사용
          // reflectionNotesLike는 이미 ? 플레이스홀더를 포함하고 있어 안전함
          sql = `
            SELECT
              m.id, m.content, m.type, m.importance, m.created_at,
              m.last_accessed, m.pinned, m.tags, m.source,
              m.consolidation_score,
              m.task_goal, m.steps, m.reflection_notes,
              m.workflow_name, m.skill_name, m.trigger_conditions,
              m.version, m.version_series_id,
              m.privacy_scope, m.origin_source, m.owner_id, m.process_id, m.session_id,
              m.num_times, m.last_mentioned_at, m.project_id,
              0 as fts_rank
            FROM memory_item m
            WHERE m.content LIKE ? OR m.tags LIKE ? OR m.source LIKE ?` + reflectionNotesLike;
          params.push(likeQuery, likeQuery, likeQuery, ...reflectionNotesParams);
        }
      } else {
        // ID 필터나 빈 검색어 상황에서 효율적인 직접 조회를 수행합니다.
        sql = `
          SELECT
            m.id, m.content, m.type, m.importance, m.created_at,
            m.last_accessed, m.pinned, m.tags, m.source,
            m.consolidation_score,
            m.task_goal, m.steps, m.reflection_notes,
            m.workflow_name, m.skill_name, m.trigger_conditions,
            m.version, m.version_series_id,
            m.privacy_scope, m.origin_source, m.owner_id, m.process_id, m.session_id,
            m.num_times, m.last_mentioned_at,
            0 as fts_rank
          FROM memory_item m
        `;

        // 검색어가 있을 때만 텍스트 매칭을 수행하여 불필요한 연산을 방지합니다.
        if (!hasIdFilter && searchQuery.trim().length > 0) {
          const likeQuery = `%${searchQuery}%`;

          // reflection_notes 검색 조건 추가 (Fallback)
          const reflectionNotesCondition = this.buildReflectionNotesSearchCondition(db, searchQuery);
          const reflectionNotesLike = reflectionNotesCondition ? ` OR ${reflectionNotesCondition}` : '';
          const reflectionNotesParams = reflectionNotesCondition ? [likeQuery] : [];

          // SQL Injection 방지: reflectionNotesLike는 이미 ? 플레이스홀더를 포함하고 있어 안전함
          sql += ` WHERE m.content LIKE ?${reflectionNotesLike}`;
          params.push(likeQuery, ...reflectionNotesParams);
        }
      }

      // 사용자가 요청한 타입, 중요도, 시간 범위 등의 필터를 적용하여 정확한 결과를 제공합니다.
      const conditions: string[] = ['(COALESCE(m.is_deleted, 0) = 0)'];

      if (filters?.id && filters.id.length > 0) {
        conditions.push(`m.id IN (${filters.id.map(() => '?').join(',')})`);
        params.push(...filters.id);
      }

      if (filters?.type && filters.type.length > 0) {
        conditions.push(`m.type IN (${filters.type.map(() => '?').join(',')})`);
        params.push(...filters.type);
      }

      if (filters?.privacy_scope && filters.privacy_scope.length > 0) {
        conditions.push(`m.privacy_scope IN (${filters.privacy_scope.map(() => '?').join(',')})`);
        params.push(...filters.privacy_scope);
      }

      if (filters?.pinned !== undefined) {
        conditions.push(`m.pinned = ?`);
        params.push(filters.pinned ? 1 : 0); // SQLite가 boolean을 지원하지 않으므로 숫자로 변환하여 저장합니다.
      }

      if (filters?.time_from) {
        conditions.push(`m.created_at >= ?`);
        params.push(filters.time_from);
      }

      if (filters?.time_to) {
        conditions.push(`m.created_at <= ?`);
        params.push(filters.time_to);
      }

      if (filters?.has_reflection_notes !== undefined) {
        if (filters.has_reflection_notes) {
          conditions.push(`m.reflection_notes IS NOT NULL`);
        } else {
          conditions.push(`m.reflection_notes IS NULL`);
        }
      }

      // Procedural Memory Enhancement (v7.0) 필터
      if (filters?.workflow_name) {
        conditions.push(`m.workflow_name = ?`);
        params.push(filters.workflow_name);
      }

      if (filters?.skill_name) {
        conditions.push(`m.skill_name = ?`);
        params.push(filters.skill_name);
      }

      // WHERE 절 추가
      // SQL Injection 방지: conditions는 이미 파라미터 바인딩(?)을 포함하고 있어 안전함
      if (conditions.length > 0) {
        const whereClause = sql.includes('WHERE') ? ' AND ' : ' WHERE ';
        sql += `${whereClause}${conditions.join(' AND ')}`;
      }

      // FTS5 랭킹을 고려하여 충분한 후보를 확보한 후 재랭킹하여 최종 결과의 품질을 보장합니다.
      // SQL Injection 방지: LIMIT 값은 파라미터 바인딩으로 전달됨
      sql += ' ORDER BY fts_rank DESC, m.created_at DESC LIMIT ?';
      params.push(limit * 3); // FTS5 랭킹과 재랭킹 과정에서 일부 결과가 제외될 수 있으므로 충분한 후보를 확보합니다.

      return { sql, params, usedFtsQuery };
    };

    let { sql, params, usedFtsQuery } = await buildSearchStatement(true);
    
    // 구성된 쿼리를 실행하여 실제 검색 결과를 획득합니다.
    // 디버그 레벨로 로깅하여 기본적으로 비활성화 (LOG_LEVEL=debug일 때만 출력)
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

      this.cachedFts5Availability.delete(db);
      this.logFallbackWarning('FTS5 검색 쿼리 실패, Fallback으로 재시도', {
        error: error instanceof Error ? error.message : String(error)
      });

      ({ sql, params } = await buildSearchStatement(false));
      results = await this.executeQuery(db, sql, params);
    }
    mcpLogger.logServer('debug', '검색 결과', {
      resultCount: results.length
    });

    /** 랭킹에 피드백 신호 반영(FR-003). score_breakdown 여부와 무관하게 조회 — 테이블 없으면 하이브리드와 동일하게 무시 */
    /** omit_feedback_in_ranking: 하이브리드 하위 호출 시 병합 단계에서만 피드백 적용 */
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
    
    // FTS5 랭킹과 다차원 점수를 결합하여 사용자에게 가장 관련성 높은 결과를 우선 제공합니다.
    const rankedResults = this.applyRanking(results, searchQuery, {
      includeBreakdown: includeScoreBreakdown === true,
      feedbackNetByMemory
    });
    
    // 사용자가 요청한 개수만큼만 반환하여 응답 크기와 처리 시간을 최적화합니다.
    const finalResults = rankedResults.slice(0, limit);
    
    // 검색 성능을 모니터링하고 최적화 지점을 파악합니다.
    const endTime = process.hrtime.bigint();
    const queryTime = Number(endTime - startTime) / 1_000_000; // 나노초 단위 시간을 밀리초로 변환하여 사용자에게 이해하기 쉬운 형태로 제공합니다.
    
    return {
      items: finalResults,
      total_count: finalResults.length,
      query_time: queryTime
    };
  }

  /**
   * FTS5의 특수 문법과 보안 요구사항을 준수하여 안전하고 효율적인 검색 쿼리를 생성합니다.
   * 아키텍처 문서의 전처리 규칙을 적용하여 검색 정확도를 향상시킵니다.
   */
  private buildFTSQuery(query: string): string {
    // 디버그 레벨로 로깅하여 기본적으로 비활성화 (LOG_LEVEL=debug일 때만 출력)
    mcpLogger.logServer('debug', '원본 쿼리', { query });

    // 사용자 입력의 형식이 다양하므로 정규화하여 검색 일관성을 보장합니다.
    const preprocessedQuery = this.preprocessQuery(query);
    mcpLogger.logServer('debug', '전처리 후 쿼리', { preprocessedQuery });

    if (preprocessedQuery.length === 0) {
      mcpLogger.logServer('debug', '빈 쿼리, 모든 문서 검색');
      return '""'; // 빈 쿼리인 경우 빈 문자열로 검색하여 모든 문서를 매치하고 사용자에게 전체 결과를 제공합니다.
    }

    // 긴 쿼리(토큰 수 초과) 시 OR 조합으로 완화하여 FTS·벡터 둘 다 0건이 되는 recall 빈 결과 방지
    const words = preprocessedQuery.split(' ').filter(w => w.length > 0);
    const orThreshold = HYBRID_SEARCH.FTS_OR_ABOVE_TOKEN_COUNT;
    const maxTokens = HYBRID_SEARCH.FTS_MAX_TOKENS_FOR_OR;
    const ftsQueryString = words.length > orThreshold
      ? words.slice(0, maxTokens).join(' OR ')
      : preprocessedQuery;

    // FTS5 특수문자로 인한 쿼리 오류를 방지하고 안전한 검색을 보장합니다.
    const safeQuery = this.makeFTSSafe(ftsQueryString);
    mcpLogger.logServer('debug', 'FTS5 안전 쿼리', { safeQuery });

    if (safeQuery.length === 0) {
      mcpLogger.logServer('debug', '안전 쿼리 빈 문자열, 모든 문서 검색');
      return '""'; // 빈 쿼리인 경우 빈 문자열로 검색하여 모든 문서를 매치하고 사용자에게 전체 결과를 제공합니다.
    }

    return safeQuery;
  }

  /**
   * 검색 품질을 향상시키기 위해 노이즈를 제거하고 핵심 키워드만 추출합니다.
   * 아키텍처 문서의 전처리 규칙을 준수하여 일관된 검색 결과를 제공합니다.
   */
  private preprocessQuery(query: string): string {
    // 다양한 공백 패턴을 통일하여 검색 일관성을 보장합니다.
    let processed = query.trim().replace(/\s+/g, ' ');
    
    // 검색에 방해되는 특수문자를 제거하여 핵심 키워드만 추출합니다.
    processed = processed.replace(/[^a-zA-Z0-9가-힣\s]/g, ' ');
    
    // 정규화 과정에서 생긴 연속 공백을 정리하여 쿼리 품질을 향상시킵니다.
    processed = processed.replace(/\s+/g, ' ');
    
    // 검색 가치가 없는 불용어를 제거하여 검색 정확도를 향상시킵니다.
    const stopWords = getStopWords();
    const words = processed.split(' ').filter(word => 
      word.length > 0 && !stopWords.has(word.toLowerCase())
    );
    
    // FTS5가 요구하는 형식으로 쿼리를 구성하여 인덱스 검색이 정상 동작하도록 합니다.
    return words.join(' ');
  }

  /**
   * FTS5의 특수문자 처리 규칙을 준수하여 쿼리 오류를 방지하고 안전한 검색을 보장합니다.
   */
  private makeFTSSafe(query: string): string {
    // FTS5가 특수문자를 쿼리 구문으로 해석하지 않도록 이스케이프하여 오류를 방지합니다.
    return query
      .replace(/"/g, '""')  // FTS5가 따옴표를 특수문자로 해석하지 않도록 이스케이프합니다.
      .replace(/'/g, "''")  // FTS5가 작은따옴표를 특수문자로 해석하지 않도록 이스케이프합니다.
      .replace(/[[\]{}()]/g, ' ') // 대괄호, 중괄호, 소괄호 제거
      .replace(/\s+/g, ' ') // 연속 공백 정리
      .trim();
  }

  /**
   * 준비된 SQL 쿼리를 실행하여 실제 검색 결과를 데이터베이스에서 획득합니다.
   */
  private async executeQuery(db: Database.Database, sql: string, params: unknown[]): Promise<SearchEngineRow[]> {
    // better-sqlite3는 spread bind를 기본으로 하므로 params 배열을 펼쳐 전달합니다.
    return db.prepare(sql).all(...params) as SearchEngineRow[];
  }

  /** 각 항 score는 최종 점수에 대한 기여(텍스트 경로는 FTS 블렌드·factBoost 반영 후), pct는 displayTotal 대비 백분율(정수 반올림, contracts §1) */
  private attachBreakdownToDisplayTotal(bd: ScoreBreakdown, displayTotal: number): ScoreBreakdown {
    const denom = Math.abs(displayTotal) < 1e-12 ? 1e-12 : Math.abs(displayTotal);
    const map = (c: { score: number; pct: number }) => ({
      score: c.score,
      pct: Math.round((100 * c.score) / denom),
    });
    return {
      relevance: map(bd.relevance),
      recency: map(bd.recency),
      importance: map(bd.importance),
      usage: map(bd.usage),
      feedback: map(bd.feedback),
      duplication_penalty: map(bd.duplication_penalty),
      total: displayTotal
    };
  }

  /**
   * FTS5 랭킹과 다차원 점수를 결합하여 사용자에게 가장 관련성 높은 결과를 우선 제공합니다.
   * 관련성, 최근성, 중요도, 사용성 등을 종합적으로 고려하여 검색 품질을 향상시킵니다.
   */
  private applyRanking(
    results: SearchEngineRow[],
    query: string,
    opts?: { includeBreakdown?: boolean; feedbackNetByMemory?: Map<string, number> }
  ): MemorySearchResult[] {
    const selectedContents: string[] = [];
    
    return results
      .map((row) => {
        // FTS5 랭킹이 있으면 우선 활용하고, 없으면 텍스트 매칭으로 관련성을 계산하여 일관된 점수 체계를 유지합니다.
        const ftsRank = typeof row.fts_rank === 'number' ? row.fts_rank : Number(row.fts_rank ?? 0);
        const relevance = ftsRank > 0 ? 
          Math.min(ftsRank / 100, 1.0) : // FTS5 랭킹을 0-1 범위로 정규화하여 다른 점수와 일관된 비교가 가능하도록 합니다.
          this.ranking.calculateRelevance({
            query,
            content: row.content,
            tags: typeof row.tags === 'string' ? (JSON.parse(row.tags) as string[]) : []
          });
        
        // 시간에 따른 기억의 자연스러운 감쇠를 반영하여 최신 정보를 우선 제공합니다.
        const createdAt = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
        const recency = this.ranking.calculateRecency(createdAt, row.type);
        
        // 사용자가 명시적으로 설정한 중요도와 고정 여부를 반영하여 우선순위를 결정합니다.
        const importance = this.ranking.calculateImportance(
          row.importance,
          Boolean(row.pinned),
          row.type
        );
        
        // 실제 사용 빈도를 반영하여 자주 참조되는 기억을 우선 제공합니다.
        const usage = this.ranking.calculateUsage({
          viewCount: 1, // 사용 빈도 데이터가 없는 경우 기본값을 사용하여 안정적인 점수 계산을 보장합니다.
          citeCount: 0,
          editCount: 0
        });
        
        // 유사한 내용의 중복 결과를 제거하여 검색 결과의 다양성을 확보합니다.
        const duplicationPenalty = this.ranking.calculateDuplicationPenalty(
          row.content,
          selectedContents
        );

        const net = opts?.feedbackNetByMemory?.get(row.id);
        const feedback_score = sigmoidNormalizedNet(net ?? 0);
        
        // 통합 점수 기능이 활성화된 경우 추가적인 관련성 지표를 활용합니다.
        const consolidationScore = row.consolidation_score !== null && row.consolidation_score !== undefined
          ? Number(row.consolidation_score)
          : undefined;

        const useConsolidationPath =
          mementoConfig.consolidationScoreEnabled && consolidationScore !== undefined;

        /** 랭킹 코어 점수 — FTS 히트 시 0.3 가중, FTS 항(ftsRank*0.7)은 breakdown의 relevance 축에 합산 */
        const baseFeatures: SearchFeatures = ftsRank > 0
          ? {
              relevance: 0.3,
              recency,
              importance,
              usage,
              duplication_penalty: duplicationPenalty,
              feedback_score,
              ...(useConsolidationPath && consolidationScore !== undefined
                ? { consolidation_score: consolidationScore }
                : {})
            }
          : {
              relevance,
              recency,
              importance,
              usage,
              duplication_penalty: duplicationPenalty,
              feedback_score,
              ...(useConsolidationPath && consolidationScore !== undefined
                ? { consolidation_score: consolidationScore }
                : {})
            };

        const baseScore = this.ranking.calculateFinalScore(baseFeatures);
        const preBoost = ftsRank > 0 ? ftsRank * 0.7 + baseScore * 0.3 : baseScore;

        // Fact 메타 가중 (Issue #88): num_times·last_mentioned_at으로 자주·최근 언급된 기억 보정
        const factBoost = this.calculateFactMetadataBoost(
          row.num_times != null ? Number(row.num_times) : 1,
          row.last_mentioned_at ? new Date(row.last_mentioned_at) : null
        );
        const finalScore = preBoost * factBoost;

        // 중복 패널티 계산을 위해 이미 선택된 콘텐츠를 추적하여 결과의 다양성을 확보합니다.
        selectedContents.push(row.content);
        
        const lastAccessed =
          row.last_accessed == null
            ? undefined
            : row.last_accessed instanceof Date
              ? row.last_accessed
              : new Date(row.last_accessed);

        const result: MemorySearchResult = {
          id: row.id,
          content: row.content,
          type: row.type as MemorySearchResult['type'],
          importance: row.importance,
          created_at: createdAt,
          last_accessed: lastAccessed,
          pinned: Boolean(row.pinned),
          tags: typeof row.tags === 'string' ? (JSON.parse(row.tags) as string[]) : [],
          score: finalScore,
          recall_reason: this.generateRecallReason(relevance, recency, importance, finalScore, ftsRank > 0),
        };
        if (row.task_goal != null) result.task_goal = row.task_goal;
        if (row.steps != null) result.steps = row.steps;
        if (row.reflection_notes != null) result.reflection_notes = row.reflection_notes;
        if (row.workflow_name != null) result.workflow_name = row.workflow_name;
        if (row.skill_name != null) result.skill_name = row.skill_name;
        if (row.trigger_conditions != null) result.trigger_conditions = row.trigger_conditions;
        if (row.version !== undefined && row.version !== null) result.version = row.version;
        if (row.version_series_id !== undefined) result.version_series_id = row.version_series_id;
        if (row.owner_id !== undefined) result.owner_id = row.owner_id;
        if (row.process_id !== undefined) result.process_id = row.process_id;
        if (row.session_id !== undefined) result.session_id = row.session_id;
        if (row.project_id !== undefined) result.project_id = row.project_id;
        if (row.num_times != null) result.num_times = Number(row.num_times);
        if (row.last_mentioned_at != null) {
          result.last_mentioned_at =
            row.last_mentioned_at instanceof Date
              ? row.last_mentioned_at
              : new Date(row.last_mentioned_at);
        }

        // 통합 점수 기능이 활성화된 경우 결과에 추가 정보를 포함하여 상세한 분석을 가능하게 합니다.
        if (mementoConfig.consolidationScoreEnabled && consolidationScore !== undefined) {
          result.consolidation_score = consolidationScore;
        }

        if (opts?.includeBreakdown) {
          const bd = this.ranking.calculateFinalScoreAndBreakdown(baseFeatures, {
            includeBreakdown: true
          });
          if (bd.breakdown) {
            const ftsPart = ftsRank > 0 ? ftsRank * 0.7 : 0;
            const scaled: ScoreBreakdown =
              ftsRank > 0
                ? {
                    relevance: {
                      score: (bd.breakdown.relevance.score * 0.3 + ftsPart) * factBoost,
                      pct: 0
                    },
                    recency: { score: bd.breakdown.recency.score * 0.3 * factBoost, pct: 0 },
                    importance: { score: bd.breakdown.importance.score * 0.3 * factBoost, pct: 0 },
                    usage: { score: bd.breakdown.usage.score * 0.3 * factBoost, pct: 0 },
                    feedback: { score: bd.breakdown.feedback.score * 0.3 * factBoost, pct: 0 },
                    duplication_penalty: {
                      score: bd.breakdown.duplication_penalty.score * 0.3 * factBoost,
                      pct: 0
                    },
                    total: finalScore
                  }
                : {
                    relevance: { score: bd.breakdown.relevance.score * factBoost, pct: 0 },
                    recency: { score: bd.breakdown.recency.score * factBoost, pct: 0 },
                    importance: { score: bd.breakdown.importance.score * factBoost, pct: 0 },
                    usage: { score: bd.breakdown.usage.score * factBoost, pct: 0 },
                    feedback: { score: bd.breakdown.feedback.score * factBoost, pct: 0 },
                    duplication_penalty: {
                      score: bd.breakdown.duplication_penalty.score * factBoost,
                      pct: 0
                    },
                    total: finalScore
                  };
            result.score_breakdown = this.attachBreakdownToDisplayTotal(scaled, finalScore);
          }
        }

        return result;
      })
      .sort((a, b) => b.score - a.score); // 최종 점수 기준으로 내림차순 정렬하여 가장 관련성 높은 결과를 우선 제공합니다.
  }

  /**
   * FTS5 인덱스의 존재와 동작 여부를 확인하여 안전한 검색 전략을 선택합니다.
   * 인덱스가 없거나 비정상인 경우 대체 검색 방식을 사용하여 기능 안정성을 보장합니다.
   */
  private async checkFTS5Availability(db: Database.Database): Promise<boolean> {
    if (this.cachedFts5Availability.has(db)) {
      return true;
    }

    try {
      // FTS5 인덱스 테이블이 생성되어 있는지 확인하여 전문 검색 사용 가능 여부를 판단합니다.
      const result = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='memory_item_fts'
      `).get();
      
      if (!result) {
        this.logFallbackWarning('FTS5 테이블이 존재하지 않음, 기본 검색으로 전환');
        return false;
      }
      
      // 빈 인덱스로 인한 검색 실패를 방지하고 실제 검색 가능 여부를 확인합니다.
      const row = db.prepare('SELECT COUNT(*) as count FROM memory_item_fts').get() as { count: number } | undefined;
      const hasData = row != null && Number(row.count) > 0;
      
      if (!hasData) {
        this.logFallbackWarning('FTS5 테이블에 데이터가 없음, 기본 검색으로 전환');
        return false;
      }
      
      // FTS5 쿼리가 실제로 동작하는지 테스트하여 런타임 오류를 사전에 방지합니다.
      try {
        db.prepare('SELECT * FROM memory_item_fts LIMIT 1').get();
        mcpLogger.logServer('info', 'FTS5 사용 가능');
        this.cachedFts5Availability.add(db);
        return true;
      } catch (ftsError) {
        this.logFallbackWarning('FTS5 쿼리 실패, 기본 검색으로 전환', { error: ftsError instanceof Error ? ftsError.message : String(ftsError) });
        return false;
      }
    } catch (error) {
      this.logFallbackWarning('FTS5 사용 불가능, 기본 검색으로 전환', { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  /**
   * reflection_notes 컬럼이 FTS5에서 사용 가능한지 확인
   * 마이그레이션 상태를 확인하여 Fallback이 필요한지 판단합니다.
   * 
   * @param db - 데이터베이스 인스턴스
   * @returns reflection_notes 컬럼 사용 가능 여부
   */
  private checkReflectionNotesAvailability(db: Database.Database): boolean {
    if (process.env.MEMENTO_FTS5_FALLBACK_ENABLED === 'true') {
      this.logReflectionNotesConfigFallbackWarning();
      return false;
    }
    if (mementoConfig.fts5FallbackEnabled) {
      this.logReflectionNotesConfigFallbackWarning();
      return false;
    }

    // 마이그레이션 상태 확인
    if (shouldUseFallback(db)) {
      this.logFallbackWarning('마이그레이션 상태로 인해 reflection_notes Fallback 사용');
      return false;
    }

    if (this.cachedReflectionNotesAvailability.has(db)) {
      return true;
    }

    // FTS5 테이블에 reflection_notes 컬럼이 있는지 확인
    try {
      const tableInfo = db.prepare(`
        SELECT sql FROM sqlite_master 
        WHERE type='table' AND name='memory_item_fts'
      `).get() as { sql: string } | undefined;

      if (!tableInfo) {
        return false;
      }

      // reflection_notes 컬럼이 포함되어 있는지 확인
      const hasReflectionNotes = tableInfo.sql.includes('reflection_notes');
      
      if (!hasReflectionNotes) {
        this.logFallbackWarning('FTS5 테이블에 reflection_notes 컬럼이 없음, Fallback 사용');
        return false;
      }

      this.cachedReflectionNotesAvailability.add(db);
      return true;
    } catch (error) {
      this.logFallbackWarning('reflection_notes 컬럼 확인 실패, Fallback 사용', { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  /**
   * reflection_notes 검색 쿼리 빌더
   * 마이그레이션 상태에 따라 FTS5 MATCH 쿼리 또는 LIKE 쿼리를 선택합니다.
   * 
   * @param db - 데이터베이스 인스턴스
   * @param searchQuery - 검색 쿼리
   * @returns reflection_notes 검색 조건 (SQL WHERE 절 조건)
   */
  private buildReflectionNotesSearchCondition(db: Database.Database, searchQuery: string): string | null {
    // reflection_notes 검색이 필요한지 확인 (쿼리에 reflection_notes 관련 키워드가 있는지)
    // 간단한 구현: 모든 쿼리에 reflection_notes 검색 포함
    // 향후 개선: 쿼리 분석하여 reflection_notes 검색 필요 여부 판단

    const canUseFTS5 = this.checkReflectionNotesAvailability(db);

    if (canUseFTS5) {
      // FTS5 MATCH 쿼리 사용
      // Note: FTS5 MATCH는 이미 메인 쿼리에서 처리되므로, 별도 조건 불필요
      // reflection_notes는 FTS5 테이블의 컬럼이므로 자동으로 검색됨
      return null; // FTS5 MATCH 쿼리에서는 별도 조건 불필요
    } else {
      // LIKE 쿼리 사용 (Fallback)
      const likeQuery = `%${searchQuery}%`;
      return `m.reflection_notes LIKE ?`;
    }
  }

  /**
   * Fact 메타 가중치 (Issue #88): num_times·last_mentioned_at으로 자주·최근 언급된 기억에 보정 배율 적용.
   * 반환값은 1 이상의 배율(예: 1.0 ~ 1.2)로, finalScore에 곱해 사용한다.
   */
  private calculateFactMetadataBoost(numTimes: number, lastMentionedAt: Date | null): number {
    const logFactor = Math.log(1 + Math.max(0, numTimes));
    const recencyFactor = lastMentionedAt
      ? 1 / (1 + (Date.now() - lastMentionedAt.getTime()) / (30 * 24 * 60 * 60 * 1000))
      : 1;
    const boost = 1 + 0.1 * logFactor * recencyFactor;
    return Math.min(boost, 1.2);
  }

  /**
   * 사용자에게 검색 결과가 선택된 이유를 명확히 전달하여 검색 결과의 신뢰성을 높입니다.
   * 관련성, 최근성, 중요도 등 다양한 요소를 종합하여 투명한 검색 과정을 제공합니다.
   */
  private generateRecallReason(
    relevance: number,
    recency: number,
    importance: number,
    finalScore: number,
    isFTS: boolean = false
  ): string {
    const reasons: string[] = [];
    
    if (isFTS) {
      reasons.push('FTS5 전문 검색');
    }
    if (relevance > 0.7) {
      reasons.push('높은 관련성');
    }
    if (recency > 0.8) {
      reasons.push('최근 생성');
    }
    if (importance > 0.8) {
      reasons.push('높은 중요도');
    }
    if (finalScore > 0.9) {
      reasons.push('종합 점수 우수');
    }
    
    return reasons.length > 0 ? reasons.join(', ') : '일반 검색 결과';
  }
}
