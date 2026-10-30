/**
 * 관리자 그래프 뷰용 노드/엣지 조회 (009-memory-graph-view)
 */

import type Database from 'better-sqlite3';
import { queryMemoryGraphNodes } from '@memento/core';

interface GraphNode {
  id: string;
  label: string;
  content: string;
  content_truncated?: boolean;
  type: 'episodic' | 'semantic' | 'procedural' | 'working';
  importance: number;
  created_at: string;
  tags: string[];
  pinned: boolean;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation_type: string;
  confidence: number;
  edge_source: 'memory_relation';
}

export interface GraphFilter {
  types?: string[] | null;
  relation_types?: string[] | null;
  min_importance?: number;
  limit?: number;
  view?: 'focused' | 'full';
  fields?: 'full' | 'minimal';
  exclude_orphans?: boolean;
}

interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: {
    total_nodes: number;
    total_available_nodes: number;
    total_edges: number;
    applied_filters: GraphFilter;
    truncated: boolean;
    graph_view: 'focused' | 'full';
    fields: 'full' | 'minimal';
    default_limit: number;
    max_limit: number;
  };
}

interface MemoryRelationRow {
  id: number;
  source_id: string;
  target_id: string;
  relation_type: string;
  confidence: number | null;
}

/**
 * DB에서 그래프 데이터를 조회하여 GraphResponse를 구성한다.
 * FR-001~FR-003, FR-010~FR-012
 */
export function buildGraphResponse(db: Database.Database, filters: GraphFilter): GraphResponse {
  const graphView = filters.view ?? 'focused';
  const fields = filters.fields ?? (graphView === 'full' ? 'minimal' : 'full');
  const defaultLimit = graphView === 'full' ? 5000 : 200;
  const maxLimit = graphView === 'full' ? 5000 : 1000;
  const limit = Math.min(filters.limit ?? defaultLimit, maxLimit); // FR-006: 기본 200
  const minImportance = filters.min_importance ?? 0.0;

  // 응답 엣지에서 degree=0 인 View orphan(Phase 1, static/js/graph-fetch.js)과는 다르다.
  // relation_types 가 걸려 있으면 그 타입만 관계로 인정한다 - 아니면 "연결됨"으로
  // 뽑혀 놓고 엣지가 0개인 노드가 생긴다.
  const excludeOrphans = filters.exclude_orphans === true;
  const { totalAvailableNodes, rawNodes } = queryMemoryGraphNodes(db, {
    types: filters.types,
    relation_types: filters.relation_types,
    min_importance: minImportance,
    exclude_orphans: excludeOrphans,
    limit,
  });
  const truncated = rawNodes.length > limit;
  const nodeRows = truncated ? rawNodes.slice(0, limit) : rawNodes;

  const nodeSet = new Set(nodeRows.map(r => r.id));

  const nodes: GraphNode[] = nodeRows.map(r => ({
    id: r.id,
    label: r.content.length > 50 ? r.content.slice(0, 50) + '...' : r.content,
    content: fields === 'minimal' && r.content.length > 280
      ? r.content.slice(0, 280) + '...'
      : r.content,
    content_truncated: fields === 'minimal' && r.content.length > 280,
    type: r.type as GraphNode['type'],
    importance: r.importance ?? 0.5,
    created_at: r.created_at ?? new Date().toISOString(),
    tags: (() => {
      try { return JSON.parse(r.tags ?? '[]'); } catch { return []; }
    })(),
    pinned: r.pinned === 1,
  }));

  let edges: GraphEdge[] = [];
  if (nodeSet.size > 0) {
    const nodeIdsJson = JSON.stringify(Array.from(nodeSet));
    let edgeQuery = `
      WITH _nodes(id) AS (SELECT value FROM json_each(?))
      SELECT mr.id, mr.source_id, mr.target_id, mr.relation_type, mr.confidence
      FROM memory_relation mr
      WHERE mr.source_id IN (SELECT id FROM _nodes)
        AND mr.target_id IN (SELECT id FROM _nodes)
    `;
    const edgeParams: (string | number)[] = [nodeIdsJson];

    if (filters.relation_types && filters.relation_types.length > 0) {
      const rtPlaceholders = filters.relation_types.map(() => '?').join(', ');
      edgeQuery += ` AND mr.relation_type IN (${rtPlaceholders})`;
      edgeParams.push(...filters.relation_types);
    }

    const rawEdges = db.prepare(edgeQuery).all(...edgeParams) as MemoryRelationRow[];
    edges = rawEdges.map(r => ({
      id: `rel_${r.id}`,
      source: r.source_id,
      target: r.target_id,
      relation_type: r.relation_type,
      confidence: r.confidence ?? 1.0,
      edge_source: 'memory_relation' as const,
    }));
  }

  return {
    nodes,
    edges,
    meta: {
      total_nodes: nodes.length,
      total_available_nodes: totalAvailableNodes,
      total_edges: edges.length,
      applied_filters: {
        types: filters.types ?? null,
        relation_types: filters.relation_types ?? null,
        min_importance: minImportance,
        limit,
        view: graphView,
        fields,
        exclude_orphans: excludeOrphans,
      },
      truncated,
      graph_view: graphView,
      fields,
      default_limit: defaultLimit,
      max_limit: maxLimit,
    },
  };
}
