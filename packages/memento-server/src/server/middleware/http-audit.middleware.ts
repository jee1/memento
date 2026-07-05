import { createHash } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { mementoConfig } from '@memento/core';
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

declare global {
  namespace Express {
    interface Request {
      programmaticAuth?: {
        keyId?: string;
      };
    }
  }
}

export type HttpAuditMiddlewareConfig = {
  logPath?: string;
  shouldAudit?: (req: Request) => boolean;
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

async function appendAuditLine(logPath: string, entry: HttpAuditEntry): Promise<void> {
  const line = `${JSON.stringify(entry)}\n`;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- log path from env or dataDir default
  await appendFile(logPath, line, 'utf8');
}

export function createHttpAuditMiddleware(config: HttpAuditMiddlewareConfig = {}): RequestHandler {
  const logPath = resolveAuditLogPath(config.logPath);
  const shouldAudit = config.shouldAudit ?? (() => true);
  const auditMode = process.env.MEMENTO_HTTP_AUDIT_MODE?.trim() || DEFAULT_AUDIT_MODE;

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
