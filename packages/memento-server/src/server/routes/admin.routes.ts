/**
 * Admin 라우터
 * /admin/* 엔드포인트 처리
 * Phase 1.2: http-server.ts 리팩토링
 */

import { Router } from 'express';
import type Database from 'better-sqlite3';
import type { ServerServices } from '../bootstrap.js';
import {
  getBatchScheduler,
  getPerformanceMonitor,
  createRelationGraph,
  RelationExtractor,
  ExtractRelationsTool,
  GetRelationsTool,
  AddRelationTool,
  RemoveRelationTool,
  VisualizeRelationsTool,
  RestoreAnchorsTool,
  MigrateEmbeddingsTool,
  ConvertEpisodicToSemanticTool,
  GetMetaMemoryStatsTool,
  DatabaseUtils,
  logger,
  createToolContext,
  ConsolidationAlreadyRunningError,
  type TelemetryPeriod,
  type EventType
} from '@memento/core';

const TELEMETRY_PERIODS: TelemetryPeriod[] = ['24h', '7d', '30d'];

// ============================================================
// 기억 관계 그래프 타입 (009-memory-graph-view)
// ============================================================

export interface GraphNode {
  id: string;
  label: string;     // content 앞 50자 (그래프 노드 레이블)
  content: string;   // 전체 내용 (상세 패널용)
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
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: {
    total_nodes: number;
    total_edges: number;
    applied_filters: GraphFilter;
    truncated: boolean;
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
function buildGraphResponse(db: Database.Database, filters: GraphFilter): GraphResponse {
  const limit = Math.min(filters.limit ?? 200, 1000); // FR-006: 기본 200
  const minImportance = filters.min_importance ?? 0.0;

  // 노드 쿼리 — 필터 적용
  let nodeQuery = `SELECT id, content, type, importance, created_at, tags, pinned FROM memory_item WHERE 1=1`;
  const nodeParams: (string | number)[] = [];

  if (filters.types && filters.types.length > 0) {
    const placeholders = filters.types.map(() => '?').join(', ');
    nodeQuery += ` AND type IN (${placeholders})`;
    nodeParams.push(...filters.types);
  }

  nodeQuery += ` AND COALESCE(importance, 0.5) >= ?`;
  nodeParams.push(minImportance);

  nodeQuery += ` ORDER BY COALESCE(importance, 0.5) DESC LIMIT ?`;
  nodeParams.push(limit + 1); // 1개 더 조회해서 truncated 판단

  const rawNodes = db.prepare(nodeQuery).all(...nodeParams) as MemoryItemRow[];
  const truncated = rawNodes.length > limit;
  const nodeRows = truncated ? rawNodes.slice(0, limit) : rawNodes;

  const nodeSet = new Set(nodeRows.map(r => r.id));

  const nodes: GraphNode[] = nodeRows.map(r => ({
    id: r.id,
    label: r.content.length > 50 ? r.content.slice(0, 50) + '...' : r.content,
    content: r.content,
    type: (r.type as GraphNode['type']),
    importance: r.importance ?? 0.5,
    created_at: r.created_at ?? new Date().toISOString(),
    tags: (() => {
      try { return JSON.parse(r.tags ?? '[]'); } catch { return []; }
    })(),
    pinned: r.pinned === 1,
  }));

  // 엣지 쿼리 — 노드 집합 내 관계만
  // I-004: json_each CTE로 nodeSet을 단일 파라미터로 전달, SQLite 변수 한계(999) 방어
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
      total_edges: edges.length,
      applied_filters: {
      types: filters.types ?? null,
      relation_types: filters.relation_types ?? null,
      min_importance: minImportance,
      limit,
    },
      truncated,
    },
  };
}

/**
 * FR-013: 쿼리에서 `period`가 **생략**된 경우만 기본 `24h`.
 * 빈 문자열(`?period=`)이나 미지원 값은 그대로 두어 `TELEMETRY_PERIODS` 검사에서 400이 되게 한다.
 * (`periodRaw || '24h'` 패턴은 빈 문자열을 기본값으로 삼아 FR-013을 위반하므로 사용하지 않는다.)
 */
