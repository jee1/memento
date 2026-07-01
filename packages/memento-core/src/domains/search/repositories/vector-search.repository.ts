/**
 * 벡터 검색 리포지토리 구현 (composition 오케스트레이터)
 * 데이터베이스 접근 로직 분리
 */

import Database from 'better-sqlite3';
import { mcpLogger } from '../../../server/mcp-logger.js';
import { VECTOR_SEARCH_CONFIG } from '../../../shared/config/vector-search.config.js';
import type { VectorSearchRepository } from '../../../shared/interfaces/database.interface.js';
import type {
  VectorIndexStatus,
  VectorSearchQuery,
  VectorSearchResult
} from '../../../shared/types/vector-search.types.js';
import {
  checkVecAvailability as probeVecAvailability,
  getIndexStatus as resolveIndexStatus,
  rebuildIndex as rebuildVecIndex,
} from './vector-search/vector-search-availability.js';
import { executeHybridQuery } from './vector-search/vector-search-hybrid-query.js';
import { executeKnnQuery } from './vector-search/vector-search-knn-query.js';
import {
  alignQueryVectorToStoredDimensions,
  getTableName,
  resolveRuntimeVectorContext,
} from './vector-search/vector-search-runtime-context.js';
import { parseVectorSearchScope } from './vector-search/vector-search-scope.js';
import type { VectorSearchExecutionOptions } from './vector-search/vector-search.types.js';

export class VectorSearchRepositoryImpl implements VectorSearchRepository {
  private db: Database.Database | null = null;
  private isVecAvailable = false;

  constructor(db: Database.Database) {
    this.db = db;
    this.checkVecAvailability();
  }

  checkVecAvailability(): boolean {
    this.isVecAvailable = probeVecAvailability(this.db);
    return this.isVecAvailable;
  }

  async search(query: VectorSearchQuery): Promise<VectorSearchResult[]> {
    if (!this.db || !this.isVecAvailable) {
      mcpLogger.logServer('warn', 'VEC를 사용할 수 없습니다. 빈 결과를 반환합니다.', {
        category: 'VEC_UNAVAILABLE'
      });
      return [];
    }

    const { queryVector, options } = query;
    const normalizedOptions = options ?? {};
    const executionOptions = this.resolveExecutionOptions(normalizedOptions);
    const runtimeContext = resolveRuntimeVectorContext(this.db, query.provider);
    const scope = parseVectorSearchScope(query);

    const effectiveQueryVector = alignQueryVectorToStoredDimensions(
      queryVector,
      runtimeContext.provider,
      runtimeContext.expectedDimensions,
      runtimeContext.targetDimensions
    );
    if (!effectiveQueryVector) {
      this.logDimensionMismatch(queryVector, runtimeContext);
      return [];
    }

    try {
      return executeKnnQuery({
        db: this.db,
        effectiveQueryVector,
        runtimeContext,
        scope,
        options: executionOptions,
      });
    } catch (error) {
      this.logSqlError('벡터 검색 실패', error, runtimeContext, queryVector.length);
      return [];
    }
  }

  async hybridSearch(query: VectorSearchQuery): Promise<VectorSearchResult[]> {
    if (!this.db || !this.isVecAvailable) {
      mcpLogger.logServer('warn', 'VEC를 사용할 수 없습니다. 빈 결과를 반환합니다.', {
        category: 'VEC_UNAVAILABLE'
      });
      return [];
    }

    const { queryVector, textQuery, options } = query;
    const normalizedOptions = options ?? {};
    const executionOptions = this.resolveExecutionOptions(normalizedOptions);
    const runtimeContext = resolveRuntimeVectorContext(this.db, query.provider);
    const scope = parseVectorSearchScope(query);

    const effectiveQueryVector = alignQueryVectorToStoredDimensions(
      queryVector,
      runtimeContext.provider,
      runtimeContext.expectedDimensions,
      runtimeContext.targetDimensions
    );
    if (!effectiveQueryVector) {
      this.logDimensionMismatch(queryVector, runtimeContext);
      return [];
    }

    try {
      return executeHybridQuery({
        db: this.db,
        effectiveQueryVector,
        textQuery,
        runtimeContext,
        scope,
        options: executionOptions,
      });
    } catch (error) {
      this.logSqlError('하이브리드 검색 실패', error, runtimeContext, queryVector.length);
      return [];
    }
  }

  getIndexStatus(): VectorIndexStatus {
    return resolveIndexStatus(this.db, this.isVecAvailable);
  }

  async rebuildIndex(): Promise<boolean> {
    return rebuildVecIndex(this.db, this.isVecAvailable);
  }

  getTableName(provider: string, dimensions?: number): string {
    return getTableName(provider, dimensions);
  }

  checkAvailability(): boolean {
    return this.checkVecAvailability();
  }

  private resolveExecutionOptions(
    normalizedOptions: NonNullable<VectorSearchQuery['options']>
  ): VectorSearchExecutionOptions {
    const {
      limit = VECTOR_SEARCH_CONFIG.defaultLimit,
      threshold = VECTOR_SEARCH_CONFIG.defaultThreshold,
      includeContent = true,
      includeMetadata = false,
    } = normalizedOptions;

    return { limit, threshold, includeContent, includeMetadata };
  }

  private logDimensionMismatch(
    queryVector: number[],
    runtimeContext: ReturnType<typeof resolveRuntimeVectorContext>
  ): void {
    mcpLogger.logServer('error', '벡터 차원 불일치', {
      category: 'VECTOR_DIMENSION_MISMATCH',
      expected: runtimeContext.targetDimensions,
      actual: queryVector.length,
      provider: runtimeContext.provider,
      expectedDimensions: runtimeContext.expectedDimensions,
      actualStoredDimensions: runtimeContext.actualStoredDimensions,
      targetDimensions: runtimeContext.targetDimensions
    });
  }

  private logSqlError(
    message: string,
    error: unknown,
    runtimeContext: ReturnType<typeof resolveRuntimeVectorContext>,
    actualVectorLength: number
  ): void {
    mcpLogger.logServer('error', message, {
      category: 'VECTOR_SQL_EXECUTION_FAILED',
      error: error instanceof Error ? error.message : String(error),
      provider: runtimeContext.provider,
      tableName: runtimeContext.tableName,
      expectedDimensions: runtimeContext.expectedDimensions,
      targetDimensions: runtimeContext.targetDimensions,
      actualStoredDimensions: runtimeContext.actualStoredDimensions,
      actualVectorLength
    });
  }
}
