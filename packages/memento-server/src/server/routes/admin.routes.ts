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
  RestoreAnchorsTool,
  MigrateEmbeddingsTool,
  ConvertEpisodicToSemanticTool,
  GetMetaMemoryStatsTool,
  logger,
  createToolContext
} from '@memento/core';
import { registerAdminRelationRoutes } from './admin/admin-relations.routes.js';
import { registerAdminTelemetryRoutes } from './admin/admin-telemetry.routes.js';
import { registerAdminGraphRoute } from './admin/admin-graph.routes.js';
import { registerAdminEmbeddingMapRoute } from './admin/admin-embedding-map.routes.js';

export type { GraphNode, GraphEdge, GraphFilter, GraphResponse } from './admin/admin-graph-response.js';

/**
 * cleanup 파라미터 파싱 헬퍼 (Issue #81)
 * Math.floor를 사용해 정수 보장 — better-sqlite3의 datetime() modifier에 안전하게 사용 가능
 */
function parseCleanupParams(query: Record<string, unknown>): { olderThanDays: number; types: string[] } | { error: string; status: number } {
  const olderThanDays = Math.floor(Number(query['older_than_days']));
  if (!query['older_than_days'] || isNaN(olderThanDays) || olderThanDays <= 0) {
    return { error: 'older_than_days 파라미터가 필요합니다 (양의 정수)', status: 400 };
  }
  const typesRaw = typeof query['types'] === 'string' ? query['types'] : 'episodic,working';
  const types = typesRaw.split(',').map(t => t.trim()).filter(Boolean);
  if (types.includes('core')) {
    return { error: 'core 타입 기억은 삭제할 수 없습니다', status: 400 };
  }
  const allowedTypes = ['working', 'episodic', 'semantic', 'procedural', 'vault'];
  const invalid = types.filter(t => !allowedTypes.includes(t));
  if (invalid.length > 0) {
    return { error: `허용되지 않는 타입: ${invalid.join(', ')}`, status: 400 };
  }
  return { olderThanDays, types };
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

  // 공고화·구조화 파이프라인 통계 (012)
  router.get('/stats/consolidation', async (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }
      const telemetry = serverServices?.telemetryService;
      if (!telemetry) {
        return res.status(503).json({ error: 'Telemetry not available' });
      }
      const rawOwner = req.query.owner_id;
      const ownerId =
        typeof rawOwner === 'string' && rawOwner.length > 0 ? rawOwner : null;
      const consolidation_quality = telemetry.getConsolidationQuality(ownerId);
      return res.json({
        message: 'Consolidation stats',
        consolidation_quality,
        pipeline_error_summary: { count: consolidation_quality.pipeline_error_count },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Consolidation stats retrieval failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '공고화 통계 조회 실패',
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
        return res.status(503).json({
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

  registerAdminRelationRoutes(router, db);

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
      if (memory_id !== undefined && memory_id !== '') {
        if (typeof memory_id !== 'string') {
          return res.status(400).json({
            error: 'Invalid memory_id',
            message: 'memory_id는 단일 문자열이어야 합니다. 여러 ID는 memory_ids 쿼리를 사용하세요.'
          });
        }
        params.memory_id = memory_id;
      }
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

  // Project stats (Issue #81)
  router.get('/memory/project/:project_id/stats', async (req, res) => {
    try {
      if (!db) return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      const { project_id } = req.params;
      const total = (db.prepare(`SELECT COUNT(*) as c FROM memory_item WHERE project_id = ? AND COALESCE(is_deleted, 0) = 0`).get(project_id) as { c: number }).c;
      const byTypeRows = db.prepare(`SELECT type, COUNT(*) as c FROM memory_item WHERE project_id = ? AND COALESCE(is_deleted, 0) = 0 GROUP BY type`).all(project_id) as Array<{ type: string; c: number }>;
      const by_type: Record<string, number> = {};
      for (const row of byTypeRows) { by_type[row.type] = row.c; }
      const dates = db.prepare(`SELECT MIN(created_at) as oldest, MAX(created_at) as newest FROM memory_item WHERE project_id = ? AND COALESCE(is_deleted, 0) = 0`).get(project_id) as { oldest: string | null; newest: string | null };
      return res.json({ project_id, total, by_type, oldest_created_at: dates.oldest, newest_created_at: dates.newest });
    } catch (error) {
      return res.status(500).json({ error: '프로젝트 통계 조회 실패', message: String(error) });
    }
  });

  // Project cleanup preview (Issue #81)
  router.get('/memory/project/:project_id/cleanup/preview', async (req, res) => {
    try {
      if (!db) return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      const { project_id } = req.params;
      const parsed = parseCleanupParams(req.query as Record<string, unknown>);
      if ('error' in parsed) return res.status(parsed.status).json({ error: parsed.error });
      const { olderThanDays, types } = parsed;
      const placeholders = types.map(() => '?').join(', ');
      const rows = db.prepare(
        `SELECT id, content, type, created_at FROM memory_item WHERE project_id = ? AND type IN (${placeholders}) AND created_at < datetime('now', '-${olderThanDays} days') AND COALESCE(is_deleted, 0) = 0`
      ).all(project_id, ...types) as Array<{ id: string; content: string; type: string; created_at: string }>;
      return res.json({ would_delete: rows.length, items: rows });
    } catch (error) {
      return res.status(500).json({ error: '프로젝트 정리 미리보기 실패', message: String(error) });
    }
  });

  // Project cleanup delete (Issue #81)
  router.delete('/memory/project/:project_id/cleanup', async (req, res) => {
    try {
      if (!db) return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      const { project_id } = req.params;
      const parsed = parseCleanupParams(req.query as Record<string, unknown>);
      if ('error' in parsed) return res.status(parsed.status).json({ error: parsed.error });
      const { olderThanDays, types } = parsed;
      const placeholders = types.map(() => '?').join(', ');
      const result = db.prepare(
        `DELETE FROM memory_item WHERE project_id = ? AND type IN (${placeholders}) AND created_at < datetime('now', '-${olderThanDays} days') AND COALESCE(is_deleted, 0) = 0`
      ).run(project_id, ...types);
      return res.json({ deleted: result.changes });
    } catch (error) {
      return res.status(500).json({ error: '프로젝트 정리 실패', message: String(error) });
    }
  });

  registerAdminTelemetryRoutes(router, db, serverServices);
  registerAdminGraphRoute(router, db);
  registerAdminEmbeddingMapRoute(router, db);

  return router;
}

