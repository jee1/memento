import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { startInterval } from '../../../infrastructure/scheduler/interval.js';
import type { ServerServices } from '../../bootstrap.js';
import {
  isLegacyMcpServiceEnabled,
  isModernMcpServiceEnabled,
  logger,
  mementoConfig,
} from '@memento/core';
import { exemptFromAuditChain } from '../../middleware/http-audit.middleware.js';
import { buildMcpManualCorsHeaders } from '../../utils/cors-policy.js';
import { createJsonRpcError, isInitializeRequest, isJsonRpcNotification } from './json-rpc.js';
import {
  getDiscoverSupportedVersions,
  processMcpMessage,
} from './message-processor.js';
import {
  hasModernProtocolClaim,
  isJsonRpcRequestObject,
  mapModernJsonRpcErrorHttpStatus,
  validateModernRequest,
} from './modern-request-validation.js';
import { applyModernSuccessEnvelope } from './modern-response.js';
import type { ToolAuditContext } from '../../audit-tool-dispatch.js';
import { mcpClientSessions, readClientInfo } from '../../mcp-client-sessions.js';
import { CLIENT_INFO_META_KEY, countConnectionSignal, type UsageConnection } from '../../usage-recording.js';
import { readProjectIdHeader } from '../../utils/project-id-header.js';
import type { JsonRpcResponse, SSETransport } from './types.js';

function applyMcpCorsHeaders(req: Request, res: Response): void {
  const origin = req.get('origin') ?? undefined;
  const headers = buildMcpManualCorsHeaders(origin, mementoConfig.corsAllowedOrigins);
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
}

/**
 * 이 요청이 어느 클라이언트에서 어떤 길로 왔는지 (#1768).
 * 새 방식은 요청마다 `_meta` 에 clientInfo 가 실려 오고(Claude Code 실측), 옛 방식은 `initialize` 때 기억해 둔
 * 세션(streamable 은 `mcp-session-id` 헤더, SSE 는 쿼리 `sessionId`)으로 찾는다.
 */
function resolveHttpUsageConnection(
  req: Request,
  message: unknown,
  options: { modern: boolean; sse: boolean; sessionId?: string },
): UsageConnection {
  const connectionMethod = options.sse ? 'http-sse' : 'http-streamable';
  if (options.modern) {
    const meta = (message as { params?: { _meta?: Record<string, unknown> } } | null)?.params?._meta;
    const info = readClientInfo(meta?.[CLIENT_INFO_META_KEY]);
    return { connectionMethod, era: 'modern', clientName: info?.name, clientVersion: info?.version };
  }
  // initialize 요청 자신에는 세션 헤더가 없으므로(서버가 응답에서 처음 준다) 호출한 쪽이 방금 정한 ID 를 넘긴다.
  const sessionId =
    options.sessionId ?? (options.sse ? (req.query.sessionId as string | undefined) : req.get('mcp-session-id'));
  const info = mcpClientSessions.recall(sessionId);
  return { connectionMethod, era: 'legacy', clientName: info?.name, clientVersion: info?.version };
}

/** initialize, tools/list 는 연결 신호로 센다. 새 방식에는 initialize 가 없어 tools/list 가 「붙었다」의 대용이다. */
function countHttpConnectionSignal(db: Database.Database, method: unknown, usage: UsageConnection): void {
  if (method === 'initialize' || method === 'tools/list') {
    countConnectionSignal(db, usage, method);
  }
}

