/**
 * Admin Ops status route (Issue #1048).
 */

import type { Router } from 'express';
import type Database from 'better-sqlite3';
import { buildAdminStatus } from './admin-status-service.js';

export function registerAdminStatusRoutes(
  router: Router,
  db: Database.Database | null,
): void {
  router.get('/status', (_req, res) => {
    res.json(buildAdminStatus(db));
  });
}
