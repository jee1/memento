import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type Database from 'better-sqlite3';
import type { ServerServices } from '../../bootstrap.js';
import { logger, mementoConfig } from '@memento/core';
import { buildMcpManualCorsHeaders } from '../../utils/cors-policy.js';
import { createJsonRpcError, isInitializeRequest, isJsonRpcNotification } from './json-rpc.js';
import { processMcpMessage } from './message-processor.js';
import type { McpRequestMessage, SSETransport } from './types.js';

export type ApplyMcpCorsHeaders = (req: Request, res: Response) => void;

export function applyMcpCorsHeaders(req: Request, res: Response): void {
  const origin = req.get('origin') ?? undefined;
  const headers = buildMcpManualCorsHeaders(origin, mementoConfig.corsAllowedOrigins);
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
}

export function sendMcpCorsPreflight(req: Request, res: Response): void {
  applyMcpCorsHeaders(req, res);
  res.status(204).end();
}

export async function handleMcpSseConnection(
  req: Request,
  res: Response,
  transports: Record<string, SSETransport>
): Promise<void> {
  const protocolVersionHeader = req.get('mcp-protocol-version');
  if (protocolVersionHeader) {
    logger.info('MCP streamable_http GET not supported, returning 405', {
      protocolVersion: protocolVersionHeader
    });
    applyMcpCorsHeaders(req, res);
    res.status(405).end();
    return;
  }

  logger.info('MCP SSE client connection request');
  try {
    const origin = req.get('origin') ?? undefined;
    const manualCors = buildMcpManualCorsHeaders(origin, mementoConfig.corsAllowedOrigins);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...manualCors
    });

    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`);
    res.write(`data: {"type": "ready"}\n\n`);

    const keepAliveInterval = setInterval(() => {
      if (res.writableEnded) {
        clearInterval(keepAliveInterval);
        return;
      }
      try {
        res.write(`data: {"type": "ping"}\n\n`);
      } catch {
        clearInterval(keepAliveInterval);
      }
    }, 30000);

    transports[sessionId] = { res, sessionId, keepAliveInterval };
    registerSseCleanup(req, sessionId, keepAliveInterval, transports);
    logger.info('MCP SSE stream setup completed', { sessionId });
  } catch (error) {
    logger.error('SSE stream setup failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    if (!res.headersSent) {
      res.status(500).send('Error establishing SSE stream');
    }
  }
}

function registerSseCleanup(
  req: Request,
  sessionId: string,
  keepAliveInterval: NodeJS.Timeout,
  transports: Record<string, SSETransport>
): void {
  const cleanup = (): void => {
    clearInterval(keepAliveInterval);
    delete transports[sessionId];
  };

  req.on('close', () => {
    logger.info('MCP SSE client connection closed', { sessionId });
    cleanup();
  });

  req.on('error', (error) => {
    const errorWithCode = error as { code?: string };
    if (errorWithCode.code === 'ECONNRESET') {
      logger.info('MCP SSE client connection closed (normal)', { sessionId });
    } else {
      logger.error('MCP SSE connection error', {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    cleanup();
  });
}

export async function handleStreamableMcpPost(
  req: Request,
  res: Response,
  db: Database.Database | null,
  serverServices: ServerServices | null
): Promise<void> {
  logger.info('MCP streamable_http request received', { method: req.body?.method });
  applyMcpCorsHeaders(req, res);

  const message = req.body as McpRequestMessage;
  const notificationOnly = isJsonRpcNotification(message);
  if (isInitializeRequest(message) && !req.get('mcp-session-id')) {
    res.setHeader('mcp-session-id', randomUUID());
  }

  try {
    const result = await processMcpMessage(message, db, serverServices);
    if (notificationOnly) {
      res.status(202).end();
      return;
    }
    res.type('application/json').status(200).json(result);
  } catch (error) {
    logger.error('MCP streamable_http processing failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    if (notificationOnly) {
      res.status(202).end();
      return;
    }
    const errorResponse = createJsonRpcError(
      message?.id ?? null,
      -32603,
      'Internal error',
      error instanceof Error ? error.message : 'Unknown error'
    );
    res.type('application/json').status(200).json(errorResponse);
  }
}

export async function handleSseMessagePost(
  req: Request,
  res: Response,
  db: Database.Database | null,
  serverServices: ServerServices | null,
  transports: Record<string, SSETransport>
): Promise<void> {
  logger.info('MCP message received', { method: req.body.method });

  const sessionId = req.query.sessionId as string;
  if (!sessionId) {
    logger.error('No session ID provided in request URL');
    res.status(400).send('Missing sessionId parameter');
    return;
  }

  const transport = transports[sessionId];
  if (!transport) {
    logger.warn('MCP message received for inactive or unknown session', {
      sessionId,
      reason: 'inactive_session',
      method: req.body?.method
    });
    res.status(404).send('Session not found');
    return;
  }

  const message = req.body;
  try {
    const result = await processMcpMessage(message, db, serverServices);
    if (!writeSseJson(transport, result)) {
      res.status(500).json({ error: 'SSE transport invalid' });
      return;
    }
    res.json({ status: 'ok' });
  } catch (error) {
    logger.error('MCP message processing failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    const errorResponse = {
      jsonrpc: '2.0',
      id: message?.id || null,
      error: {
        code: -32603,
        message: 'Internal error',
        data: error instanceof Error ? error.message : 'Unknown error'
      }
    };
    writeSseJson(transport, errorResponse, 'SSE error response send failed');
    res.json({ status: 'error' });
  }
}

function writeSseJson(
  transport: SSETransport,
  payload: unknown,
  errorLogMessage = 'SSE response send failed'
): boolean {
  if (!transport.res || transport.res.writableEnded) {
    logger.error('SSE transport invalid');
    return false;
  }
  try {
    transport.res.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch (error) {
    logger.error(errorLogMessage, {
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}
