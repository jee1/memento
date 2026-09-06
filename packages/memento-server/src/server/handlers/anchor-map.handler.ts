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

type HopSearchItem = {
  id: string;
  content: string;
  type: string;
  similarity?: number;
  hop_distance?: number;
  importance?: number;
  created_at?: string;
  [key: string]: unknown;
};

type HopPathEdge = { source: string; target: string; hop_distance: number; similarity?: number };

/**
 * 검색 결과 항목이 가리키는 predecessor id 목록을 얻는다.
 * n-hop 검색이 여러 경로로 같은 메모리를 재발견하면 predecessor_ids(복수)에 모두 기록되므로
 * (#715 MEDIUM#1), 있으면 그것을 우선하고 없으면 predecessor_id(단수)로 대체한다.
 */
function getPredecessorIds(item: HopSearchItem): string[] {
  const ids = item.predecessor_ids;
  if (Array.isArray(ids)) {
    return ids.filter((id): id is string => typeof id === 'string');
  }
  return typeof item.predecessor_id === 'string' ? [item.predecessor_id] : [];
}

/**
 * hop 오름차순으로 경로 폐쇄성(path-closure)을 검증하며 노드/엣지를 확정한다.
 * predecessor가 랭킹/limit/쿼리 필터로 탈락해 경로가 끊긴 hop≥2 노드는
 * 부유(floating) 상태로 지도에 남기지 않고 제외한다 (#715 MEDIUM#2).
 */
function resolvePathClosedItems(
  items: HopSearchItem[],
  anchorMemoryId: string
): { reachableItems: HopSearchItem[]; edges: HopPathEdge[] } {
  const itemsByHop = new Map<number, HopSearchItem[]>();
  for (const item of items) {
    const hop = typeof item.hop_distance === 'number' ? item.hop_distance : 0;
    const bucket = itemsByHop.get(hop) ?? [];
    bucket.push(item);
    itemsByHop.set(hop, bucket);
  }

  const reachableIds = new Set<string>([anchorMemoryId]);
  const reachableItems: HopSearchItem[] = [];
  const edges: HopPathEdge[] = [];

  const hopsAscending = Array.from(itemsByHop.keys())
    .filter(hop => hop >= 1)
    .sort((a, b) => a - b);

  for (const hop of hopsAscending) {
    for (const item of itemsByHop.get(hop) ?? []) {
      if (hop === 1) {
        reachableIds.add(item.id);
        reachableItems.push(item);
        edges.push({ source: anchorMemoryId, target: item.id, hop_distance: 1, similarity: item.similarity });
        continue;
      }

      const validPredecessorIds = getPredecessorIds(item).filter(id => reachableIds.has(id));
      if (validPredecessorIds.length === 0) {
        continue; // 경로가 끊긴 노드는 지도에 포함하지 않음
      }
      reachableIds.add(item.id);
      reachableItems.push(item);
      for (const predecessorId of validPredecessorIds) {
        edges.push({ source: predecessorId, target: item.id, hop_distance: hop, similarity: item.similarity });
      }
    }
  }

  return { reachableItems, edges };
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

        const anchorNode = nodes.find(n => n.id === anchor.memory_id);
        if (anchorNode && searchResult.anchor_info?.embedding_missing) {
          anchorNode.embedding_missing = true;
        }

        // hop 오름차순으로 경로 폐쇄성을 검증해, predecessor가 랭킹/limit/쿼리 필터로
        // 탈락한 hop≥2 노드는 부유(floating) 상태로 남기지 않고 제외한다 (#715 MEDIUM#2).
        // 노드 dedup과 별개로, 하나의 메모리로 여러 경로가 합류하면 edge는 모두 보존한다 (#715 MEDIUM#1).
        const { reachableItems, edges } = resolvePathClosedItems(searchResult.items, anchor.memory_id);

        for (const item of reachableItems) {
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
        }

        for (const edge of edges) {
          links.push({
            source: edge.source,
            target: edge.target,
            type: 'hop',
            hop_distance: edge.hop_distance,
            similarity: edge.similarity
          });
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
          throw error;
        }
      }
    }
  }

  // memory_relation 테이블(RelationGraph)을 활용한 직접 연결 정보 추가
  const relationLinks = await buildRelationLinks(relationGraph, nodeIds);
  links.push(...relationLinks);

  return { nodes, links: dedupeUndirectedLinks(links) };
}

/**
 * 같은 무방향 쌍(A-B)에 링크를 하나만 남긴다 (#869).
 *
 * hop 엣지가 먼저 쌓이므로 first-wins는 곧 hop 우선이며, 이 한 번의 dedup이
 * relation 역방향 row(A→B / B→A), hop∩link 중복, 완전 동일 triple을 모두 걷어낸다.
 * d3 forceLink는 링크마다 스프링을 걸기 때문에 중복은 잡음일 뿐 아니라 레이아웃을 왜곡한다.
 *
 * 서로 다른 쌍은 그대로 보존되므로 슬롯별 엣지(#709)와 합류 경로 엣지(#715 MEDIUM#1)는 영향받지 않는다.
 */
function dedupeUndirectedLinks(links: AnchorMapLink[]): AnchorMapLink[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = link.source < link.target
      ? `${link.source}|${link.target}`
      : `${link.target}|${link.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
/**
 * RelationGraph(memory_relation)를 활용한 네트워크 링크 생성.
 * 노드로 등록된 메모리끼리의 관계만 엣지로 반영하며, confidence를 가중치로 사용한다.
 * hop 2/3의 anchor→memory 경로 엣지는 buildNetworkNodesAndLinks에서
 * n-hop 검색 결과의 predecessor_id로 생성하므로(#715) 이 함수는 다루지 않는다.
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
    throw error;
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
