/**
 * Admin: 메모리 정리, 통계(망각/성능/공고화), DB 최적화, 에러/알림 스텁
 */

import type { Request, Response, Router } from 'express';
import type Database from 'better-sqlite3';
import {
  deleteExpiredWorkingMemories,
  logger,
  queryMemoryCountsByTypeStats,
  queryMemoryForgettingStatsByType,
} from '@memento/core';
import type { ServerServices } from '../../bootstrap.js';

function databaseUnavailable(res: Response) {
  return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
}

function postMemoryCleanup(db: Database.Database | null) {
  return async (_req: Request, res: Response) => {
    try {
      if (!db) {
        return databaseUnavailable(res);
      }

      const deletedCount = deleteExpiredWorkingMemories(db);

      return res.json({
        message: '메모리 정리 완료',
        deleted_count: deletedCount,
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
  };
}

function getForgettingStats(db: Database.Database | null) {
  return async (_req: Request, res: Response) => {
    try {
      if (!db) {
        return databaseUnavailable(res);
      }

      const stats = queryMemoryForgettingStatsByType(db);

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
  };
}

function getPerformanceStats(db: Database.Database | null) {
  return async (_req: Request, res: Response) => {
    try {
      if (!db) {
        return databaseUnavailable(res);
      }

      const stats = queryMemoryCountsByTypeStats(db);

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
  };
}

function getConsolidationStats(db: Database.Database | null, serverServices: ServerServices | null) {
  return async (req: Request, res: Response) => {
    try {
      if (!db) {
        return databaseUnavailable(res);
      }
      const telemetry = serverServices?.telemetryService;
      if (!telemetry) {
        return res.status(503).json({ error: 'Telemetry not available' });
      }
      const rawOwner = req.query.owner_id;
      const ownerId =
        typeof rawOwner === 'string' && rawOwner.length > 0 ? rawOwner : null;
      const consolidation_quality = telemetry.getConsolidationQuality('7d', ownerId);
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
  };
}

function postDatabaseOptimize(db: Database.Database | null) {
  return async (_req: Request, res: Response) => {
    try {
      if (!db) {
        return databaseUnavailable(res);
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
  };
}

function getErrorStats() {
  return async (_req: Request, res: Response) => {
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
  };
}

function postErrorResolve() {
  return async (req: Request, res: Response) => {
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
  };
}

function getPerformanceAlerts() {
  return async (_req: Request, res: Response) => {
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
  };
}

export function registerAdminStatsAndHealthRoutes(
  router: Router,
  db: Database.Database | null,
  serverServices: ServerServices | null
): void {
  router.post('/memory/cleanup', postMemoryCleanup(db));
  router.get('/stats/forgetting', getForgettingStats(db));
  router.get('/stats/performance', getPerformanceStats(db));
  router.get('/stats/consolidation', getConsolidationStats(db, serverServices));
  router.post('/database/optimize', postDatabaseOptimize(db));
  router.get('/stats/errors', getErrorStats());
  router.post('/errors/resolve', postErrorResolve());
  router.get('/alerts/performance', getPerformanceAlerts());
}
