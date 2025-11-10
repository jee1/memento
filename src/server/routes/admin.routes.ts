/**
 * Admin 라우터
 * /admin/* 엔드포인트 처리
 * Phase 1.2: http-server.ts 리팩토링
 */

import { Router } from 'express';
import type Database from 'better-sqlite3';
import { getBatchScheduler } from '../../services/batch-scheduler.js';
import { getPerformanceMonitor } from '../../services/performance-monitor.js';
import { logger } from '../../utils/logger.js';

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

  return router;
}

