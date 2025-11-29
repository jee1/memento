/**
 * Admin 라우터
 * /admin/* 엔드포인트 처리
 * Phase 1.2: http-server.ts 리팩토링
 */

import { Router } from 'express';
import type Database from 'better-sqlite3';
import { getBatchScheduler } from '../../infrastructure/scheduler/batch-scheduler.js';
import { getPerformanceMonitor } from '../../services/performance-monitor.js';
import { RelationGraph } from '../../domains/relation/services/relation-graph.js';
import { RelationExtractor } from '../../services/relation-extractor.js';
import { ExtractRelationsTool } from '../../tools/extract-relations-tool.js';
import { GetRelationsTool } from '../../tools/get-relations-tool.js';
import { AddRelationTool } from '../../tools/add-relation-tool.js';
import { RemoveRelationTool } from '../../tools/remove-relation-tool.js';
import { VisualizeRelationsTool } from '../../tools/visualize-relations-tool.js';
import { DatabaseUtils } from '../../shared/utils/database.js';
import { logger } from '../../shared/utils/logger.js';

/**
 * Admin 라우터 생성
 */
export function createAdminRouter(db: Database.Database | null): Router {
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
      const relationGraph = new RelationGraph(db);
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

      const relationGraph = new RelationGraph(db);
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

      const relationGraph = new RelationGraph(db);
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

      const relationGraph = new RelationGraph(db);
      const context = {
        db,
        services: { relationGraph }
      };

      const removeTool = new RemoveRelationTool();
      const result = await removeTool.handle({
        relation_id: parseInt(relation_id, 10)
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

      const relationGraph = new RelationGraph(db);
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
        max_depth: max_depth ? parseInt(max_depth as string, 10) : 2,
        min_confidence: min_confidence ? parseFloat(min_confidence as string) : undefined,
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

  return router;
}

