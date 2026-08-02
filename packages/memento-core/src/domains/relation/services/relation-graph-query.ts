/**
 * 관계 그래프 조회 (DB + 캐시)
 */

import Database from 'better-sqlite3';
import type { GetRelationsOptions, MemoryRelation } from '../../../shared/types/relation-graph.js';
import type { RelationType } from '../../../shared/types/relation.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import type { RelationGraphCache } from './relation-graph-cache.js';
import {
  filterRelationRows,
  filterRelationRowsWithWarning,
  mapRelationRowToMemoryRelation
} from './relation-graph-row-utils.js';

export class RelationGraphQuery {
  constructor(
    private db: Database.Database,
    private cache: RelationGraphCache
  ) {}

  /**
   * 관계 조회
   */
  async getRelations(
    memoryId: string,
    options?: GetRelationsOptions
  ): Promise<MemoryRelation[]> {
    const direction = options?.direction ?? 'both';
    const relationTypes = options?.relationTypes;
    const minConfidence = options?.minConfidence;
    const limit = options?.limit;
    const offset = options?.offset ?? 0;
    const bypassCache = options?.bypassCache ?? false;

    if (!bypassCache) {
      const cacheKey = this.cache.generateCacheKey(memoryId, options);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    let query = '';
    const params: Array<string | number | RelationType> = [];

    if (direction === 'outgoing') {
      query = 'SELECT * FROM memory_relation WHERE source_id = ?';
      params.push(memoryId);
    } else if (direction === 'incoming') {
      query = 'SELECT * FROM memory_relation WHERE target_id = ?';
      params.push(memoryId);
    } else {
      query = `
        SELECT * FROM memory_relation
        WHERE (source_id = ? OR target_id = ?)
      `;
      params.push(memoryId, memoryId);
    }

    if (relationTypes && relationTypes.length > 0) {
      const placeholders = relationTypes.map(() => '?').join(',');
      query += ` AND relation_type IN (${placeholders})`;
      params.push(...relationTypes);
    }

    if (minConfidence !== undefined) {
      query += ' AND confidence >= ?';
      params.push(minConfidence);
    }

    query += ' ORDER BY confidence DESC, created_at DESC';

    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);

      if (offset > 0) {
        query += ' OFFSET ?';
        params.push(offset);
      }
    }

    const rows = DatabaseUtils.all(this.db, query, params);
    const validRows = filterRelationRowsWithWarning(rows);
    const relations = validRows.map(mapRelationRowToMemoryRelation);

    if (!bypassCache) {
      const cacheKey = this.cache.generateCacheKey(memoryId, options);
      this.cache.set(cacheKey, memoryId, relations);
    }

    return relations;
  }

  /**
   * 여러 메모리에 대한 관계 일괄 조회 (N+1 완화, 캐시 미사용)
   */
  async getRelationsBatch(
    memoryIds: string[],
    options?: GetRelationsOptions
  ): Promise<Map<string, MemoryRelation[]>> {
    const result = new Map<string, MemoryRelation[]>();
    if (memoryIds.length === 0) return result;
    memoryIds.forEach(id => result.set(id, []));

    const direction = options?.direction ?? 'both';
    const relationTypes = options?.relationTypes;
    const minConfidence = options?.minConfidence;
    const idSet = new Set(memoryIds);
    const placeholders = memoryIds.map(() => '?').join(',');

    let query = '';
    const params: Array<string | number | RelationType> = [];

    if (direction === 'outgoing') {
      query = `SELECT * FROM memory_relation WHERE source_id IN (${placeholders})`;
      params.push(...memoryIds);
    } else if (direction === 'incoming') {
      query = `SELECT * FROM memory_relation WHERE target_id IN (${placeholders})`;
      params.push(...memoryIds);
    } else {
      query = `SELECT * FROM memory_relation WHERE (source_id IN (${placeholders}) OR target_id IN (${placeholders}))`;
      params.push(...memoryIds, ...memoryIds);
    }

    if (relationTypes && relationTypes.length > 0) {
      const typePlaceholders = relationTypes.map(() => '?').join(',');
      const typeInClause = ' AND relation_type IN (' + typePlaceholders + ')';
      query += typeInClause;
      params.push(...relationTypes);
    }
    if (minConfidence !== undefined) {
      query += ' AND confidence >= ?';
      params.push(minConfidence);
    }
    query += ' ORDER BY confidence DESC, created_at DESC';

    const rows = DatabaseUtils.all(this.db, query, params);
    const validRows = filterRelationRows(rows);

    for (const row of validRows) {
      const relation = mapRelationRowToMemoryRelation(row);
      if (direction !== 'incoming' && idSet.has(row.source_id)) {
        result.get(row.source_id)!.push(relation);
      }
      if (direction !== 'outgoing' && idSet.has(row.target_id)) {
        result.get(row.target_id)!.push(relation);
      }
    }

    return result;
  }
}
