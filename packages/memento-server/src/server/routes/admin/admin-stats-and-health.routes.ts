/**
 * Admin: 메모리 정리, 통계(망각/성능/공고화), DB 최적화, 에러/알림 스텁
 */

import type { Router } from 'express';
import type Database from 'better-sqlite3';
import { logger } from '@memento/core';
import type { ServerServices } from '../../bootstrap.js';

export function registerAdminStatsAndHealthRoutes(
  router: Router,
  db: Database.Database | null,
  serverServices: ServerServices | null
): void {
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
}
