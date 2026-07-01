/**
 * 벡터 검색 런타임 컨텍스트 해석 (provider·차원·테이블명)
 */

import type Database from 'better-sqlite3';
import { vectorCompatibilityService } from '../../../embedding/services/vector-compatibility-service.js';
import { mcpLogger } from '../../../../server/mcp-logger.js';
import { VECTOR_SEARCH_CONFIG } from '../../../../shared/config/vector-search.config.js';
import { getVectorTableName as getValidatedVectorTableName } from '../../../../shared/utils/sql-security-validator.js';
import type { RuntimeVectorContext } from './vector-search.types.js';

/**
 * 테이블명 반환
 * dimensions 전달 시 tfidf+384 → memory_item_vec 매핑 적용.
 */
export function getTableName(provider: string, dimensions?: number): string {
  return getValidatedVectorTableName(provider ?? 'tfidf', dimensions);
}

export function getExpectedDimensions(provider?: string): number {
  const effectiveProvider = provider ?? 'tfidf';
  return VECTOR_SEARCH_CONFIG.providerDimensions[effectiveProvider] ?? VECTOR_SEARCH_CONFIG.defaultDimensions;
}

/**
 * memory_embedding 우세 dimensions로 vec 테이블을 고를지 여부.
 */
export function shouldUseDominantStoredDimensionsForTable(provider: string | undefined): boolean {
  return (provider ?? 'tfidf').toLowerCase() === 'tfidf';
}

/**
 * vec0 가상 테이블 스키마 차원.
 */
export function getVecTableSchemaDimensions(tableName: string): number {
  const { providerDimensions, defaultDimensions } = VECTOR_SEARCH_CONFIG;
  const schemaByTable: Record<string, number> = {
    memory_item_vec: providerDimensions.lightweight ?? defaultDimensions,
    memory_item_vec_tfidf: providerDimensions.tfidf ?? defaultDimensions,
    memory_item_vec_minilm: providerDimensions.minilm ?? defaultDimensions,
    memory_item_vec_openai: providerDimensions.openai ?? defaultDimensions,
    memory_item_vec_gemini: providerDimensions.gemini ?? defaultDimensions,
    memory_item_vec_mock: providerDimensions.mock ?? 64,
  };
  return schemaByTable[tableName] ?? defaultDimensions;
}

/**
 * provider별로 가장 많이 등장하는 dimensions를 사용합니다.
 */
export function getDominantStoredDimensions(db: Database.Database, provider: string): number | null {
  const row = db
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

export function resolveRuntimeVectorContext(
  db: Database.Database | null,
  provider?: string
): RuntimeVectorContext {
  const effectiveProvider = provider ?? 'tfidf';
  const expectedDimensions = getExpectedDimensions(effectiveProvider);

  let actualStoredDimensions: number | null = null;
  try {
    if (db && shouldUseDominantStoredDimensionsForTable(effectiveProvider)) {
      actualStoredDimensions = getDominantStoredDimensions(db, effectiveProvider);
    }
  } catch (error) {
    mcpLogger.logServer('warn', '저장된 임베딩 차원 조회 실패', {
      provider: effectiveProvider,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  if (actualStoredDimensions !== null && actualStoredDimensions !== expectedDimensions) {
    mcpLogger.logServer('warn', '저장된 임베딩 차원 불일치 감지', {
      provider: effectiveProvider,
      expectedDimensions,
      actualStoredDimensions,
      message: '저장된 차원을 사용해 테이블을 선택합니다 (384 시 memory_item_vec).'
    });
  }

  const preliminaryTargetDimensions = actualStoredDimensions ?? expectedDimensions;
  const tableName = getTableName(effectiveProvider, preliminaryTargetDimensions);
  const targetDimensions = getVecTableSchemaDimensions(tableName);

  if (targetDimensions !== preliminaryTargetDimensions) {
    mcpLogger.logServer('warn', 'vec0 테이블 스키마 차원으로 MATCH 차원을 보정했습니다', {
      provider: effectiveProvider,
      preliminaryTargetDimensions,
      targetDimensions,
      tableName,
    });
  }

  return {
    provider: effectiveProvider,
    expectedDimensions,
    actualStoredDimensions,
    targetDimensions,
    tableName
  };
}

/**
 * 쿼리 벡터가 현재 설정상 네이티브 차원이면, 저장소 기준 차원으로 투영합니다.
 */
export function alignQueryVectorToStoredDimensions(
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
