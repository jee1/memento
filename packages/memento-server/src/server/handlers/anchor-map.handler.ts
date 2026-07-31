/**
 * Anchor Map 핸들러
 * Anchor Map 데이터 생성 및 브로드캐스트 로직
 * Phase 1.2: http-server.ts 리팩토링
 */

import type Database from 'better-sqlite3';
import type { ServerServices } from '../bootstrap.js';
import type { WebSocket } from 'ws';
import { logger } from '@memento/core';

/**
 * Anchor Map 노드 타입
 */
export interface AnchorMapNode {
  id: string;
  type: 'anchor' | 'memory';
  slot?: string;
  content: string;
  hop_distance?: number;
  similarity?: number;
  importance?: number;
  created_at?: string;
  embedding_missing?: boolean;
}

/**
 * Anchor Map 링크 타입
 */
export interface AnchorMapLink {
  source: string;
  target: string;
  type: 'anchor' | 'hop' | 'link';
  hop_distance?: number;
  similarity?: number;
}

/**
 * Agent ID별 앵커 개수 항목
 */
export interface AnchorAgentIdEntry {
  agent_id: string;
  anchor_count: number;
}

/**
 * memory_id가 설정된 앵커를 agent_id별로 집계
 */
export function listAnchorAgentIds(db: Database.Database): AnchorAgentIdEntry[] {
  const rows = db.prepare(`
    SELECT agent_id, COUNT(*) AS anchor_count
    FROM anchor
    WHERE memory_id IS NOT NULL
    GROUP BY agent_id
    ORDER BY agent_id ASC
  `).all() as Array<{ agent_id: string; anchor_count: number }>;

  return rows.map(row => ({
    agent_id: row.agent_id,
    anchor_count: Number(row.anchor_count),
  }));
}

/**
 * Anchor Map 데이터 타입
 */
export interface AnchorMapData {
  agent_id: string;
  anchors: Array<{
    agent_id: string;
    slot: string;
    memory_id: string | null;
    created_at: string;
    updated_at: string;
  }>;
  nodes: AnchorMapNode[];
  links: AnchorMapLink[];
  timestamp: string;
}

/**
 * Anchor Map 데이터 생성
 */
export async function buildAnchorMapData(
  db: Database.Database,
  serverServices: ServerServices,
  agentId: string
): Promise<AnchorMapData> {
  const anchorManager = serverServices.anchorManager;
  if (!anchorManager) {
    throw new Error('AnchorManager not available');
  }

  // 앵커 정보 조회
  const anchors = await anchorManager.getAnchor(agentId);
  if (!anchors || (Array.isArray(anchors) && anchors.length === 0)) {
    return {
      agent_id: agentId,
      anchors: [],
      nodes: [],
      links: [],
      timestamp: new Date().toISOString()
    };
  }

  const anchorList = Array.isArray(anchors) ? anchors : [anchors];

  // 네트워크 노드 및 링크 생성
  const { nodes, links } = await buildNetworkNodesAndLinks(
    db,
    anchorManager,
    agentId,
    anchorList,
    serverServices.relationGraph
  );

  return {
    agent_id: agentId,
    anchors: anchorList,
    nodes,
    links,
    timestamp: new Date().toISOString()
  };
}

/**
 * 네트워크 노드 및 링크 생성
 */
