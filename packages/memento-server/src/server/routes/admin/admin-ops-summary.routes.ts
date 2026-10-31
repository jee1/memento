/**
 * GET /admin/ops/summary — read-only four-question ops report (#1561).
 */

import type { Request, Response, Router } from 'express';
import type Database from 'better-sqlite3';
import { logger } from '@memento/core';
import type { ServerServices } from '../../bootstrap.js';
import { buildOpsSummary, resolveOpsSummaryPeriod } from './admin-ops-summary.service.js';

function ownerQuery(value: unknown): string | null {
  const ownerQ = value as string | undefined;
  return ownerQ === undefined || ownerQ === '' ? null : ownerQ;
}

export function registerAdminOpsSummaryRoutes(
  router: Router,
  db: Database.Database | null,
  serverServices: ServerServices | null,
): void {
  router.get('/ops/summary', async (req: Request, res: Response) => {
    try {
      const period = resolveOpsSummaryPeriod(req.query.period as string | undefined);
      if (!period) {
        return res.status(400).json({ error: 'Invalid period', allowed: ['24h', '7d', '30d'] });
      }
      const payload = await buildOpsSummary(
        db,
        serverServices,
        period,
        ownerQuery(req.query.owner_id),
      );
      return res.json(payload);
    } catch (error) {
      logger.error('ops summary failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({
        error: 'Internal error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
