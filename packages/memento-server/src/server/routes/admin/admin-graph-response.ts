/**
 * 관리자 그래프 뷰용 노드/엣지 조회 (009-memory-graph-view)
 */

import type Database from 'better-sqlite3';

export interface GraphNode {
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

export interface GraphEdge {
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
}

export interface GraphResponse {
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

interface MemoryItemRow {
  id: string;
  content: string;
  type: string;
  importance: number | null;
  created_at: string | null;
  tags: string | null;
  pinned: number | null;
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

  let nodeQuery = `SELECT id, content, type, importance, created_at, tags, pinned FROM memory_item WHERE 1=1`;
  let countQuery = `SELECT COUNT(*) AS count FROM memory_item WHERE 1=1`;
  const nodeParams: (string | number)[] = [];
  const countParams: (string | number)[] = [];

  if (filters.types && filters.types.length > 0) {
    const placeholders = filters.types.map(() => '?').join(', ');
    nodeQuery += ` AND type IN (${placeholders})`;
    countQuery += ` AND type IN (${placeholders})`;
    nodeParams.push(...filters.types);
    countParams.push(...filters.types);
  }

  nodeQuery += ` AND COALESCE(importance, 0.5) >= ?`;
  countQuery += ` AND COALESCE(importance, 0.5) >= ?`;
  nodeParams.push(minImportance);
  countParams.push(minImportance);

  nodeQuery += ` ORDER BY COALESCE(importance, 0.5) DESC LIMIT ?`;
  nodeParams.push(limit + 1);

  const countRow = db.prepare(countQuery).get(...countParams) as { count: number } | undefined;
  const totalAvailableNodes = countRow?.count ?? 0;
  const rawNodes = db.prepare(nodeQuery).all(...nodeParams) as MemoryItemRow[];
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
      },
      truncated,
      graph_view: graphView,
      fields,
      default_limit: defaultLimit,
      max_limit: maxLimit,
    },
  };
}
