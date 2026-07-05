/**
 * Admin: forgetting event audit log
 */

import type { Router } from 'express';
import type Database from 'better-sqlite3';
import { listForgettingEvents, logger, type ForgettingEventAction } from '@memento/core';

const FORGETTING_ACTIONS: ForgettingEventAction[] = ['soft', 'hard', 'review'];

export function registerAdminForgettingRoutes(router: Router, db: Database.Database | null): void {
  router.get('/forgetting/events', (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ error: 'DB unavailable' });
      }

      const table = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memory_forgetting_event'`)
        .get();
      if (!table) {
        return res.status(503).json({ error: 'memory_forgetting_event table not found; run db:migrate' });
      }

      const memoryId = typeof req.query.memory_id === 'string' ? req.query.memory_id : undefined;
      const actionRaw = typeof req.query.action === 'string' ? req.query.action : undefined;
      if (actionRaw && !FORGETTING_ACTIONS.includes(actionRaw as ForgettingEventAction)) {
        return res.status(400).json({ error: 'Invalid action', allowed: FORGETTING_ACTIONS });
      }

      const limitRaw = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 50;
      const offsetRaw = typeof req.query.offset === 'string' ? Number.parseInt(req.query.offset, 10) : 0;
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const offset = Number.isFinite(offsetRaw) ? offsetRaw : 0;

      const events = listForgettingEvents(db, {
        memory_id: memoryId,
        action: actionRaw as ForgettingEventAction | undefined,
        limit,
        offset,
      });

      return res.json({
        count: events.length,
        limit,
        offset,
        events,
      });
    } catch (error) {
      logger.error('forgetting events query failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({
        error: 'Internal error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
