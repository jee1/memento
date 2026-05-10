/**
 * Admin: 런타임 성능 모니터(지표·알림·요약·해결)
 */

import type { Router } from 'express';
import { getPerformanceMonitor, logger } from '@memento/core';

export function registerAdminRuntimePerformanceRoutes(router: Router): void {
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
}
