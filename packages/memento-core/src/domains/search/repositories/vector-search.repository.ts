/**
 * 벡터 검색 리포지토리 구현
 * 데이터베이스 접근 로직 분리
 */

import Database from 'better-sqlite3';
import { vectorCompatibilityService } from '../../embedding/services/vector-compatibility-service.js';
import { mcpLogger } from '../../../server/mcp-logger.js';
import { VECTOR_SEARCH_CONFIG } from '../../../shared/config/vector-search.config.js';
import type { VectorSearchRepository } from '../../../shared/interfaces/database.interface.js';
import type { SqlParam } from '../../../shared/types/index.js';
import type {
VectorIndexStatus,
VectorSearchQuery,
VectorSearchResult
} from '../../../shared/types/vector-search.types.js';
import { getVectorTableName as getValidatedVectorTableName } from '../../../shared/utils/sql-security-validator.js';

/**
 * 데이터베이스에서 반환된 원시 결과 타입
 * SQL 쿼리 결과는 VectorSearchResult와 유사하지만 완전히 일치하지 않을 수 있음
 */
interface RawVectorSearchResult {
  memory_id: string;
  similarity: number;
  content: string;
  type: string;
  importance: number;
  created_at: string;
  last_accessed_at?: string | null;
  pinned: number | boolean;
  tags?: string | null;
  // 하이브리드 검색 결과에 포함될 수 있는 추가 필드
  vector_similarity?: number;
  text_similarity?: number;
  task_goal?: string | null;
  steps?: string | null;
  reflection_notes?: string | null;
  workflow_name?: string | null;
  skill_name?: string | null;
  trigger_conditions?: string | null;
  [key: string]: unknown; // 기타 추가 필드 허용
}

export class VectorSearchRepositoryImpl implements VectorSearchRepository {
  private db: Database.Database | null = null;
  private isVecAvailable = false;

  constructor(db: Database.Database) {
    this.db = db;
    this.checkVecAvailability();
  }

  /**
   * VEC 사용 가능 여부 확인
   */
  checkVecAvailability(): boolean {
    if (!this.db) {
      mcpLogger.logServer('warn', 'VEC를 사용할 수 없습니다. 빈 결과를 반환합니다.', {
        category: 'VEC_UNAVAILABLE'
      });
      this.isVecAvailable = false;
      return false;
    }

    try {
      const runtimeContext = this.resolveRuntimeVectorContext();
      if (!this.isVecTableRegistered(runtimeContext.tableName)) {
        mcpLogger.logServer('warn', 'VEC 함수를 사용할 수 없습니다', {
          category: 'VEC_UNAVAILABLE',
          error: `no vec table registered: ${runtimeContext.tableName}`
        });
        this.isVecAvailable = false;
        return false;
      }
      const testStatement = this.db.prepare(
        `SELECT distance FROM ${runtimeContext.tableName} WHERE embedding MATCH ? LIMIT 0`
      );

      if (typeof testStatement.get !== 'function') {
        mcpLogger.logServer('warn', 'VEC 테스트 쿼리를 실행할 수 없습니다: get() 메서드가 없습니다.', {
          category: 'VEC_UNAVAILABLE',
          provider: runtimeContext.provider,
          tableName: runtimeContext.tableName,
          expectedDimensions: runtimeContext.expectedDimensions,
          targetDimensions: runtimeContext.targetDimensions
        });
        this.isVecAvailable = false;
        return false;
      }

      testStatement.get(JSON.stringify(new Array(runtimeContext.targetDimensions).fill(0)));

      this.isVecAvailable = true;
      mcpLogger.logServer('info', 'VEC (Vector Search) 사용 가능');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      mcpLogger.logServer('warn', 'VEC 함수를 사용할 수 없습니다', {
        category: 'VEC_UNAVAILABLE',
        error: message
      });
      this.isVecAvailable = false;
      return false;
    }
  }

