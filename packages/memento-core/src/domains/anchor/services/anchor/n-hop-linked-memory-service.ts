/**
 * N-hop linked-memory discovery helpers.
 */

import type Database from 'better-sqlite3';
import type { VectorSearchResult } from '../../../search/algorithms/vector-search-engine.js';
import type { RelationGraphPort } from '../../../relation/ports/relation-graph.port.js';
import type { IAnchorCacheService } from './anchor-interfaces.js';
import type { NHopSearchResult } from './n-hop-search-service.js';
import type { GetRelationsOptions, MemoryRelation } from '../../../../shared/types/relation-graph.js';
import { logger } from '../../../../shared/utils/logger.js';

/** memory_link / relation graph에서 수집한 1차 연결 메모리 요약 */
export type LinkedMemorySummary = {
  memory_id: string;
  content: string;
  type: string;
  similarity: number;
  importance: number;
  created_at: string;
  tags?: string[];
};

export type HopCandidate = LinkedMemorySummary & { isLinked: boolean };

type HopSeed = { memory_id: string; embedding: number[] };

type RelationGraphReader = Pick<RelationGraphPort, 'getRelations'> & {
  getRelationsBatch(
    memoryIds: string[],
    options?: GetRelationsOptions
  ): Promise<Map<string, MemoryRelation[]>>;
};

export function getRelationTypeBoost(relationType: string): number {
  const boostMap: Record<string, number> = {
    CAUSES: 1.2,
    DEPENDS_ON: 1.1,
    FOLLOWS: 1.0,
    CONTRASTS_WITH: 0.9,
    REFERENCES: 0.8,
    BELONGS_TO: 1.0
  };
  return boostMap[relationType] || 1.0;
}

export class NHopLinkedMemoryService {
  constructor(
    private readonly cacheService: IAnchorCacheService,
    private readonly getDb: () => Database.Database | null,
    private readonly getRelationGraph: () => RelationGraphReader | null
  ) {}

  mergeHopCandidates(
    linkedMemories: LinkedMemorySummary[],
    vectorSearchResults: VectorSearchResult[],
    discoveredMemoryIds: Set<string>,
    threshold: number
  ): Map<string, HopCandidate> {
    const allCandidates = new Map<string, HopCandidate>();
    const relaxedThreshold = threshold * 0.5;

    for (const linked of linkedMemories) {
      if (!discoveredMemoryIds.has(linked.memory_id)) {
        allCandidates.set(linked.memory_id, {
          ...linked,
          isLinked: true
        });
      }
    }

    for (const result of vectorSearchResults) {
      if (!allCandidates.has(result.memory_id) && !discoveredMemoryIds.has(result.memory_id)) {
        if (result.similarity >= relaxedThreshold) {
          allCandidates.set(result.memory_id, {
            memory_id: result.memory_id,
            content: result.content,
            type: result.type,
            similarity: result.similarity,
            importance: result.importance,
            created_at: result.created_at,
            tags: result.tags,
            isLinked: false
          });
        }
      } else if (allCandidates.has(result.memory_id)) {
        const existing = allCandidates.get(result.memory_id)!;
        existing.similarity = Math.max(existing.similarity, result.similarity);
      }
    }

    return allCandidates;
  }

  async materializeHopDiscoveries(
    hop: number,
    maxHops: number,
    allCandidates: Map<string, HopCandidate>,
    discoveredMemoryIds: Set<string>,
    threshold: number,
    predecessorId: string
  ): Promise<{
    hopResults: NHopSearchResult[];
    nextHopSeeds: HopSeed[];
  }> {
    const hopResults: NHopSearchResult[] = [];
    const nextHopSeeds: HopSeed[] = [];

    for (const [memoryId, candidate] of allCandidates.entries()) {
      if (discoveredMemoryIds.has(memoryId)) {
        continue;
      }

      const effectiveThreshold = candidate.isLinked ? threshold * 0.8 : threshold;
      if (candidate.similarity < effectiveThreshold) {
        continue;
      }

      discoveredMemoryIds.add(memoryId);
      hopResults.push({
        memory_id: candidate.memory_id,
        content: candidate.content,
        type: candidate.type,
        similarity: candidate.similarity,
        hop_distance: hop,
        importance: candidate.importance,
        created_at: candidate.created_at,
        tags: candidate.tags,
        hasRelation: candidate.isLinked,
        predecessor_id: predecessorId
      });

      if (hop < maxHops) {
        const seed = await this.tryGetNextHopSeed(candidate.memory_id);
        if (seed) {
          nextHopSeeds.push(seed);
        }
      }
    }

    return { hopResults, nextHopSeeds };
  }

