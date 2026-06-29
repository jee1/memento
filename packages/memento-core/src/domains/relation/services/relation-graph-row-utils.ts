/**
 * RelationRow → MemoryRelation 매핑 유틸리티
 */

import type { MemoryRelation } from '../../../shared/types/relation-graph.js';
import type { RelationType } from '../../../shared/types/relation.js';
import { logger } from '../../../shared/utils/logger.js';
import { isRelationRow, type RelationRow } from '../../../shared/utils/type-guards.js';

/**
 * RelationRow를 MemoryRelation으로 변환합니다.
 */
export function mapRelationRowToMemoryRelation(row: RelationRow): MemoryRelation {
  return {
    id: row.id,
    source_id: row.source_id,
    target_id: row.target_id,
    relation_type: row.relation_type as RelationType,
    confidence: row.confidence,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined
  };
}

/**
 * 타입 가드로 RelationRow만 필터링합니다.
 */
export function filterRelationRows(rows: unknown[]): RelationRow[] {
  return rows.filter((row): row is RelationRow => isRelationRow(row));
}

/**
 * 타입 가드로 RelationRow만 필터링하고, 검증 실패 시 경고를 기록합니다.
 */
export function filterRelationRowsWithWarning(rows: unknown[]): RelationRow[] {
  const validRows = filterRelationRows(rows);

  if (validRows.length !== rows.length) {
    logger.warn('관계 조회 결과 일부 행의 타입 검증 실패', {
      totalRows: rows.length,
      validRows: validRows.length
    });
  }

  return validRows;
}
