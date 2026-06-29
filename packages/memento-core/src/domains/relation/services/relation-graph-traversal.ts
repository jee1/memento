/**
 * 관계 그래프 N-hop 탐색 (BFS)
 */

import Database from 'better-sqlite3';
import type { GetRelatedMemoriesOptions, MemoryRelation } from '../../../shared/types/relation-graph.js';
import type { RelationType } from '../../../shared/types/relation.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import {
  filterRelationRows,
  mapRelationRowToMemoryRelation
} from './relation-graph-row-utils.js';

export type RelatedMemoryResult = {
  memory_id: string;
  hop_distance: number;
  relation_path: Array<{
    source_id: string;
    target_id: string;
    relation_type: RelationType;
  }>;
};

export class RelationGraphTraversal {
  constructor(private db: Database.Database) {}

  /**
   * 관련 기억 조회 (N-hop 관계 탐색, BFS)
   */
  async getRelatedMemories(
    memoryId: string,
    options?: GetRelatedMemoriesOptions
  ): Promise<RelatedMemoryResult[]> {
    const maxHops = options?.maxHops ?? 2;
    const relationTypes = options?.relationTypes;
    const minConfidence = options?.minConfidence;
    const limit = options?.limit;
    const includeCyclic = options?.includeCyclic ?? false;

    const visited = new Set<string>();
    const queue: RelatedMemoryResult[] = [];
    const results: RelatedMemoryResult[] = [];
    const nodeRelationsCache = new Map<string, MemoryRelation[]>();

    queue.push({
      memory_id: memoryId,
      hop_distance: 0,
      relation_path: []
    });
    visited.add(memoryId);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.hop_distance > 0) {
        results.push(current);

        if (limit && results.length >= limit) {
          break;
        }
      }

      if (current.hop_distance >= maxHops) {
        continue;
      }

      const currentLevelNodes = queue.filter(n => n.hop_distance === current.hop_distance);
      const nodesToQuery = [current.memory_id, ...currentLevelNodes.map(n => n.memory_id)]
        .filter(id => !nodeRelationsCache.has(id));

      if (nodesToQuery.length > 0) {
        const placeholders = nodesToQuery.map(() => '?').join(',');
        let batchQuery =
          `SELECT * FROM memory_relation WHERE (source_id IN (${placeholders}) OR target_id IN (${placeholders}))`;
        const params: Array<string | number | RelationType> = [
          ...nodesToQuery,
          ...nodesToQuery
        ];

        if (relationTypes && relationTypes.length > 0) {
          const typePlaceholders = relationTypes.map(() => '?').join(',');
          batchQuery += ` AND relation_type IN (${typePlaceholders})`;
          params.push(...relationTypes);
        }

        if (minConfidence !== undefined) {
          batchQuery += ' AND confidence >= ?';
          params.push(minConfidence);
        }

        batchQuery += ' ORDER BY confidence DESC';

        const batchRows = DatabaseUtils.all(this.db, batchQuery, params);
        const validRows = filterRelationRows(batchRows);

        for (const nodeId of nodesToQuery) {
          const nodeRelations: MemoryRelation[] = validRows
            .filter(row => row.source_id === nodeId || row.target_id === nodeId)
            .map(mapRelationRowToMemoryRelation);
          nodeRelationsCache.set(nodeId, nodeRelations);
        }
      }

      const relations = nodeRelationsCache.get(current.memory_id) || [];

      for (const relation of relations) {
        const nextId = relation.source_id === current.memory_id
          ? relation.target_id
          : relation.source_id;

        if (!includeCyclic && relation.metadata?.cyclic) {
          continue;
        }

        if (!visited.has(nextId)) {
          visited.add(nextId);

          const nextPath = [...current.relation_path];
          if (relation.source_id === current.memory_id) {
            nextPath.push({
              source_id: relation.source_id,
              target_id: relation.target_id,
              relation_type: relation.relation_type
            });
          } else {
            nextPath.push({
              source_id: relation.target_id,
              target_id: relation.source_id,
              relation_type: relation.relation_type
            });
          }

          queue.push({
            memory_id: nextId,
            hop_distance: current.hop_distance + 1,
            relation_path: nextPath
          });
        }
      }
    }

    return results;
  }
}