function effectiveTelemetryPeriod(periodRaw: string | undefined): string {
  return periodRaw === undefined ? '24h' : periodRaw;
}

/**
 * Admin 라우터 생성
 */
export function createAdminRouter(
  db: Database.Database | null,
  serverServices: ServerServices | null
): Router {
  const router = Router();

  // 메모리 정리
  router.post('/memory/cleanup', async (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }

      const result = await db.prepare(`
        DELETE FROM memory_item 
        WHERE pinned = FALSE 
          AND type = 'working' 
          AND created_at < datetime('now', '-2 days')
      `).run();

      return res.json({
        message: '메모리 정리 완료',
        deleted_count: result.changes,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Memory cleanup failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '메모리 정리 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // 망각 통계
  router.get('/stats/forgetting', async (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }

      const stats = await db.prepare(`
        SELECT 
          type,
          COUNT(*) as total_count,
          COUNT(CASE WHEN pinned = TRUE THEN 1 END) as pinned_count,
          COUNT(CASE WHEN created_at < datetime('now', '-30 days') THEN 1 END) as old_count
        FROM memory_item 
        GROUP BY type
      `).all();

      return res.json({
        message: '망각 통계 조회 완료',
        stats,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Forgetting stats retrieval failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '망각 통계 조회 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // 성능 통계
  router.get('/stats/performance', async (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }

      const stats = await db.prepare(`
        SELECT 
          COUNT(*) as total_memories,
          COUNT(CASE WHEN type = 'working' THEN 1 END) as working_memories,
          COUNT(CASE WHEN type = 'episodic' THEN 1 END) as episodic_memories,
          COUNT(CASE WHEN type = 'semantic' THEN 1 END) as semantic_memories,
          COUNT(CASE WHEN type = 'procedural' THEN 1 END) as procedural_memories,
          COUNT(CASE WHEN pinned = TRUE THEN 1 END) as pinned_memories
        FROM memory_item
      `).get();

      return res.json({
        message: '성능 통계 조회 완료',
        stats,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Performance stats retrieval failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '성능 통계 조회 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // 데이터베이스 최적화
  router.post('/database/optimize', async (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }

      await db.prepare('VACUUM').run();
      await db.prepare('ANALYZE').run();

      return res.json({
        message: '데이터베이스 최적화 완료',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Database optimization failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '데이터베이스 최적화 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // 에러 통계
  router.get('/stats/errors', async (req, res) => {
    try {
      res.json({
        message: '에러 통계 조회 완료',
        stats: {
          total_errors: 0,
          recent_errors: [],
          error_types: {}
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error stats retrieval failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({
        error: '에러 통계 조회 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // 에러 해결
  router.post('/errors/resolve', async (req, res) => {
    try {
      const { errorId, resolvedBy, reason } = req.body;
      res.json({
        message: '에러 해결 완료',
        errorId,
        resolvedBy,
        reason,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error resolution failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({
        error: '에러 해결 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // 성능 알림
  router.get('/alerts/performance', async (req, res) => {
    try {
      res.json({
        message: '성능 알림 조회 완료',
        alerts: [],
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Performance alerts retrieval failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({
        error: '성능 알림 조회 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // 배치 스케줄러 상태
  router.get('/batch/status', async (req, res) => {
    try {
      const batchScheduler = getBatchScheduler();
      const status = batchScheduler.getStatus();

      res.json({
        message: '배치 스케줄러 상태 조회 완료',
        status,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Batch scheduler status retrieval failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({
        error: '배치 스케줄러 상태 조회 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // 배치 작업 실행
  router.post('/batch/run', async (req, res) => {
    try {
      const { jobType } = req.body;

      if (!jobType || !['cleanup', 'monitoring'].includes(jobType)) {
        return res.status(400).json({
          error: 'Invalid job type. Must be "cleanup" or "monitoring"'
        });
      }

      const batchScheduler = getBatchScheduler();
      const result = await batchScheduler.runJob(jobType);

      return res.json({
        message: `배치 작업 ${jobType} 실행 완료`,
        result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Batch job execution failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '배치 작업 실행 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Sleep consolidation 수동 실행 (005)
  router.post('/consolidation/run', async (req, res) => {
    try {
      const svc = serverServices?.sleepConsolidationService;
      if (!db || !svc) {
        return res.status(500).json({
          success: false,
          error: 'Sleep consolidation not available'
        });
      }

      const dryRun = Boolean(req.body?.dryRun);
      const ownerIdFilter =
        typeof req.body?.ownerIdFilter === 'string' ? req.body.ownerIdFilter : null;

      const result = await svc.run({ dryRun, ownerIdFilter });
      return res.json({ success: true, result });
    } catch (error) {
      if (error instanceof ConsolidationAlreadyRunningError) {
        return res.status(409).json({
          success: false,
          error: 'Consolidation already running'
        });
      }
      logger.error('Sleep consolidation run failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        success: false,
        error: `Consolidation failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  });

  // 성능 지표 수집
  router.get('/performance/metrics', async (req, res) => {
    try {
      const monitor = getPerformanceMonitor();
      const metrics = await monitor.collectMetrics();

      res.json({
        message: '성능 지표 수집 완료',
        metrics,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Performance metrics collection failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({
        error: '성능 지표 수집 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // 성능 알림 조회
  router.get('/performance/alerts', async (req, res) => {
    try {
      const monitor = getPerformanceMonitor();
      const alerts = monitor.getActiveAlerts();

      res.json({
        message: '성능 알림 조회 완료',
        alerts,
        count: alerts.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Performance alerts retrieval failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({
        error: '성능 알림 조회 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // 성능 요약
  router.get('/performance/summary', async (req, res) => {
    try {
      const monitor = getPerformanceMonitor();
      const summary = monitor.getPerformanceSummary();

      res.json({
        message: '성능 요약 조회 완료',
        summary,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Performance summary retrieval failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({
        error: '성능 요약 조회 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // 성능 알림 해결
  router.post('/performance/alerts/:alertId/resolve', async (req, res) => {
    try {
      const { alertId } = req.params;
      const monitor = getPerformanceMonitor();
      const resolved = monitor.resolveAlert(alertId);

      if (resolved) {
        res.json({
          message: '알림 해결 완료',
          alertId,
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(404).json({
          error: '알림을 찾을 수 없습니다',
          alertId
        });
      }
    } catch (error) {
      logger.error('Performance alert resolution failed', {
        alertId: req.params.alertId,
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({
        error: '알림 해결 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // ============================================
  // 관계 엔진 관리 API (관리자용)
  // ============================================

  // 관계 추출 (수동 실행)
  router.post('/relations/extract', async (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }

      const { memory_id, force } = req.body;

      if (!memory_id) {
        return res.status(400).json({
          error: 'memory_id는 필수입니다'
        });
      }

      // ToolContext 생성 (관계 엔진 도구 사용)
      const relationGraph = createRelationGraph(db);
      const context = {
        db,
        services: { relationGraph }
      };

      const extractTool = new ExtractRelationsTool();
      const result = await extractTool.handle({ memory_id, force: force || false }, context);

      const resultText = result.content[0]?.text || '{}';
      const resultData = JSON.parse(resultText);

      if (resultData.success === false) {
        return res.status(400).json(resultData);
      }

      return res.json({
        message: '관계 추출 완료',
        ...resultData,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Relation extraction failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '관계 추출 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // 관계 조회
  router.get('/relations/:memory_id', async (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }

      const { memory_id } = req.params;
      const { relation_type, category, direction } = req.query;

      const relationGraph = createRelationGraph(db);
      const context = {
        db,
        services: { relationGraph }
      };

      const getTool = new GetRelationsTool();
      const result = await getTool.handle({
        memory_id,
        relation_type: relation_type as any,
        category: category as any,
        direction: direction as any || 'both'
      }, context);

      const resultText = result.content[0]?.text || '{}';
      const resultData = JSON.parse(resultText);

      if (resultData.success === false) {
        return res.status(400).json(resultData);
      }

      return res.json({
        message: '관계 조회 완료',
        ...resultData,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Relation retrieval failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '관계 조회 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // 관계 추가
  router.post('/relations', async (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }

      const { source_id, target_id, relation_type, confidence } = req.body;

      if (!source_id || !target_id || !relation_type) {
        return res.status(400).json({
          error: 'source_id, target_id, relation_type는 필수입니다'
        });
      }

      const relationGraph = createRelationGraph(db);
      const context = {
        db,
        services: { relationGraph }
      };

      const addTool = new AddRelationTool();
      const result = await addTool.handle({
        source_id,
        target_id,
        relation_type,
        confidence: confidence || 0.7
      }, context);

      const resultText = result.content[0]?.text || '{}';
      const resultData = JSON.parse(resultText);

      if (resultData.success === false) {
        return res.status(400).json(resultData);
      }

      return res.json({
        message: '관계 추가 완료',
        ...resultData,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Relation addition failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '관계 추가 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // 관계 삭제
  router.delete('/relations/:relation_id', async (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }

      const { relation_id } = req.params;
      const relationIdNum = parseInt(relation_id, 10);
      if (Number.isNaN(relationIdNum) || relationIdNum < 1) {
        return res.status(400).json({
          error: 'Invalid relation_id',
          message: 'relation_id는 1 이상의 정수여야 합니다'
        });
      }

      const relationGraph = createRelationGraph(db);
      const context = {
        db,
        services: { relationGraph }
      };

      const removeTool = new RemoveRelationTool();
      const result = await removeTool.handle({
        relation_id: relationIdNum
      }, context);

      const resultText = result.content[0]?.text || '{}';
      const resultData = JSON.parse(resultText);

      if (resultData.success === false) {
        return res.status(400).json(resultData);
      }

      return res.json({
        message: '관계 삭제 완료',
        ...resultData,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Relation removal failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '관계 삭제 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // 관계 시각화
  router.get('/relations/:memory_id/visualize', async (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }

      const { memory_id } = req.params;
      const { format, max_depth, min_confidence, relation_types, show_memory_ids, show_confidence, show_relation_types } = req.query;

      const parsedMaxDepth = max_depth ? parseInt(max_depth as string, 10) : 2;
      const parsedMinConf = min_confidence ? parseFloat(min_confidence as string) : undefined;
      if (max_depth !== undefined && (Number.isNaN(parsedMaxDepth) || parsedMaxDepth < 1 || parsedMaxDepth > 20)) {
        return res.status(400).json({ error: 'Invalid max_depth', message: 'max_depth는 1–20 사이 정수여야 합니다' });
      }
      if (min_confidence !== undefined && (parsedMinConf === undefined || Number.isNaN(parsedMinConf) || parsedMinConf < 0 || parsedMinConf > 1)) {
        return res.status(400).json({ error: 'Invalid min_confidence', message: 'min_confidence는 0–1 사이 숫자여야 합니다' });
      }

      const relationGraph = createRelationGraph(db);
      const context = {
        db,
        services: { relationGraph }
      };

      // relation_types를 enum 타입 배열로 변환
      const validRelationTypes = ['CAUSES', 'DEPENDS_ON', 'FOLLOWS', 'CONTRASTS_WITH', 'REFERENCES', 'BELONGS_TO'] as const;
      const parsedRelationTypes = relation_types
        ? (relation_types as string)
            .split(',')
            .map((type: string) => type.trim().toUpperCase())
            .filter((type: string): type is typeof validRelationTypes[number] =>
              validRelationTypes.includes(type as typeof validRelationTypes[number])
            )
        : undefined;

      const visualizeTool = new VisualizeRelationsTool();
      const result = await visualizeTool.handle({
        memory_id,
        format: (format as 'text' | 'subgraph' | 'simple' | 'json') || 'subgraph',
        max_depth: parsedMaxDepth,
        min_confidence: parsedMinConf,
        relation_types: parsedRelationTypes,
        show_memory_ids: show_memory_ids !== undefined ? show_memory_ids === 'true' : true,
        show_confidence: show_confidence !== undefined ? show_confidence === 'true' : true,
        show_relation_types: show_relation_types !== undefined ? show_relation_types === 'true' : true
      }, context);

      const resultText = result.content[0]?.text || '{}';
      const resultData = JSON.parse(resultText);

      if (resultData.success === false) {
        return res.status(400).json(resultData);
      }

      return res.json({
        message: '관계 시각화 완료',
        ...resultData,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Relation visualization failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '관계 시각화 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // ============================================
  // 관리/운영성 도구 HTTP API 엔드포인트 (Phase 5.3)
  // MCP에서 제거된 도구들을 HTTP API로만 제공
  // ============================================

  // 앵커 복원
  router.post('/anchors/restore', async (req, res) => {
    try {
      if (!db || !serverServices) {
        return res.status(500).json({ error: '데이터베이스 또는 서비스가 연결되지 않았습니다' });
      }

      const { agent_id } = req.body;

      const toolContext = createToolContext({ db, services: serverServices });
      const restoreTool = new RestoreAnchorsTool();
      const result = await restoreTool.handle({ agent_id }, toolContext);

      const resultText = result.content[0]?.text || '{}';
      const resultData = JSON.parse(resultText);

      if (resultData.success === false) {
        return res.status(400).json(resultData);
      }

      return res.json({
        message: '앵커 복원 완료',
        ...resultData,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Anchor restoration failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '앵커 복원 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // 임베딩 마이그레이션
  router.post('/embeddings/migrate', async (req, res) => {
    try {
      if (!db || !serverServices) {
        return res.status(500).json({ error: '데이터베이스 또는 서비스가 연결되지 않았습니다' });
      }

      const { source_provider, target_provider, batch_size, dry_run } = req.body;

      if (!target_provider) {
        return res.status(400).json({
          error: 'target_provider는 필수입니다'
        });
      }

      const toolContext = createToolContext({ db, services: serverServices });
      const migrateTool = new MigrateEmbeddingsTool();
      const result = await migrateTool.handle({
        source_provider,
        target_provider,
        batch_size: batch_size || 100,
        dry_run: dry_run || false
      }, toolContext);

      const resultText = result.content[0]?.text || '{}';
      const resultData = JSON.parse(resultText);

      if (resultData.success === false) {
        return res.status(400).json(resultData);
      }

      return res.json({
        message: '임베딩 마이그레이션 완료',
        ...resultData,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Embedding migration failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '임베딩 마이그레이션 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Episodic → Semantic 변환
  router.post('/memory/convert-episodic-to-semantic', async (req, res) => {
    try {
      if (!db || !serverServices) {
        return res.status(500).json({ error: '데이터베이스 또는 서비스가 연결되지 않았습니다' });
      }

      const { memory_id, skip_converted, retry_failed, limit } = req.body;

      const toolContext = createToolContext({ db, services: serverServices });
      const convertTool = new ConvertEpisodicToSemanticTool();
      const result = await convertTool.handle({
        memory_id,
        skip_converted: skip_converted !== undefined ? skip_converted : true,
        retry_failed: retry_failed || false,
        limit: limit || 10
      }, toolContext);

      const resultText = result.content[0]?.text || '{}';
      const resultData = JSON.parse(resultText);

      if (resultData.success === false) {
        return res.status(400).json(resultData);
      }

      return res.json({
        message: 'Episodic → Semantic 변환 완료',
        ...resultData,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Episodic to Semantic conversion failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: 'Episodic → Semantic 변환 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // 메타 메모리 통계 조회
  router.get('/memory/meta-stats', async (req, res) => {
    try {
      if (!db || !serverServices) {
        return res.status(500).json({ error: '데이터베이스 또는 서비스가 연결되지 않았습니다' });
      }

      const { memory_id, memory_ids, min_recall_count, min_confidence, limit } = req.query;

      const toolContext = createToolContext({ db, services: serverServices });
      const statsTool = new GetMetaMemoryStatsTool();
      
      const params: Record<string, unknown> = {};
      if (memory_id) params.memory_id = memory_id;
      if (memory_ids) {
        params.memory_ids = Array.isArray(memory_ids) ? memory_ids : (memory_ids as string).split(',');
      }
      if (min_recall_count) {
        const n = parseInt(min_recall_count as string, 10);
        if (Number.isNaN(n) || n < 0) {
          return res.status(400).json({ error: 'Invalid min_recall_count', message: 'min_recall_count는 0 이상의 정수여야 합니다' });
        }
        params.min_recall_count = n;
      }
      if (min_confidence) {
        const c = parseFloat(min_confidence as string);
        if (Number.isNaN(c) || c < 0 || c > 1) {
          return res.status(400).json({ error: 'Invalid min_confidence', message: 'min_confidence는 0–1 사이 숫자여야 합니다' });
        }
        params.min_confidence = c;
      }
      if (limit) {
        const l = parseInt(limit as string, 10);
        if (Number.isNaN(l) || l < 1 || l > 1000) {
          return res.status(400).json({ error: 'Invalid limit', message: 'limit는 1–1000 사이 정수여야 합니다' });
        }
        params.limit = l;
      }

      const result = await statsTool.handle(params, toolContext);

      const resultText = result.content[0]?.text || '{}';
      const resultData = JSON.parse(resultText);

      if (resultData.success === false) {
        return res.status(400).json(resultData);
      }

      return res.json({
        message: '메타 메모리 통계 조회 완료',
        ...resultData,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Meta memory stats retrieval failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '메타 메모리 통계 조회 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.get('/telemetry/search-quality', (req, res) => {
    try {
      if (!db || !serverServices?.telemetryService) {
        return res.status(500).json({ error: 'DB unavailable' });
      }
      const periodRaw = req.query.period as string | undefined;
      const effectivePeriod = effectiveTelemetryPeriod(periodRaw);
      if (!TELEMETRY_PERIODS.includes(effectivePeriod as TelemetryPeriod)) {
        return res.status(400).json({ error: 'Invalid period', allowed: TELEMETRY_PERIODS });
      }
      const ownerQ = req.query.owner_id as string | undefined;
      const data = serverServices.telemetryService.getSearchQuality(
        effectivePeriod as TelemetryPeriod,
        ownerQ === undefined || ownerQ === '' ? null : ownerQ
      );
      return res.json(data);
    } catch (error) {
      logger.error('telemetry search-quality failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: 'Internal error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.get('/telemetry/memory-quality', (req, res) => {
    try {
      if (!db || !serverServices?.telemetryService) {
        return res.status(500).json({ error: 'DB unavailable' });
      }
      const ownerQ = req.query.owner_id as string | undefined;
      const data = serverServices.telemetryService.getMemoryQuality(
        ownerQ === undefined || ownerQ === '' ? null : ownerQ
      );
      return res.json(data);
    } catch (error) {
      logger.error('telemetry memory-quality failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: 'Internal error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.get('/telemetry/system', (req, res) => {
    try {
      if (!db || !serverServices?.telemetryService) {
        return res.status(500).json({ error: 'DB unavailable' });
      }
      const periodRaw = req.query.period as string | undefined;
      const effectivePeriod = effectiveTelemetryPeriod(periodRaw);
      if (!TELEMETRY_PERIODS.includes(effectivePeriod as TelemetryPeriod)) {
        return res.status(400).json({ error: 'Invalid period', allowed: TELEMETRY_PERIODS });
      }
      const ownerQ = req.query.owner_id as string | undefined;
      const data = serverServices.telemetryService.getSystemMetrics(
        effectivePeriod as TelemetryPeriod,
        ownerQ === undefined || ownerQ === '' ? null : ownerQ
      );
      return res.json(data);
    } catch (error) {
      logger.error('telemetry system failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: 'Internal error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.get('/telemetry/events', (req, res) => {
    try {
      if (!db || !serverServices?.telemetryService) {
        return res.status(500).json({ error: 'DB unavailable' });
      }
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      if (from !== undefined && from !== '') {
        const df = Date.parse(from);
        if (Number.isNaN(df)) {
          return res.status(400).json({ error: 'Invalid time range', field: 'from', reason: 'parse' });
        }
      }
      if (to !== undefined && to !== '') {
        const dt = Date.parse(to);
        if (Number.isNaN(dt)) {
          return res.status(400).json({ error: 'Invalid time range', field: 'to', reason: 'parse' });
        }
      }
      if (from && to && Date.parse(from) > Date.parse(to)) {
        return res.status(400).json({ error: 'Invalid time range', field: 'from', reason: 'range' });
      }
      const limitRaw = req.query.limit !== undefined ? parseInt(String(req.query.limit), 10) : 50;
      if (Number.isNaN(limitRaw) || limitRaw < 1 || limitRaw > 100) {
        return res.status(400).json({ error: 'Invalid limit', message: 'limit must be 1–100' });
      }
      const offsetRaw = req.query.offset !== undefined ? parseInt(String(req.query.offset), 10) : 0;
      if (Number.isNaN(offsetRaw) || offsetRaw < 0) {
        return res.status(400).json({ error: 'Invalid offset' });
      }
      const outcome = req.query.outcome as string | undefined;
      if (
        outcome !== undefined &&
        outcome !== '' &&
        !['success', 'failure', 'empty'].includes(outcome)
      ) {
        return res.status(400).json({ error: 'Invalid outcome' });
      }
      const etRaw = req.query.event_type as string | undefined;
      const known: EventType[] = [
        'memory.search.requested',
        'memory.search.candidates_retrieved',
        'memory.search.reranked',
        'memory.search.selected',
        'memory.search.empty',
        'memory.search.failed',
        'memory.write.requested',
        'memory.write.completed',
        'memory.feedback.positive',
        'memory.feedback.negative',
        'consolidation.performed',
        'telemetry.cleanup.performed'
      ];
      const eventType =
        etRaw && known.includes(etRaw as EventType) ? (etRaw as EventType) : undefined;

      const data = serverServices.telemetryService.getEvents({
        event_type: eventType,
        request_id: req.query.request_id as string | undefined,
        owner_id: req.query.owner_id as string | undefined,
        from: from || undefined,
        to: to || undefined,
        outcome: outcome as 'success' | 'failure' | 'empty' | undefined,
        limit: limitRaw,
        offset: offsetRaw
      });
      return res.json(data);
    } catch (error) {
      logger.error('telemetry events failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: 'Internal error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // ============================================================
  // GET /admin/graph — 기억 관계 그래프 데이터 (009-memory-graph-view)
  // FR-001~FR-003, FR-010~FR-012
  // ============================================================
  router.get('/graph', (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }

      // 쿼리 파라미터 파싱 및 검증 (T026)
      const typesRaw = req.query['types'] as string | undefined;
      const relationTypesRaw = req.query['relation_types'] as string | undefined;
      const minImportanceRaw = req.query['min_importance'] as string | undefined;
      const limitRaw = req.query['limit'] as string | undefined;

      const filters: GraphFilter = {};

      if (typesRaw) {
        const VALID_TYPES = new Set(['episodic', 'semantic', 'procedural', 'working']);
        const parsed = typesRaw.split(',').map(t => t.trim()).filter(Boolean);
        const invalid = parsed.filter(t => !VALID_TYPES.has(t));
        if (invalid.length > 0) {
          return res.status(400).json({
            error: '잘못된 파라미터',
            message: `허용되지 않는 types 값: ${invalid.join(', ')}. 허용 값: episodic, semantic, procedural, working`,
          });
        }
        filters.types = parsed;
      }
      if (relationTypesRaw) {
        filters.relation_types = relationTypesRaw.split(',').map(t => t.trim()).filter(Boolean);
      }
      if (minImportanceRaw !== undefined) {
        const val = parseFloat(minImportanceRaw);
        if (isNaN(val) || val < 0 || val > 1) {
          return res.status(400).json({ error: '잘못된 파라미터', message: 'min_importance는 0.0~1.0 사이여야 합니다' });
        }
        filters.min_importance = val;
      }
      if (limitRaw !== undefined) {
        const val = parseInt(limitRaw, 10);
        if (isNaN(val) || val < 1 || val > 1000) {
          return res.status(400).json({ error: '잘못된 파라미터', message: 'limit은 1~1000 사이여야 합니다' });
        }
        filters.limit = val;
      }

      const graphData = buildGraphResponse(db, filters);
      return res.json(graphData);
    } catch (error) {
      logger.error('Graph data fetch failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '그래프 데이터 조회 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  return router;
}