function buildMcpHttpAuditContext(req: Request, usage?: UsageConnection): ToolAuditContext {
  return {
    transport: 'mcp_http',
    ...(usage ? { usage } : {}),
    actorId: req.programmaticAuth?.keyId,
    scopes: req.programmaticAuth?.scopes,
    agentId: req.programmaticAuth?.agentId ?? req.get('x-memento-agent-id') ?? req.get('x-agent-id'),
    boundAgentId: req.programmaticAuth?.agentId,
    boundProjectId: req.programmaticAuth?.projectId,
    projectId: req.programmaticAuth?.projectId ?? readProjectIdHeader(req),
  };
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
    sendModernHttpMethodNotAllowed(res);
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

    const keepAliveInterval = startInterval(() => {
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
    mcpClientSessions.forget(sessionId);
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

function sendLegacyJsonRpc(res: Response, payload: JsonRpcResponse): void {
  res.type('application/json').status(200).json(payload);
}

function sendModernJsonRpc(res: Response, payload: JsonRpcResponse): void {
  const httpStatus = payload.error
    ? mapModernJsonRpcErrorHttpStatus(payload.error.code)
    : 200;
  res.type('application/json').status(httpStatus).json(payload);
}

function resolveJsonRpcRequestId(body: unknown): unknown {
  if (isJsonRpcRequestObject(body) && Object.prototype.hasOwnProperty.call(body, 'id')) {
    return body.id ?? null;
  }
  return null;
}

function sendInvalidJsonRpcBody(req: Request, res: Response, body: unknown): void {
  const modernPath = isModernProtocolHttpRequest(req) || hasModernProtocolClaim(body);
  const id = resolveJsonRpcRequestId(body);

  if (modernPath) {
    sendModernJsonRpc(
      res,
      createJsonRpcError(id, -32602, 'Invalid params: request body must be a JSON-RPC object'),
    );
    return;
  }

  sendLegacyJsonRpc(res, createJsonRpcError(id, -32600, 'Invalid Request'));
}

function sendModernHttpMethodNotAllowed(res: Response): void {
  exemptFromAuditChain(res);
  res.setHeader('Allow', 'POST');
  res.status(405).end();
}

function isModernProtocolHttpRequest(req: Request): boolean {
  return Boolean(req.get('mcp-protocol-version'));
}

export async function handleMcpModernMethodNotAllowed(
  req: Request,
  res: Response
): Promise<void> {
  applyMcpCorsHeaders(req, res);
  if (!isModernProtocolHttpRequest(req)) {
    res.status(404).end();
    return;
  }
  sendModernHttpMethodNotAllowed(res);
}

export async function handleStreamableMcpPost(
  req: Request,
  res: Response,
  db: Database.Database | null,
  serverServices: ServerServices | null
): Promise<void> {
  applyMcpCorsHeaders(req, res);

  const body = req.body;
  if (!isJsonRpcRequestObject(body)) {
    sendInvalidJsonRpcBody(req, res, body);
    return;
  }

  const message = body;
  logger.info('MCP streamable_http request received', { method: message.method });
  const notificationOnly = isJsonRpcNotification(message);
  const modernClaim = hasModernProtocolClaim(message);
  const eraMode = mementoConfig.mcpEra;

  if (modernClaim) {
    if (!isModernMcpServiceEnabled(eraMode)) {
      const unsupported = createJsonRpcError(message.id ?? null, -32022, 'Unsupported protocol version', {
        supported: getDiscoverSupportedVersions(),
      });
      if (notificationOnly) {
        res.status(400).end();
        return;
      }
      sendModernJsonRpc(res, unsupported);
      return;
    }

    const validationFailure = validateModernRequest(req, message, getDiscoverSupportedVersions());
    if (validationFailure) {
      if (notificationOnly) {
        res.status(validationFailure.httpStatus).end();
        return;
      }
      sendModernJsonRpc(res, validationFailure.response);
      return;
    }
  } else if (!isLegacyMcpServiceEnabled(eraMode)) {
    const errorResponse = createJsonRpcError(message.id ?? null, -32601, 'Method not found');
    if (notificationOnly) {
      res.status(404).end();
      return;
    }
    sendModernJsonRpc(res, errorResponse);
    return;
  }

  let legacySessionId = req.get('mcp-session-id') ?? undefined;
  if (!modernClaim && isInitializeRequest(message) && !legacySessionId) {
    legacySessionId = randomUUID();
    res.setHeader('mcp-session-id', legacySessionId);
  }

  try {
    if (!modernClaim && isInitializeRequest(message)) {
      mcpClientSessions.remember(legacySessionId, (message.params as { clientInfo?: unknown } | undefined)?.clientInfo);
    }
    const usage = resolveHttpUsageConnection(req, message, { modern: modernClaim, sse: false, sessionId: legacySessionId });
    const auditContext = buildMcpHttpAuditContext(req, usage);
    const result = await processMcpMessage(message, db, serverServices, auditContext, {
      modernEra: modernClaim,
    });
    // 연결 신호는 처리가 오류 없이 끝난 요청만 센다(거부된 요청이 연결로 세이지 않게).
    if (db && !result.error) countHttpConnectionSignal(db, message.method, usage);
    if (notificationOnly) {
      res.status(202).end();
      return;
    }

    if (modernClaim) {
      sendModernJsonRpc(res, applyModernSuccessEnvelope(result, message.method));
      return;
    }

    sendLegacyJsonRpc(res, result);
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
    if (modernClaim) {
      sendModernJsonRpc(res, errorResponse);
      return;
    }
    sendLegacyJsonRpc(res, errorResponse);
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
    // SSE 연결에서는 initialize 도 메시지 POST 로 온다. 세션 ID 는 쿼리의 sessionId 다.
    if (isInitializeRequest(message)) {
      mcpClientSessions.remember(sessionId, (message.params as { clientInfo?: unknown } | undefined)?.clientInfo);
    }
    const usage = resolveHttpUsageConnection(req, message, { modern: false, sse: true });
    const auditContext = buildMcpHttpAuditContext(req, usage);
    const result = await processMcpMessage(message, db, serverServices, auditContext);
    if (db && !result.error) countHttpConnectionSignal(db, message?.method, usage);
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
