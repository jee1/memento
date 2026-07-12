import {
  AuditHashChainService,
  type AuditAction,
  type AuditTransport,
} from '@memento/core';
import type Database from 'better-sqlite3';
import { Router } from 'express';

const AUDIT_ACTIONS = new Set<AuditAction>(['read', 'write', 'delete', 'admin', 'auth_denied']);
const AUDIT_TRANSPORTS = new Set<AuditTransport>(['mcp_stdio', 'mcp_http', 'http_admin']);

function readSingleQueryValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function parseLimit(value: unknown): number | string {
  if (value === undefined) return 100;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_000) return 'limit must be an integer between 1 and 1000';
  return parsed;
}

function parseQuery(query: Record<string, unknown>): { action?: AuditAction; transport?: AuditTransport; actorId?: string; limit: number } | string {
  const action = readSingleQueryValue(query.action);
  if (action && !AUDIT_ACTIONS.has(action as AuditAction)) return 'action is invalid';
  const transport = readSingleQueryValue(query.transport);
  if (transport && !AUDIT_TRANSPORTS.has(transport as AuditTransport)) return 'transport is invalid';
  const limit = parseLimit(query.limit);
  if (typeof limit === 'string') return limit;
  return {
    action: action as AuditAction | undefined,
    transport: transport as AuditTransport | undefined,
    actorId: readSingleQueryValue(query.actorId),
    limit,
  };
}

/** Read-only admin endpoints for audited operational investigation and export. */
export function createAuditRouter(db: Database.Database): Router {
  const router = Router();
  const auditLog = new AuditHashChainService(db);

  router.get('/entries', (req, res) => {
    const query = parseQuery(req.query as Record<string, unknown>);
    if (typeof query === 'string') return res.status(400).json({ error: query });
    const entries = auditLog.list(query);
    return res.json({ entries, count: entries.length, limit: query.limit });
  });

  router.get('/export', (req, res) => {
    const query = parseQuery(req.query as Record<string, unknown>);
    if (typeof query === 'string') return res.status(400).json({ error: query });
    const entries = auditLog.list(query);
    return res.json({ entries, count: entries.length, verification: auditLog.verify() });
  });

  return router;
}