  async getLinkedMemoriesBatch(memoryIds: string[]): Promise<Map<string, LinkedMemorySummary[]>> {
    const result = new Map<string, LinkedMemorySummary[]>();
    memoryIds.forEach(id => result.set(id, []));
    const db = this.getDb();
    if (memoryIds.length === 0 || !db) return result;

    const relationGraph = this.getRelationGraph();
    if (relationGraph) {
      const relationsByMemory = await relationGraph.getRelationsBatch(memoryIds, {
        direction: 'outgoing',
        minConfidence: 0.5
      });
      const allTargetIds = new Set<string>();
      relationsByMemory.forEach((rels) => {
        rels.forEach((r) => allTargetIds.add(r.target_id));
      });
      if (allTargetIds.size === 0) return result;
      const placeholders = Array.from(allTargetIds).map(() => '?').join(',');
      const memoryRecords = db.prepare(
        `SELECT id, content, type, importance, created_at, tags FROM memory_item WHERE id IN (${placeholders})`
      ).all(...Array.from(allTargetIds)) as Array<{ id: string; content: string; type: string; importance: number; created_at: string; tags?: string }>;
      const memoryMap = new Map(memoryRecords.map(m => [m.id, m]));

      relationsByMemory.forEach((rels, sourceId) => {
        const items = rels.map((relation) => {
          const memory = memoryMap.get(relation.target_id);
          if (!memory) return null;
          const typeBoost = getRelationTypeBoost(relation.relation_type);
          const similarity = Math.min(1.0, relation.confidence * typeBoost);
          return {
            memory_id: memory.id,
            content: memory.content,
            type: memory.type,
            similarity,
            importance: memory.importance,
            created_at: memory.created_at,
            tags: memory.tags ? (typeof memory.tags === 'string' ? JSON.parse(memory.tags) : memory.tags) : undefined
          };
        }).filter((item): item is NonNullable<typeof item> => item !== null);
        result.set(sourceId, items);
      });
      return result;
    }

    const batchResults = await Promise.all(memoryIds.map((id) => this.getLinkedMemories(id)));
    memoryIds.forEach((id, i) => result.set(id, batchResults[i] ?? []));
    return result;
  }

  private async tryGetNextHopSeed(memoryId: string): Promise<HopSeed | null> {
    try {
      const nextEmbedding = await this.cacheService.getAnchorEmbedding(memoryId);
      if (nextEmbedding?.embedding) {
        return { memory_id: memoryId, embedding: nextEmbedding.embedding };
      }
    } catch (error) {
      logger.debug('Skipping memory for next hop (no embedding)', {
        memoryId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return null;
  }

  private async getLinkedMemories(memoryId: string): Promise<LinkedMemorySummary[]> {
    const db = this.getDb();
    if (!db) {
      return [];
    }

    try {
      const relationGraph = this.getRelationGraph();
      if (relationGraph) {
        const relations = await relationGraph.getRelations(memoryId, {
          direction: 'outgoing',
          minConfidence: 0.5
        });

        if (relations.length > 0) {
          const memoryIds = relations.map(r => r.target_id);
          const placeholders = memoryIds.map(() => '?').join(',');
          const memoryRecords = db.prepare(
            `SELECT id, content, type, importance, created_at, tags ` +
            `FROM memory_item ` +
            `WHERE id IN (${placeholders})`
          ).all(...memoryIds) as Array<{
            id: string;
            content: string;
            type: string;
            importance: number;
            created_at: string;
            tags?: string;
          }>;

          const memoryMap = new Map(memoryRecords.map(m => [m.id, m]));

          return relations.map(relation => {
            const memory = memoryMap.get(relation.target_id);
            if (!memory) {
              return null;
            }

            const typeBoost = getRelationTypeBoost(relation.relation_type);
            const similarity = Math.min(1.0, relation.confidence * typeBoost);

            return {
              memory_id: memory.id,
              content: memory.content,
              type: memory.type,
              similarity,
              importance: memory.importance,
              created_at: memory.created_at,
              tags: memory.tags ? JSON.parse(memory.tags) : undefined
            };
          }).filter((item): item is NonNullable<typeof item> => item !== null);
        }
      }

      const linkedRecords = db.prepare(`
        SELECT 
          ml.target_id as memory_id,
          mi.content,
          mi.type,
          mi.importance,
          mi.created_at,
          mi.tags,
          ml.relation_type
        FROM memory_link ml
        JOIN memory_item mi ON mi.id = ml.target_id
        WHERE ml.source_id = ?
        ORDER BY ml.created_at DESC
      `).all(memoryId) as Array<{
        memory_id: string;
        content: string;
        type: string;
        importance: number;
        created_at: string;
        tags?: string;
        relation_type: string;
      }>;

      return linkedRecords.map(record => ({
        memory_id: record.memory_id,
        content: record.content,
        type: record.type,
        similarity: 0.9,
        importance: record.importance,
        created_at: record.created_at,
        tags: record.tags ? (typeof record.tags === 'string' ? JSON.parse(record.tags) : record.tags) : undefined
      }));
    } catch (error) {
      logger.error('memory_link retrieval failed', {
        memoryId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }
}
