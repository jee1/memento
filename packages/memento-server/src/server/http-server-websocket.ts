import {
  getExposedTools,
  logger,
  type ServerServices,
} from '@memento/core';
import type Database from 'better-sqlite3';
import type { IncomingMessage } from 'http';
import type { VerifyClientCallbackAsync, WebSocket } from 'ws';
import type { WebSocketServer } from 'ws';
import { dispatchTool, mapToolDispatchError } from './audit-tool-dispatch.js';
import { hasScope, type ApiTokenRegistry } from './auth/api-token-registry.js';
import type { SessionStore } from './auth/session-store.js';
import { recordWebSocketRequestAudit } from './middleware/http-audit.middleware.js';
import { resolveAuthenticatedToken } from './middleware/programmatic-auth.middleware.js';
import { DASHBOARD_SESSION_COOKIE_NAME, readCookie } from './middleware/session-auth.middleware.js';

export type WebSocketAuthConfig = {
  getSessionStore: () => SessionStore | null;
  getTokenRegistry: () => ApiTokenRegistry;
  allowedOrigins: readonly string[];
};

/** 브라우저 Origin 이 이 서버(Host) 자신이거나 CORS 허용 목록에 있는가. */
function isTrustedOrigin(origin: string | undefined, req: IncomingMessage, allowed: readonly string[]): boolean {
  if (!origin) return false;
  if (allowed.includes(origin)) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/**
 * WebSocket 업그레이드 인증. WebSocket 핸드셰이크는 CORS 를 받지 않으므로 여기서 막지 않으면
 * 사용자가 연 아무 웹페이지가 tools/call 을 실행할 수 있다.
 * - 프로그램 클라이언트: HTTP 와 같은 API 토큰(tools:invoke, Authorization 또는 X-API-Key)
 * - 대시보드: 세션 쿠키 + 이 서버 또는 허용 목록의 Origin
 */
export function createWebSocketVerifyClient(config: WebSocketAuthConfig): VerifyClientCallbackAsync {
  return ({ origin, req }, done) => {
    const registry = config.getTokenRegistry();
    if (registry.hasConfiguredTokens()) {
      const token = resolveAuthenticatedToken(req, registry);
      if (token) {
        done(hasScope(token.scopes, 'tools:invoke'), 403);
        return;
      }
    }

    const sessionId = readCookie(req.headers.cookie, DASHBOARD_SESSION_COOKIE_NAME);
    const session = sessionId ? config.getSessionStore()?.touch(sessionId) : null;
    if (!session) {
      done(false, 401);
      return;
    }
    done(isTrustedOrigin(origin, req, config.allowedOrigins), 403);
  };
}

interface WebSocketMessage {
  method?: string;
  params?: Record<string, unknown>;
  id?: string | number;
  type?: string;
  [key: string]: unknown;
}

export function setupWebSocketServer(
  wss: WebSocketServer,
  anchorMapSubscribers: Map<string, Set<WebSocket>>,
  getDb: () => Database.Database | null,
  getServerServices: () => ServerServices | null,
  getBoundAgentId: (req: IncomingMessage) => string | undefined = () => undefined,
): void {
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const boundAgentId = getBoundAgentId(req);
    logger.info('WebSocket 클라이언트 연결됨');
    const connectionDb = getDb();
    if (connectionDb) recordWebSocketRequestAudit(connectionDb);

    ws.on('message', async (data) => {
      let message: WebSocketMessage;
      try {
        message = JSON.parse(data.toString()) as WebSocketMessage;

        if (message.method === 'subscribe' && message.params?.type === 'anchor_map_updates') {
          const agentId = typeof message.params.agent_id === 'string' ? message.params.agent_id : 'default';
          if (!anchorMapSubscribers.has(agentId)) {
            anchorMapSubscribers.set(agentId, new Set<WebSocket>());
          }
          anchorMapSubscribers.get(agentId)!.add(ws);
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: { subscribed: true, agent_id: agentId },
          }));
          logger.info('Anchor Map 업데이트 구독', { agent_id: agentId });
          return;
        }

        if (message.type === 'pong') return;

        if (message.method === 'tools/list') {
          const tools = getExposedTools();
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: { tools },
          }));
        } else if (message.method === 'tools/call') {
          const params = message.params as { name?: string; arguments?: unknown } | undefined;
          const name = params?.name;
          const args = params?.arguments;

          if (!name) {
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              id: message.id,
              error: { code: -32602, message: 'Invalid params', data: 'name parameter is required' },
            }));
            return;
          }

          const serverServices = getServerServices();
          if (!serverServices) {
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              id: message.id,
              error: { code: -32603, message: 'Internal error', data: '서비스가 초기화되지 않았습니다' },
            }));
            return;
          }

          const db = getDb();
          if (!db) {
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              id: message.id,
              error: { code: -32603, message: 'Internal error', data: '데이터베이스가 초기화되지 않았습니다' },
            }));
            return;
          }

          const result = await dispatchTool(name, args, db, serverServices, { transport: 'mcp_ws', agentId: boundAgentId, boundAgentId });
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result,
          }));
        }
      } catch (error) {
        logger.error('WebSocket 메시지 처리 실패', { error });
        const mapped = mapToolDispatchError(error);
        let messageId: string | number | null = null;
        try {
          const parsedMessage = JSON.parse(data.toString()) as { id?: string | number };
          messageId = parsedMessage.id || null;
        } catch {
          // 파싱 실패 시 null 사용
        }
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: messageId,
          error: {
            code: mapped.code,
            message: mapped.protocolMessage,
            data: mapped.data,
          },
        }));
      }
    });

    ws.on('close', () => {
      logger.info('WebSocket 클라이언트 연결 해제됨');
      for (const [agentId, subscribers] of anchorMapSubscribers.entries()) {
        subscribers.delete(ws);
        if (subscribers.size === 0) anchorMapSubscribers.delete(agentId);
      }
    });

    ws.on('error', (error) => {
      logger.error('WebSocket 에러', { error });
    });
  });
}