async function buildNetworkNodesAndLinks(
  db: Database.Database,
  anchorManager: ServerServices['anchorManager'],
  agentId: string,
  anchorList: Array<{
    agent_id: string;
    slot: string;
    memory_id: string | null;
    created_at: string;
    updated_at: string;
  }>,
  relationGraph: ServerServices['relationGraph']
): Promise<{ nodes: AnchorMapNode[]; links: AnchorMapLink[] }> {
  const nodes: AnchorMapNode[] = [];
  const links: AnchorMapLink[] = [];
  // 노드 dedup(메모리 id당 1개)과 별개로, slot→memory 엣지는 슬롯마다 생성한다
  // (같은 메모리가 slot A/B에 모두 잡히면 노드는 1개, 엣지는 2개)
  const nodeIds = new Set<string>();

  // 각 앵커에 대해 처리
  for (const anchor of anchorList) {
    if (!anchor.memory_id) continue;

    // 앵커 노드 추가
    const anchorMemory = db.prepare(`
      SELECT id, content, type, importance, created_at
      FROM memory_item
      WHERE id = ?
    `).get(anchor.memory_id) as {
      id: string;
      content: string;
      type: string;
      importance: number;
      created_at: string;
    } | undefined;

    if (anchorMemory) {
      if (!nodeIds.has(anchor.memory_id)) {
        nodes.push({
          id: anchor.memory_id,
          type: 'anchor',
          slot: anchor.slot,
          content: anchorMemory.content.substring(0, 100),
          importance: anchorMemory.importance,
          created_at: anchorMemory.created_at
        });
        nodeIds.add(anchor.memory_id);
      }

      // 앵커 주변 메모리 검색
      try {
        const slotConfig = anchorManager.getSlotConfig(anchor.slot as 'A' | 'B' | 'C');
        const searchResult = await anchorManager.searchLocal(
          agentId,
          anchor.slot as 'A' | 'B' | 'C',
          undefined,
          slotConfig.hop_limit,
          { limit: 50 }
        );

        // 검색 결과를 노드와 링크로 변환
        for (const item of searchResult.items) {
          if (!nodeIds.has(item.id)) {
            nodes.push({
              id: item.id,
              type: 'memory',
              content: item.content.substring(0, 100),
              hop_distance: item.hop_distance || 0,
              similarity: item.similarity,
              importance: item.importance,
              created_at: item.created_at
            });
            nodeIds.add(item.id);
          }

          // 링크 추가 (앵커에서 메모리로) - 슬롯마다 별도 엣지로 추가
          if (item.hop_distance === 1) {
            links.push({
              source: anchor.memory_id,
              target: item.id,
              type: 'hop',
              hop_distance: 1,
              similarity: item.similarity
            });
          }
        }
      } catch (error) {
        const isEmbeddingMissing = error instanceof Error && error.name === 'EmbeddingNotFoundError';
        if (isEmbeddingMissing) {
          logger.debug('Anchor search skipped: embedding not found', {
            slot: anchor.slot,
            anchorMemoryId: anchor.memory_id
          });
          const anchorNode = nodes.find(n => n.id === anchor.memory_id);
          if (anchorNode) anchorNode.embedding_missing = true;
        } else {
          logger.error('Anchor search failed', {
            slot: anchor.slot,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
  }

  // memory_relation 테이블(RelationGraph)을 활용한 직접 연결 정보 추가
  const relationLinks = await buildRelationLinks(relationGraph, nodeIds);
  links.push(...relationLinks);

  return { nodes, links };
}

/**
 * RelationGraph(memory_relation)를 활용한 네트워크 링크 생성.
 * 노드로 등록된 메모리끼리의 관계만 엣지로 반영하며, confidence를 가중치로 사용한다.
 * hop 2/3 경로 엣지는 범위 밖(#715)이므로 다루지 않는다.
 */
async function buildRelationLinks(
  relationGraph: ServerServices['relationGraph'],
  nodeIds: Set<string>
): Promise<AnchorMapLink[]> {
  const links: AnchorMapLink[] = [];
  if (nodeIds.size === 0) return links;

  const memoryIds = Array.from(nodeIds);

  try {
    const relationsByMemory = await relationGraph.getRelationsBatch(memoryIds, { direction: 'both' });

    const seenRelationIds = new Set<number>();
    for (const memoryId of memoryIds) {
      for (const relation of relationsByMemory.get(memoryId) ?? []) {
        if (seenRelationIds.has(relation.id)) continue;
        const otherId = relation.source_id === memoryId ? relation.target_id : relation.source_id;
        if (otherId === memoryId || !nodeIds.has(otherId)) continue;

        seenRelationIds.add(relation.id);
        links.push({
          source: relation.source_id,
          target: relation.target_id,
          type: 'link',
          similarity: relation.confidence
        });
      }
    }
  } catch (error) {
    logger.error('Relation link lookup failed', {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  return links;
}

/**
 * WebSocket 구독자에게 브로드캐스트
 */
export function broadcastToSubscribers(
  subscribers: Set<WebSocket>,
  updateData: AnchorMapData
): void {
  for (const ws of subscribers) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      try {
        ws.send(JSON.stringify({
          type: 'anchor_map_update',
          data: updateData
        }));
      } catch (error) {
        logger.error('WebSocket broadcast failed', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
}

/**
 * Anchor Map 업데이트 브로드캐스트
 */
export async function broadcastAnchorMapUpdate(
  db: Database.Database | null,
  serverServices: ServerServices | null,
  anchorMapSubscribers: Map<string, Set<WebSocket>>,
  agentId: string
): Promise<void> {
  if (!anchorMapSubscribers.has(agentId) || anchorMapSubscribers.get(agentId)!.size === 0) {
    return; // 구독자가 없으면 브로드캐스트하지 않음
  }

  try {
    if (!db || !serverServices || !serverServices.anchorManager) {
      return;
    }

    // Anchor Map 데이터 생성
    const updateData = await buildAnchorMapData(db, serverServices, agentId);

    // 구독자에게 브로드캐스트
    const subscribers = anchorMapSubscribers.get(agentId)!;
    broadcastToSubscribers(subscribers, updateData);

    logger.info('Anchor Map update broadcasted', {
      agentId,
      subscriberCount: subscribers.size
    });
  } catch (error) {
    logger.error('Anchor Map broadcast failed', {
      agentId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

