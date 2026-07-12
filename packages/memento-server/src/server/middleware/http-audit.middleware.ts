import { createHash } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  AuditHashChainService,
  assertAuditCoverage,
  getAuditMode,
  isStrictAuditAction,
  type AuditAction,
  type AuditTransport,
  mementoConfig,
} from '@memento/core';
import type Database from 'better-sqlite3';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export type HttpAuditEntry = {
  ts: string;
  key_id: string;
  route: string;
  tool: string | null;
  owner_id: string | null;
  agent_id: string | null;
  latency_ms: number;
  status: number;
};

export type HttpAuditMiddlewareConfig = {
  logPath?: string;
  shouldAudit?: (req: Request) => boolean;
  database?: Database.Database;
  transport?: AuditTransport;
};

export type StrictAuditCoverageMiddlewareConfig = {
  database: Database.Database;
  transport?: AuditTransport;
};

const DEFAULT_AUDIT_MODE = 'best-effort';

function resolveAuditLogPath(override?: string): string {
  const configured = override ?? process.env.MEMENTO_HTTP_AUDIT_LOG_PATH?.trim();
  if (configured) {
    return configured;
  }
  if (process.env.NODE_ENV === 'test') {
    return join('/tmp', `memento-http-audit-${process.pid}.jsonl`);
  }
  return join(dirname(mementoConfig.dbPath), 'http-audit.jsonl');
}

function readAuthCredential(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    return token === '' ? null : token;
  }

  const apiKeyHeader = req.headers['x-api-key'];
  if (typeof apiKeyHeader === 'string') {
    const value = apiKeyHeader.trim();
    return value === '' ? null : value;
  }

  return null;
}

export function resolveHttpAuditKeyId(req: Request): string {
  const programmaticKeyId = req.programmaticAuth?.keyId?.trim();
  if (programmaticKeyId) {
    return programmaticKeyId;
  }

  const credential = readAuthCredential(req);
  if (credential) {
    return createHash('sha256').update(credential).digest('hex').slice(0, 12);
  }

  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.trim() !== '') {
    return 'legacy-key';
  }

  if (req.headers.cookie?.includes('memento_admin_session=')) {
    return 'session';
  }

  return 'anonymous';
}

function extractRoute(req: Request): string {
  const original = req.originalUrl?.split('?')[0];
  if (original) {
    return original;
  }
  return `${req.baseUrl ?? ''}${req.path}`;
}

