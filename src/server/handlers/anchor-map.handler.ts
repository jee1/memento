/**
 * Anchor Map 핸들러
 * Anchor Map 데이터 생성 및 브로드캐스트 로직
 * Phase 1.2: http-server.ts 리팩토링
 */

import type Database from 'better-sqlite3';
import type { ServerServices } from '../bootstrap.js';
import type { WebSocket } from 'ws';
import { logger } from '../../shared/utils/logger.js';

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
    anchorList
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
  }>
): Promise<{ nodes: AnchorMapNode[]; links: AnchorMapLink[] }> {
  const nodes: AnchorMapNode[] = [];
  const links: AnchorMapLink[] = [];
  const processedMemoryIds = new Set<string>();

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
      nodes.push({
        id: anchor.memory_id,
        type: 'anchor',
        slot: anchor.slot,
        content: anchorMemory.content.substring(0, 100),
        importance: anchorMemory.importance,
        created_at: anchorMemory.created_at
      });
      processedMemoryIds.add(anchor.memory_id);

      // 앵커 주변 메모리 검색
      try {
        const slotConfig = anchorManager.getSlotConfig(anchor.slot as 'A' | 'B' | 'C');
        const searchResult = await anchorManager.searchLocal(
          agentId,
          anchor.slot as 'A' | 'B' | 'C',
          undefined,
          slotConfig.hop_limit,
          { limit: 50, vector_threshold: 0.3 } // 시각화용: 슬롯 기본값보다 낮은 threshold 사용
        );

        // 검색 결과를 노드와 링크로 변환
        for (const item of searchResult.items) {
          if (processedMemoryIds.has(item.id)) continue;

          nodes.push({
            id: item.id,
            type: 'memory',
            content: item.content.substring(0, 100),
            hop_distance: item.hop_distance || 0,
            similarity: item.similarity,
            importance: item.importance,
            created_at: item.created_at
          });
          processedMemoryIds.add(item.id);

          // 링크 추가 (앵커에서 메모리로)
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
        logger.error('Anchor search failed', {
          slot: anchor.slot,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  // memory_link 테이블을 활용한 직접 연결 정보 추가
  const memoryLinks = buildNetworkLinks(db, nodes, processedMemoryIds);
  links.push(...memoryLinks);

  return { nodes, links };
}

/**
 * memory_link 테이블을 활용한 네트워크 링크 생성
 */
function buildNetworkLinks(
  db: Database.Database,
  nodes: AnchorMapNode[],
  processedMemoryIds: Set<string>
): AnchorMapLink[] {
  const links: AnchorMapLink[] = [];

  for (const node of nodes) {
    if (node.type === 'anchor') continue;

    // memory_link 테이블 조회
    const linkedMemories = db.prepare(`
      SELECT target_id, relation_type, created_at
      FROM memory_link
      WHERE source_id = ?
      UNION
      SELECT source_id, relation_type, created_at
      FROM memory_link
      WHERE target_id = ?
    `).all(node.id, node.id) as Array<{
      target_id?: string;
      source_id?: string;
      relation_type: string;
      created_at: string;
    }>;

    for (const link of linkedMemories) {
      const linkedId = link.target_id || link.source_id;
      if (linkedId && processedMemoryIds.has(linkedId)) {
        // relation_type을 기반으로 similarity 추정
        const similarity = link.relation_type === 'derived_from' ? 0.9 :
                          link.relation_type === 'cause_of' ? 0.8 : 0.7;
        links.push({
          source: node.id,
          target: linkedId,
          type: 'link',
          similarity: similarity
        });
      }
    }
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