  /**
   * 벡터 검색 실행
   */
  async search(query: VectorSearchQuery): Promise<VectorSearchResult[]> {
    if (!this.db || !this.isVecAvailable) {
      mcpLogger.logServer('warn', 'VEC를 사용할 수 없습니다. 빈 결과를 반환합니다.', {
        category: 'VEC_UNAVAILABLE'
      });
      return [];
    }

    const { queryVector, options } = query;
    const normalizedOptions = options ?? {};
    const {
      limit = VECTOR_SEARCH_CONFIG.defaultLimit,
      threshold = VECTOR_SEARCH_CONFIG.defaultThreshold,
      type,
      types,
      includeContent = true,
      includeMetadata = false
    } = normalizedOptions;

    const runtimeContext = this.resolveRuntimeVectorContext(query.provider);
    const {
      provider,
      expectedDimensions,
      actualStoredDimensions,
      targetDimensions,
      tableName
    } = runtimeContext;

    const effectiveQueryVector = this.alignQueryVectorToStoredDimensions(
      queryVector,
      provider,
      expectedDimensions,
      targetDimensions
    );
    if (!effectiveQueryVector) {
      mcpLogger.logServer('error', '벡터 차원 불일치', {
        category: 'VECTOR_DIMENSION_MISMATCH',
        expected: targetDimensions,
        actual: queryVector.length,
        provider,
        expectedDimensions,
        actualStoredDimensions,
        targetDimensions
      });
      return [];
    }

    // types 배열 처리: types가 있으면 사용, 없으면 type 사용
    const typeFilters = Array.isArray(types) && types.length > 0
      ? types.filter(Boolean)
      : (type ? [type] : []);

    try {
      // SQL Injection 방지: 화이트리스트 검증은 getTableName()에서 수행됨
      // 템플릿 리터럴 대신 문자열 연결 사용
      const _typeClause = typeFilters.length > 0
        ? `AND mi.type IN (${typeFilters.map(() => '?').join(',')})`
        : '';
      // sqlite-vec의 vec0_knn은 MATCH 다음에 바로 LIMIT이 와야 함
      // 서브쿼리로 먼저 벡터 검색을 수행하고 LIMIT을 적용한 후 JOIN
      const prefetchLimit = typeFilters.length > 0 ? limit * 5 : limit;
      const vecQuery =
        'SELECT ' +
        '  me.memory_id as memory_id, ' +
        '  t.distance as similarity, ' +
        '  mi.content, ' +
        '  mi.type, ' +
        '  mi.importance, ' +
        '  mi.created_at, ' +
        '  COALESCE(mi.last_accessed_at, mi.last_accessed) as last_accessed_at, ' +
        '  mi.pinned, ' +
        '  mi.tags, ' +
        '  mi.task_goal, ' +
        '  mi.steps, ' +
        '  mi.reflection_notes, ' +
        '  mi.workflow_name, ' +
        '  mi.skill_name, ' +
        '  mi.trigger_conditions ' +
        'FROM (' +
        '  SELECT rowid, distance ' +
        `  FROM ${tableName} ` +
        '  WHERE embedding MATCH ? ' +
        '  ORDER BY distance ASC ' +
        '  LIMIT ?' +
        ') t ' +
        'JOIN memory_embedding me ON t.rowid = me.id ' +
        'JOIN memory_item mi ON mi.id = me.memory_id AND (COALESCE(mi.is_deleted, 0) = 0) ' +
        (typeFilters.length > 0 ? `WHERE mi.type IN (${typeFilters.map(() => '?').join(',')}) ` : '') +
        'ORDER BY t.distance ASC ' +
        'LIMIT ?';

      const params = [
        JSON.stringify(effectiveQueryVector),
        prefetchLimit,
        ...typeFilters,
        limit
      ];
      const statement = this.db.prepare(vecQuery);
      if (typeof statement.all !== 'function') {
        mcpLogger.logServer('warn', '벡터 검색 쿼리를 실행할 수 없습니다: all() 메서드가 없습니다.');
        return [];
      }
      const rawResults = statement.all(...params);
      const results: RawVectorSearchResult[] = Array.isArray(rawResults) ? rawResults as RawVectorSearchResult[] : [];

      // 유사도를 0-1 범위로 정규화
      const normalizedResults: VectorSearchResult[] = results
        .map(result => {
          const similarity = Math.max(0, 1 - result.similarity);
          return {
            memory_id: result.memory_id,
            similarity,
            content: includeContent ? result.content : '',
            type: result.type,
            importance: result.importance,
            created_at: result.created_at,
            last_accessed: includeMetadata
              ? (typeof result.last_accessed_at === 'string' ? result.last_accessed_at : undefined)
              : undefined,
            pinned: includeMetadata ? Boolean(result.pinned) : false,
            tags: includeMetadata ? this.safeParseTags(result.tags) : undefined
          };
        })
        .filter(result => result.similarity >= threshold);

      mcpLogger.logServer('debug', '벡터 검색 완료', { resultCount: normalizedResults.length, threshold });
      return normalizedResults;

    } catch (error) {
      mcpLogger.logServer('error', '벡터 검색 실패', {
        category: 'VECTOR_SQL_EXECUTION_FAILED',
        error: error instanceof Error ? error.message : String(error),
        provider,
        tableName,
        expectedDimensions,
        targetDimensions,
        actualStoredDimensions,
        actualVectorLength: queryVector.length
      });
      return [];
    }
  }