export function extractHttpAuditToolName(req: Request): string | null {
  const base = req.baseUrl ?? '';
  if (base === '/tools' || base.startsWith('/tools')) {
    const segments = req.path.split('/').filter(Boolean);
    if (segments.length >= 1) {
      return decodeURIComponent(segments[0]!);
    }
  }

  const route = extractRoute(req);
  const match = route.match(/^\/tools\/([^/?]+)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

function extractOwnerId(req: Request): string | null {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return null;
  }

  const ownerId = (body as Record<string, unknown>).owner_id;
  if (typeof ownerId === 'string' && ownerId.trim() !== '') {
    return ownerId;
  }
  if (Array.isArray(ownerId) && typeof ownerId[0] === 'string' && ownerId[0].trim() !== '') {
    return ownerId[0];
  }
  return null;
}

function extractAgentId(req: Request): string | null {
  const mementoAgentHeader = req.headers['x-memento-agent-id'];
  if (typeof mementoAgentHeader === 'string' && mementoAgentHeader.trim() !== '') {
    return mementoAgentHeader.trim();
  }

  const header = req.headers['x-agent-id'];
  if (typeof header === 'string' && header.trim() !== '') {
    return header.trim();
  }

  const body = req.body;
  if (body && typeof body === 'object') {
    const agentId = (body as Record<string, unknown>).agent_id;
    if (typeof agentId === 'string' && agentId.trim() !== '') {
      return agentId;
    }
  }

  if (req.toolContext?.agentId?.trim()) {
    return req.toolContext.agentId.trim();
  }

  return null;
}

function extractTargetUri(req: Request): string | null {
  const body = req.body;
  if (!body || typeof body !== 'object') return null;
  const target = (body as Record<string, unknown>).target_uri ?? (body as Record<string, unknown>).uri;
  return typeof target === 'string' && target.startsWith('memento://') ? target : null;
}

function resolveAuditAction(req: Request, status: number, tool: string | null, transport: AuditTransport): AuditAction {
  if (status === 401 || status === 403) return 'auth_denied';
  if (transport === 'http_admin') return 'admin';
  if (req.method === 'DELETE' || tool === 'forget' || tool?.startsWith('remove_')) return 'delete';
  if (tool === 'recall' || tool === 'get_relations' || tool === 'export_memories' || req.method === 'GET') return 'read';
  return 'write';
}

function resolveAuditResultStatus(status: number): 'success' | 'failure' | 'denied' {
  if (status === 401 || status === 403) return 'denied';
  return status >= 200 && status < 400 ? 'success' : 'failure';
}

async function appendAuditLine(logPath: string, entry: HttpAuditEntry): Promise<void> {
  const line = `${JSON.stringify(entry)}\n`;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- log path from env or dataDir default
  await appendFile(logPath, line, 'utf8');
}

export function createHttpAuditMiddleware(config: HttpAuditMiddlewareConfig = {}): RequestHandler {
  const logPath = resolveAuditLogPath(config.logPath);
  const shouldAudit = config.shouldAudit ?? (() => true);
  const auditMode = process.env.MEMENTO_HTTP_AUDIT_MODE?.trim() || DEFAULT_AUDIT_MODE;
  const auditTransport = config.transport ?? 'mcp_http';
  const auditChain = config.database ? new AuditHashChainService(config.database) : null;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!shouldAudit(req)) {
      next();
      return;
    }

    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const elapsedNs = process.hrtime.bigint() - startedAt;
      const entry: HttpAuditEntry = {
        ts: new Date().toISOString(),
        key_id: resolveHttpAuditKeyId(req),
        route: extractRoute(req),
        tool: extractHttpAuditToolName(req),
        owner_id: extractOwnerId(req),
        agent_id: extractAgentId(req),
        latency_ms: Number(elapsedNs / 1_000_000n),
        status: res.statusCode,
      };

      if (auditChain) {
        try {
          const tool = entry.tool;
          auditChain.append({
            actorId: entry.key_id === 'anonymous' ? null : entry.key_id,
            ownerId: entry.owner_id,
            agentId: entry.agent_id,
            transport: auditTransport,
            toolOrEndpoint: tool ?? entry.route,
            action: resolveAuditAction(req, entry.status, tool, auditTransport),
            targetUri: extractTargetUri(req),
            resultStatus: resolveAuditResultStatus(entry.status),
            evidenceMode: 'metadata_only',
            requestSeen: true,
            responseSeen: true,
            toolArgsState: 'omitted',
            outputState: 'omitted',
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          process.stderr.write(`[memento-http-audit] failed to append audit chain (${auditMode}): ${message}\n`);
        }
      }

      void appendAuditLine(logPath, entry).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(
          `[memento-http-audit] failed to append audit log (${auditMode}): ${message}\n`,
        );
        if (auditMode === 'strict') {
          // Reserved for #660 hash-chained audit integration — strict mode will reject requests there.
        }
      });
    });

    next();
  };
}

/**
 * Strict mode checks its prerequisites before a sensitive operation runs. The
 * finish listener still writes the final result, but an unavailable audit
 * table or an unverified actor cannot allow delete/admin operations through.
 */
export function createStrictAuditCoverageMiddleware(config: StrictAuditCoverageMiddlewareConfig): RequestHandler {
  const transport = config.transport ?? 'mcp_http';

  return (req: Request, res: Response, next: NextFunction): void => {
    if (getAuditMode() !== 'strict') return void next();
    const tool = extractHttpAuditToolName(req);
    const action = resolveAuditAction(req, 200, tool, transport);
    if (!isStrictAuditAction(action)) return void next();

    try {
      const actorId = req.programmaticAuth?.keyId ?? null;
      assertAuditCoverage({
        actorId,
        transport,
        toolOrEndpoint: tool ?? extractRoute(req),
        action,
        resultStatus: 'success',
        evidenceMode: 'metadata_only',
        requestSeen: true,
        responseSeen: false,
        toolArgsState: 'omitted',
        outputState: 'omitted',
      });
      config.database.prepare('SELECT 1 FROM audit_log LIMIT 1').get();
      next();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(503).json({ error: 'Audit coverage unavailable', message });
    }
  };
}
