/**
 * 관계 그래프 순환 참조 감지 (DFS)
 */

import Database from 'better-sqlite3';
import { LIMITS } from '../../../shared/constants/relation-constants.js';
import type { RelationType } from '../../../shared/types/relation.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { logger } from '../../../shared/utils/logger.js';

export class RelationGraphCycleDetector {
  constructor(private db: Database.Database) {}

  /**
   * 순환 참조 감지 내부 로직 (트랜잭션 없이 실행)
   */
  async detectCycleInternal(
    sourceId: string,
    targetId: string,
    relationType: RelationType,
    maxDepth: number = LIMITS.MAX_CYCLE_DEPTH
  ): Promise<boolean> {
    if (sourceId === targetId) {
      return false;
    }

    const visited = new Set<string>();
    const nodeRelations = new Map<string, string[]>();
    /**
     * 깊이 한계에 걸린 노드는 visited 에 넣을 수 없다. 같은 노드를 다른 경로에서 더 얕은 깊이로
     * 다시 만날 수 있고, 그때는 탐색을 계속해야 하기 때문이다. 그래서 이 노드는 들어오는 간선
     * 수만큼 재진입한다. 여기서 노드마다 로그를 찍으면 호출 한 번이 로그 수만 줄을 만든다 (#913).
     * 횟수만 세고 탐색이 끝난 뒤 한 줄로 남긴다.
     */
    let depthLimitHits = 0;

    const dfs = async (currentId: string, target: string, depth: number): Promise<boolean> => {
      if (depth > maxDepth) {
        depthLimitHits++;
        return false;
      }

      if (currentId === target) {
        return true;
      }

      if (visited.has(currentId)) {
        return false;
      }

      visited.add(currentId);

      let targetIds: string[] = [];
      if (nodeRelations.has(currentId)) {
        targetIds = nodeRelations.get(currentId)!;
      } else {
        const rows = DatabaseUtils.all(this.db, `
          SELECT target_id
          FROM memory_relation
          WHERE source_id = ? AND relation_type = ?
        `, [currentId, relationType]);

        for (const row of rows) {
          if (typeof row === 'object' && row !== null && 'target_id' in row) {
            const targetIdValue = (row as { target_id: unknown }).target_id;
            if (typeof targetIdValue === 'string') {
              targetIds.push(targetIdValue);
            }
          }
        }

        nodeRelations.set(currentId, targetIds);
      }

      for (const nextId of targetIds) {
        if (await dfs(nextId, target, depth + 1)) {
          return true;
        }
      }

      return false;
    };

    const found = await dfs(targetId, sourceId, 0);

    // 깊이 한계에 걸렸다는 것은 탐색이 끝까지 가지 못했다는 뜻이다. found=false 여도 순환이
    // 없다고 단정할 수 없으므로(false negative 가능) 호출당 한 번은 남긴다.
    if (depthLimitHits > 0) {
      logger.warn('순환 탐지가 최대 깊이에서 중단됨 (탐색 불완전)', {
        sourceId,
        targetId,
        relationType,
        maxDepth,
        depthLimitHits,
        visitedCount: visited.size,
        cycleFound: found
      });
    }

    return found;
  }

  /**
   * 순환 참조 감지 (공개 메서드, 트랜잭션 자동 관리)
   */
  async detectCycle(
    sourceId: string,
    targetId: string,
    relationType: RelationType,
    maxDepth: number = LIMITS.MAX_CYCLE_DEPTH
  ): Promise<boolean> {
    if (DatabaseUtils.isInTransaction(this.db)) {
      return await this.detectCycleInternal(sourceId, targetId, relationType, maxDepth);
    }

    return await DatabaseUtils.runTransaction(this.db, async () => {
      return await this.detectCycleInternal(sourceId, targetId, relationType, maxDepth);
    });
  }
}