  /**
   * 하이브리드 검색 실행
   */
  async hybridSearch(query: VectorSearchQuery): Promise<VectorSearchResult[]> {
    if (!this.db || !this.isVecAvailable) {
      mcpLogger.logServer('warn', 'VEC를 사용할 수 없습니다. 빈 결과를 반환합니다.', {
        category: 'VEC_UNAVAILABLE'
      });
      return [];
    }

    const { queryVector, textQuery, options } = query;
    const normalizedOptions = options ?? {};
    const {
      limit = VECTOR_SEARCH_CONFIG.defaultLimit,
      threshold = VECTOR_SEARCH_CONFIG.defaultThreshold,
      type,
      types,
      includeContent = true,
      includeMetadata = false
    } = normalizedOptions;

    const runtimeContext = this.resolveRuntimeVectorContext(query.provider);
    const {
      provider,
      expectedDimensions,
      actualStoredDimensions,
      targetDimensions,
      tableName
    } = runtimeContext;

    const effectiveQueryVector = this.alignQueryVectorToStoredDimensions(
      queryVector,
      provider,
      expectedDimensions,
      targetDimensions
    );
    if (!effectiveQueryVector) {
      mcpLogger.logServer('error', '벡터 차원 불일치', {
        category: 'VECTOR_DIMENSION_MISMATCH',
        expected: targetDimensions,
        actual: queryVector.length,
        provider,
        expectedDimensions,
        actualStoredDimensions,
        targetDimensions
      });
      return [];
    }

    // types 배열 처리: types가 있으면 사용, 없으면 type 사용
    const typeFilters = Array.isArray(types) && types.length > 0
      ? types.filter(Boolean)
      : (type ? [type] : []);

    try {
      // textQuery가 없거나 빈 문자열이면 텍스트 검색을 건너뛰고 벡터 검색만 사용
      // FTS5는 빈 쿼리를 에러로 처리하므로 이를 방지
      const hasTextQuery = textQuery && textQuery.trim().length > 0;

      let hybridQuery: string;
      let params: SqlParam[];

      if (hasTextQuery) {
        // 텍스트 검색과 벡터 검색 모두 사용
        // SQL Injection 방지: 화이트리스트 검증은 getTableName()에서 수행됨
        // 템플릿 리터럴 대신 문자열 연결 사용
        const _vectorTypeClause = typeFilters.length > 0
          ? `AND mi.type IN (${typeFilters.map(() => '?').join(',')})`
          : '';
        const textTypeClause = typeFilters.length > 0
          ? `AND mi.type IN (${typeFilters.map(() => '?').join(',')})`
          : '';
        hybridQuery =
          'WITH vector_search AS (' +
          '  SELECT ' +
          '    me.memory_id as memory_id, ' +
          '    t.distance as vector_distance, ' +
          '    mi.content, ' +
          '    mi.type, ' +
          '    mi.importance, ' +
          '    mi.created_at, ' +
          '    COALESCE(mi.last_accessed_at, mi.last_accessed) as last_accessed_at, ' +
          '    mi.pinned, ' +
          '    mi.tags, ' +
          '    mi.task_goal, ' +
          '    mi.steps, ' +
          '    mi.reflection_notes, ' +
          '    mi.workflow_name, ' +
          '    mi.skill_name, ' +
          '    mi.trigger_conditions ' +
          '  FROM (' +
          '    SELECT rowid, distance ' +
          `    FROM ${tableName} ` +
          '    WHERE embedding MATCH ? ' +
          '    ORDER BY distance ASC ' +
          '    LIMIT ?' +
          '  ) t ' +
          '  JOIN memory_embedding me ON t.rowid = me.id ' +
          '  JOIN memory_item mi ON mi.id = me.memory_id AND (COALESCE(mi.is_deleted, 0) = 0) ' +
          (typeFilters.length > 0 ? `  WHERE mi.type IN (${typeFilters.map(() => '?').join(',')}) ` : '') +
          '), ' +
          'text_search AS (' +
          '  SELECT ' +
          '    mi.id as memory_id, ' +
          '    mi.content, ' +
          '    mi.type, ' +
          '    mi.importance, ' +
          '    mi.created_at, ' +
          '    COALESCE(mi.last_accessed_at, mi.last_accessed) as last_accessed_at, ' +
          '    mi.pinned, ' +
          '    mi.tags, ' +
          '    mi.task_goal, ' +
          '    mi.steps, ' +
          '    mi.reflection_notes, ' +
          '    mi.workflow_name, ' +
          '    mi.skill_name, ' +
          '    mi.trigger_conditions, ' +
          '    fts.rank as text_rank ' +
          '  FROM memory_item_fts fts ' +
          '  JOIN memory_item mi ON fts.rowid = mi.rowid AND (COALESCE(mi.is_deleted, 0) = 0) ' +
          '  WHERE memory_item_fts MATCH ? ' +
          textTypeClause + ' ' +
          ') ' +
          'SELECT ' +
          '  COALESCE(vs.memory_id, ts.memory_id) as memory_id, ' +
          '  COALESCE(1 - vs.vector_distance, 0) as vector_similarity, ' +
          '  COALESCE(ts.text_rank, 0) as text_similarity, ' +
          '  COALESCE(vs.content, ts.content) as content, ' +
          '  COALESCE(vs.type, ts.type) as type, ' +
          '  COALESCE(vs.importance, ts.importance) as importance, ' +
          '  COALESCE(vs.created_at, ts.created_at) as created_at, ' +
          '  COALESCE(vs.last_accessed_at, ts.last_accessed_at, vs.last_accessed, ts.last_accessed) as last_accessed_at, ' +
          '  COALESCE(vs.pinned, ts.pinned) as pinned, ' +
          '  COALESCE(vs.tags, ts.tags) as tags, ' +
          '  COALESCE(vs.task_goal, ts.task_goal) as task_goal, ' +
          '  COALESCE(vs.steps, ts.steps) as steps, ' +
          '  COALESCE(vs.reflection_notes, ts.reflection_notes) as reflection_notes, ' +
          '  COALESCE(vs.workflow_name, ts.workflow_name) as workflow_name, ' +
          '  COALESCE(vs.skill_name, ts.skill_name) as skill_name, ' +
          '  COALESCE(vs.trigger_conditions, ts.trigger_conditions) as trigger_conditions ' +
          'FROM vector_search vs ' +
          'LEFT JOIN text_search ts ON vs.memory_id = ts.memory_id ' +
          'WHERE vs.memory_id IS NOT NULL ' +
          'UNION ' +
          'SELECT ' +
          '  ts.memory_id, ' +
          '  0 as vector_similarity, ' +
          '  ts.text_rank as text_similarity, ' +
          '  ts.content, ' +
          '  ts.type, ' +
          '  ts.importance, ' +
          '  ts.created_at, ' +
          '  COALESCE(ts.last_accessed_at, ts.last_accessed) as last_accessed_at, ' +
          '  ts.pinned, ' +
          '  ts.tags, ' +
          '  ts.task_goal, ' +
          '  ts.steps, ' +
          '  ts.reflection_notes, ' +
          '  ts.workflow_name, ' +
          '  ts.skill_name, ' +
          '  ts.trigger_conditions ' +
          'FROM text_search ts ' +
          'LEFT JOIN vector_search vs ON ts.memory_id = vs.memory_id ' +
          'WHERE vs.memory_id IS NULL ' +
          'ORDER BY (vector_similarity * 0.6 + text_similarity * 0.4) DESC ' +
          'LIMIT ?';

        // sqlite-vec의 vec0_knn은 MATCH 다음에 바로 LIMIT이 와야 함
        // 서브쿼리에서 LIMIT을 적용하기 위해 prefetchLimit 사용
        const prefetchLimit = typeFilters.length > 0 ? limit * 5 : limit;
        params = [
          JSON.stringify(effectiveQueryVector),
          prefetchLimit,
          ...typeFilters,
          textQuery.trim(),
          ...typeFilters,
          limit
        ];
      } else {
        // 텍스트 검색 없이 벡터 검색만 사용
        // SQL Injection 방지: 화이트리스트 검증은 getTableName()에서 수행됨
        // 템플릿 리터럴 대신 문자열 연결 사용
        const _typeClause = typeFilters.length > 0
          ? `AND mi.type IN (${typeFilters.map(() => '?').join(',')})`
          : '';
        // sqlite-vec의 vec0_knn은 MATCH 다음에 바로 LIMIT이 와야 함
        // 서브쿼리로 먼저 벡터 검색을 수행하고 LIMIT을 적용한 후 JOIN
        const prefetchLimit = typeFilters.length > 0 ? limit * 5 : limit;
        hybridQuery =
          'SELECT ' +
          '  me.memory_id as memory_id, ' +
          '  COALESCE(1 - t.distance, 0) as vector_similarity, ' +
          '  0 as text_similarity, ' +
          '  mi.content, ' +
          '  mi.type, ' +
          '  mi.importance, ' +
          '  mi.created_at, ' +
          '  COALESCE(mi.last_accessed_at, mi.last_accessed) as last_accessed_at, ' +
          '  mi.pinned, ' +
          '  mi.tags, ' +
          '  mi.task_goal, ' +
          '  mi.steps, ' +
          '  mi.reflection_notes, ' +
          '  mi.workflow_name, ' +
          '  mi.skill_name, ' +
          '  mi.trigger_conditions ' +
          'FROM (' +
          '  SELECT rowid, distance ' +
          `  FROM ${tableName} ` +
          '  WHERE embedding MATCH ? ' +
          '  ORDER BY distance ASC ' +
          '  LIMIT ?' +
          ') t ' +
          'JOIN memory_embedding me ON t.rowid = me.id ' +
          'JOIN memory_item mi ON mi.id = me.memory_id AND (COALESCE(mi.is_deleted, 0) = 0) ' +
          (typeFilters.length > 0 ? `WHERE mi.type IN (${typeFilters.map(() => '?').join(',')}) ` : '') +
          'ORDER BY t.distance ASC ' +
          'LIMIT ?';

        params = [
          JSON.stringify(effectiveQueryVector),
          prefetchLimit,
          ...typeFilters,
          limit
        ];
      }

      const statement = this.db.prepare(hybridQuery);
      if (typeof statement.all !== 'function') {
        mcpLogger.logServer('warn', '하이브리드 검색 쿼리를 실행할 수 없습니다: all() 메서드가 없습니다.');
        return [];
      }
      const rawResults = statement.all(...params);
      const results: RawVectorSearchResult[] = Array.isArray(rawResults) ? rawResults as RawVectorSearchResult[] : [];

      // 결과 정규화
      const normalizedResults: VectorSearchResult[] = results
        .map(result => {
          // 타입 안전성을 위해 필드 타입 검증
          const vectorSimilarity = typeof result.vector_similarity === 'number' ? result.vector_similarity : (result.similarity as number);
          const textSimilarity = typeof result.text_similarity === 'number' ? result.text_similarity : 0;

          const similarity = hasTextQuery
            ? vectorSimilarity * 0.6 + textSimilarity * 0.4 // 하이브리드 가중치
            : vectorSimilarity; // 텍스트 검색 없을 때는 벡터 유사도만 사용

          return {
            memory_id: result.memory_id,
            similarity,
            content: includeContent ? result.content : '',
            type: result.type,
            importance: result.importance,
            created_at: result.created_at,
            last_accessed: includeMetadata
              ? (typeof result.last_accessed_at === 'string' ? result.last_accessed_at : undefined)
              : undefined,
            pinned: includeMetadata ? Boolean(result.pinned) : false,
            tags: includeMetadata ? this.safeParseTags(result.tags) : undefined
          };
        })
        .filter(result => result.similarity >= threshold);

      mcpLogger.logServer('debug', '하이브리드 검색 완료', { resultCount: normalizedResults.length });
      return normalizedResults;

    } catch (error) {
      mcpLogger.logServer('error', '하이브리드 검색 실패', {
        category: 'VECTOR_SQL_EXECUTION_FAILED',
        error: error instanceof Error ? error.message : String(error),
        provider,
        tableName,
        expectedDimensions,
        targetDimensions,
        actualStoredDimensions,
        actualVectorLength: queryVector.length
      });
      return [];
    }
  }

