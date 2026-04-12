/**
 * 관리자 /admin/telemetry/* 라우트
 */

import type { Router } from 'express';
import type Database from 'better-sqlite3';
import {
  logger,
  type TelemetryPeriod,
  type EventType
} from '@memento/core';
import type { ServerServices } from '../../bootstrap.js';
import { TELEMETRY_PERIODS, effectiveTelemetryPeriod } from './admin-telemetry-utils.js';

export function registerAdminTelemetryRoutes(
  router: Router,
  db: Database.Database | null,
  serverServices: ServerServices | null
): void {
  router.get('/telemetry/search-quality', (req, res) => {
    try {
      if (!db || !serverServices?.telemetryService) {
        return res.status(503).json({ error: 'DB unavailable' });
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
        return res.status(503).json({ error: 'DB unavailable' });
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
        return res.status(503).json({ error: 'DB unavailable' });
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
        return res.status(503).json({ error: 'DB unavailable' });
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
}
