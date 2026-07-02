import {
  createToolContext,
  executeTool,
  getToolRegistry,
  logger,
  type ServerServices,
} from '@memento/core';
import type Database from 'better-sqlite3';
import type { WebSocket } from 'ws';
import type { WebSocketServer } from 'ws';

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
): void {
  wss.on('connection', (ws: WebSocket) => {
    logger.info('WebSocket 클라이언트 연결됨');

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
          const toolRegistry = getToolRegistry();
          const tools = toolRegistry.getAll();
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

          const context = createToolContext(db, serverServices);
          const result = await executeTool(name, args, context);
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: { content: [{ type: 'text', text: JSON.stringify(result) }] },
          }));
        }
      } catch (error) {
        logger.error('WebSocket 메시지 처리 실패', { error });
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
            code: -32603,
            message: 'Internal error',
            data: error instanceof Error ? error.message : 'Unknown error',
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