  /**
   * 인덱스 상태 확인
   */
  getIndexStatus(): VectorIndexStatus {
    if (!this.db) {
      return { 
        available: false, 
        tableExists: false, 
        recordCount: 0, 
        dimensions: VECTOR_SEARCH_CONFIG.defaultDimensions,
        vecExtensionLoaded: false
      };
    }

    try {
      const tableExists = this.isVecAvailable;
      let recordCount = 0;

      if (tableExists) {
        // 모든 제공자별 테이블의 레코드 수 합계
        const providers = ['tfidf', 'minilm', 'openai', 'gemini'];
        for (const provider of providers) {
          const tableName = this.getTableName(provider);
          try {
            // SQL Injection 방지: 화이트리스트 검증은 getTableName()에서 수행됨
            const statement = this.db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`);
            if (typeof statement.get !== 'function') {
              continue;
            }
            const result = statement.get() as { count: number } | undefined;
            if (result && typeof result.count === 'number') {
              recordCount += result.count;
            }
          } catch (error) {
            // 테이블이 존재하지 않는 경우 무시
          }
        }
      }

      return {
        available: this.isVecAvailable,
        tableExists,
        recordCount,
        dimensions: VECTOR_SEARCH_CONFIG.defaultDimensions,
        vecExtensionLoaded: this.isVecAvailable
      };
    } catch (error) {
      mcpLogger.logServer('error', '인덱스 상태 확인 실패', { error: error instanceof Error ? error.message : String(error) });
      return { 
        available: false, 
        tableExists: false, 
        recordCount: 0, 
        dimensions: VECTOR_SEARCH_CONFIG.defaultDimensions,
        vecExtensionLoaded: false
      };
    }
  }

  /**
   * 인덱스 재구성
   */
  async rebuildIndex(): Promise<boolean> {
    if (!this.db || !this.isVecAvailable) {
      mcpLogger.logServer('warn', 'VEC를 사용할 수 없습니다.');
      return false;
    }

    try {
      mcpLogger.logServer('info', '벡터 인덱스 재구성 시작');
      // VEC 인덱스 재구성 (sqlite-vec는 자동으로 인덱스를 관리)
      mcpLogger.logServer('info', '벡터 인덱스 재구성 완료 (sqlite-vec는 자동 인덱스 관리)');
      return true;
    } catch (error) {
      mcpLogger.logServer('error', '벡터 인덱스 재구성 실패', { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  /**
   * 테이블명 반환
   * dimensions 전달 시 tfidf+384 → memory_item_vec 매핑 적용.
   */
  getTableName(provider: string, dimensions?: number): string {
    return getValidatedVectorTableName(provider ?? 'tfidf', dimensions);
  }

  /**
   * VEC 사용 가능 여부 확인 (VectorIndexRepository 인터페이스 구현)
   */
  checkAvailability(): boolean {
    return this.checkVecAvailability();
  }

  /**
   * sqlite_master에 vec 테이블이 등록되어 있는지 확인합니다.
   * 단순한 DB mock이 테이블 부재를 반영하지 못해 preflight가 오탐되는 것을 줄입니다 (issue #278).
   */
  private isVecTableRegistered(tableName: string): boolean {
    if (!this.db) {
      return false;
    }
    try {
      const statement = this.db.prepare(
        `SELECT 1 as ok FROM sqlite_master WHERE type IN ('table', 'virtual') AND name = ? LIMIT 1`
      );
      if (typeof statement.get !== 'function') {
        return false;
      }
      const row = statement.get(tableName) as { ok: number } | undefined;
      return row !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * memory_embedding 우세 dimensions로 vec 테이블을 고를지 여부.
   * tfidf만 memory_item_vec(384) vs memory_item_vec_tfidf(512) 레거시 분기가 있어
   * 저장 차원을 따른다. minilm/openai/gemini/lightweight는 vec 스키마가 provider별로
   * 고정이므로 오염된 dimensions 컬럼을 쓰면 쿼리 벡터만 늘어나 sqlite-vec 차원 오류가 난다.
   */
  private shouldUseDominantStoredDimensionsForTable(provider: string | undefined): boolean {
    return (provider ?? 'tfidf').toLowerCase() === 'tfidf';
  }

  private resolveRuntimeVectorContext(provider?: string): {
    provider: string;
    expectedDimensions: number;
    actualStoredDimensions: number | null;
    targetDimensions: number;
    tableName: string;
  } {
    const effectiveProvider = provider ?? 'tfidf';
    const expectedDimensions = this.getExpectedDimensions(effectiveProvider);

    let actualStoredDimensions: number | null = null;
    try {
      if (this.db && this.shouldUseDominantStoredDimensionsForTable(effectiveProvider)) {
        actualStoredDimensions = this.getDominantStoredDimensions(effectiveProvider);
      }
    } catch (error) {
      // 차원 조회 실패 시 무시하고 예상 차원 사용
      mcpLogger.logServer('warn', '저장된 임베딩 차원 조회 실패', {
        provider: effectiveProvider,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // 데이터 불일치 감지: actualStoredDimensions가 expectedDimensions와 다르면 경고
    if (actualStoredDimensions !== null && actualStoredDimensions !== expectedDimensions) {
      mcpLogger.logServer('warn', '저장된 임베딩 차원 불일치 감지', {
        provider: effectiveProvider,
        expectedDimensions,
        actualStoredDimensions,
        message: '저장된 차원을 사용해 테이블을 선택합니다 (384 시 memory_item_vec).'
      });
    }

    const targetDimensions = actualStoredDimensions ?? expectedDimensions;
    const tableName = this.getTableName(effectiveProvider, targetDimensions);

    return {
      provider: effectiveProvider,
      expectedDimensions,
      actualStoredDimensions,
      targetDimensions,
      tableName
    };
  }

  /**
   * provider별로 가장 많이 등장하는 dimensions를 사용합니다.
   * LIMIT 1 임의 행보다 혼재 차원 DB에서 테이블 선택이 안정적입니다.
   */
  private getDominantStoredDimensions(provider: string): number | null {
    if (!this.db) {
      return null;
    }
    const row = this.db
      .prepare(
        `SELECT dimensions
         FROM memory_embedding
         WHERE embedding_provider = ?
           AND dimensions IS NOT NULL
           AND dimensions > 0
         GROUP BY dimensions
         ORDER BY COUNT(*) DESC, dimensions DESC
         LIMIT 1`
      )
      .get(provider) as { dimensions: number } | undefined;
    return row?.dimensions ?? null;
  }

  /**
   * 쿼리 벡터가 현재 설정상 네이티브 차원이면, 저장소 기준 차원으로 투영합니다.
   * 그 외 길이 불일치는 null을 반환합니다(호출부에서 기존 오류 처리).
   */
  private alignQueryVectorToStoredDimensions(
    queryVector: number[],
    provider: string | undefined,
    expectedDimensions: number,
    targetDimensions: number
  ): number[] | null {
    if (!Array.isArray(queryVector) || queryVector.length === 0) {
      return null;
    }
    if (queryVector.length === targetDimensions) {
      return queryVector;
    }
    if (queryVector.length !== expectedDimensions) {
      return null;
    }
    try {
      const projected = vectorCompatibilityService.project(queryVector, {
        targetDimensions,
        normalization: 'none'
      });
      if (projected.vector.length !== targetDimensions) {
        return null;
      }
      if (projected.sourceDimensions !== projected.targetDimensions) {
        mcpLogger.logServer('warn', '쿼리 임베딩을 저장소 차원에 맞게 투영했습니다', {
          provider: provider ?? 'tfidf',
          fromDimensions: projected.sourceDimensions,
          toDimensions: projected.targetDimensions,
          projectionType: projected.projectionType
        });
      }
      return projected.vector;
    } catch {
      return null;
    }
  }

  private getExpectedDimensions(provider?: string): number {
    // provider가 없을 때도 getTableName과 동일하게 'tfidf'의 차원을 사용
    // 왜 필요한가? getTableName(provider ?? 'tfidf')는 'tfidf' 테이블(512차원)을 선택하므로
    // 차원 계산도 동일하게 'tfidf'의 차원(512)을 사용해야 차원 불일치 오류를 방지할 수 있음
    const effectiveProvider = provider ?? 'tfidf';
    return VECTOR_SEARCH_CONFIG.providerDimensions[effectiveProvider] ?? VECTOR_SEARCH_CONFIG.defaultDimensions;
  }

  private safeParseTags(raw: string | null | undefined): string[] {
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      mcpLogger.logServer('warn', '태그 JSON 파싱 실패, 빈 배열로 대체합니다', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }
}
