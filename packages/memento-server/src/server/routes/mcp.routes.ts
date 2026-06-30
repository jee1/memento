/**
 * MCP 라우터
 * /mcp, /messages 엔드포인트 처리
 * Phase 1.2: http-server.ts 리팩토링
 */

import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { ServerServices } from '../bootstrap.js';
import {
  getToolRegistry,
  executeTool,
  createToolContext,
  logger,
  DatabaseUtils,
  MemoryNeighborService,
  getVectorSearchEngine,
  mementoConfig
} from '@memento/core';
import { buildMcpManualCorsHeaders } from '../utils/cors-policy.js';
import { mapToolExecutionErrorToJsonRpc } from '../utils/mcp-tool-call-error.js';

/**
 * SSE Transport 타입
 */
export interface SSETransport {
  res: Response;
  sessionId: string;
  keepAliveInterval: NodeJS.Timeout;
}

type McpRequestMessage = {
  id?: unknown;
  method?: string;
  params?: Record<string, unknown>;
};

type MemoryResourceListRow = {
  id: string;
};

type MemoryResourceData = {
  id: string;
  type: string;
  content: string;
  importance: number;
  privacy_scope: string;
  tags: unknown[];
  source: string | null;
  created_at: string;
  last_accessed: string | null;
  pinned: boolean;
  neighbors?: unknown[];
  neighbors_count?: number;
  neighbors_query_time?: number;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

function isJsonRpcNotification(message: McpRequestMessage): boolean {
  return message.id === undefined;
}

function isInitializeRequest(message: McpRequestMessage): boolean {
  return message.method === 'initialize';
}

function createJsonRpcError(
  id: unknown,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data })
    }
  };
}

async function processMcpMessage(
  message: McpRequestMessage,
  db: Database.Database | null,
  serverServices: ServerServices | null
): Promise<JsonRpcResponse> {
  if (message.method === 'initialize') {
    logger.info('MCP initialize request processing');
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: 'memento-memory',
          version: '0.1.0'
        }
      }
    };
  }

  if (message.method === 'notifications/initialized') {
    logger.info('MCP initialized notification received');
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {}
    };
  }

  if (message.method === 'tools/list') {
    logger.info('MCP tools/list request processing');

    try {
      const toolRegistry = getToolRegistry();
      const tools = toolRegistry.getAll();

      return {
        jsonrpc: '2.0',
        id: message.id,
        result: { tools }
      };
    } catch (toolsError) {
      logger.error('tools/list processing error', {
        error: toolsError instanceof Error ? toolsError.message : String(toolsError)
      });
      return createJsonRpcError(
        message.id,
        -32603,
        'Internal error',
        toolsError instanceof Error ? toolsError.message : String(toolsError)
      );
    }
  }

  if (message.method === 'tools/call') {
    const { name, arguments: args } = message.params ?? {};

    if (typeof name !== 'string') {
      return createJsonRpcError(message.id, -32602, 'Invalid params', 'Tool name is required');
    }

    if (!serverServices) {
      return createJsonRpcError(message.id, -32603, 'Internal error', '서비스가 초기화되지 않았습니다');
    }

    const serverContext = {
      db: db!,
      services: serverServices
    };
    const toolContext = createToolContext(serverContext);
    try {
      const toolResult = await executeTool(name, args, toolContext);

      return {
        jsonrpc: '2.0',
        id: message.id,
        result: { content: [{ type: 'text', text: JSON.stringify(toolResult) }] }
      };
    } catch (error) {
      const mapped = mapToolExecutionErrorToJsonRpc(error);
      if (mapped) {
        logger.warn('MCP tools/call rejected invalid params', { tool: name, error: mapped.data });
        return createJsonRpcError(message.id, mapped.code, mapped.message, mapped.data);
      }
      throw error;
    }
  }

  if (message.method === 'prompts/list') {
    logger.info('MCP prompts/list request processing');

    const prompts = [
      {
        name: 'memory_injection',
        description: '관련 기억을 요약하여 프롬프트에 주입',
        arguments: [
          {
            name: 'query',
            description: '검색할 쿼리',
            required: true
          },
          {
            name: 'token_budget',
            description: '토큰 예산 (기본값: 1000)',
            required: false
          },
          {
            name: 'max_memories',
            description: '최대 기억 개수 (기본값: 5)',
            required: false
          }
        ]
      }
    ];

    return {
      jsonrpc: '2.0',
      id: message.id,
      result: { prompts }
    };
  }

  if (message.method === 'prompts/get') {
    const { name } = message.params ?? {};

    if (name === 'memory_injection') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          description: '관련 기억을 요약하여 프롬프트에 주입',
          arguments: [
            {
              name: 'query',
              description: '검색할 쿼리',
              required: true
            },
            {
              name: 'token_budget',
              description: '토큰 예산 (기본값: 1000)',
              required: false
            },
            {
              name: 'max_memories',
              description: '최대 기억 개수 (기본값: 5)',
              required: false
            }
          ]
        }
      };
    }

    return createJsonRpcError(message.id, -32601, 'Prompt not found');
  }

  if (message.method === 'prompts/call') {
    const { name, arguments: args } = message.params ?? {};

    if (name === 'memory_injection') {
      try {
        if (!serverServices) {
          return createJsonRpcError(message.id, -32603, 'Internal error', '서비스가 초기화되지 않았습니다');
        }

        const serverContext = {
          db: db!,
          services: serverServices
        };
        const toolContext = createToolContext(serverContext);
        const promptResult = await executeTool('memory_injection', args, toolContext);

        return {
          jsonrpc: '2.0',
          id: message.id,
          result: promptResult
        };
      } catch (error) {
        return createJsonRpcError(
          message.id,
          -32603,
          'Prompt execution failed',
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    }

    return createJsonRpcError(message.id, -32601, 'Prompt not found');
  }

  if (message.method === 'resources/list') {
    logger.info('MCP resources/list request processing');

    if (!db) {
      return createJsonRpcError(message.id, -32603, 'Internal error', 'Database not initialized');
    }

    try {
      const memories = await DatabaseUtils.all(db, 'SELECT id FROM memory_item ORDER BY created_at DESC LIMIT 1000') as MemoryResourceListRow[];

      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          resources: memories.map((memory) => ({
            uri: `memory://${memory.id}`,
            name: `Memory ${memory.id}`,
            description: `Memory item with ID: ${memory.id}`,
            mimeType: 'application/json'
          }))
        }
      };
    } catch (error) {
      logger.error('resources/list processing error', {
        error: error instanceof Error ? error.message : String(error)
      });
      return createJsonRpcError(
        message.id,
        -32603,
        'Internal error',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  if (message.method === 'resources/read') {
    logger.info('MCP resources/read request processing', { uri: message.params?.uri });

    const { uri } = message.params ?? {};

    if (typeof uri !== 'string' || uri.length === 0) {
      return createJsonRpcError(message.id, -32602, 'Invalid params', 'URI parameter is required');
    }

    if (!db) {
      return createJsonRpcError(message.id, -32603, 'Internal error', 'Database not initialized');
    }

    try {
      const uriMatch = uri.match(/^memory:\/\/([^?]+)(\?.*)?$/);
      if (!uriMatch) {
        return createJsonRpcError(message.id, -32602, 'Invalid params', `Invalid resource URI: ${uri}`);
      }

      const memoryId = uriMatch[1];
      if (!memoryId) {
        return createJsonRpcError(message.id, -32602, 'Invalid params', `Invalid memory ID in URI: ${uri}`);
      }

      const queryString = uriMatch[2] || '';
      const includeNeighbors = queryString.includes('include_neighbors=true');
      type MemoryResourceRow = {
        id: string;
        type: string;
        content: string;
        importance: number;
        privacy_scope: string;
        tags: string | null;
        source: string | null;
        created_at: string;
        last_accessed: string | null;
        pinned: number | boolean;
      };
      const memory = DatabaseUtils.get(
        db,
        'SELECT id, type, content, importance, privacy_scope, tags, source, created_at, last_accessed, pinned FROM memory_item WHERE id = ?',
        [memoryId]
      ) as MemoryResourceRow | undefined;

      if (!memory) {
        return createJsonRpcError(message.id, -32602, 'Invalid params', `Memory not found: ${memoryId}`);
      }

      const memoryData: MemoryResourceData = {
        id: memory.id,
        type: memory.type,
        content: memory.content,
        importance: memory.importance,
        privacy_scope: memory.privacy_scope,
        tags: memory.tags ? JSON.parse(memory.tags) : [],
        source: memory.source,
        created_at: memory.created_at,
        last_accessed: memory.last_accessed,
        pinned: memory.pinned === 1
      };

      if (includeNeighbors) {
        try {
          if (!serverServices) {
            logger.warn('Server services not available for neighbor search');
            memoryData.neighbors = [];
            memoryData.neighbors_count = 0;
          } else {
            const vectorSearchEngine = getVectorSearchEngine();
            const neighborService = new MemoryNeighborService(
              vectorSearchEngine,
              serverServices.embeddingService,
              db
            );

            const neighborsResult = await neighborService.getNeighbors(memoryId, {
              limit: 5,
              similarity_threshold: 0.8
            });

            memoryData.neighbors = neighborsResult.neighbors;
            memoryData.neighbors_count = neighborsResult.total_count;
            memoryData.neighbors_query_time = neighborsResult.query_time;
          }
        } catch (error) {
          logger.warn('Neighbor search failed', {
            error: error instanceof Error ? error.message : String(error)
          });
          memoryData.neighbors = [];
          memoryData.neighbors_count = 0;
        }
      }

      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(memoryData, null, 2)
            }
          ]
        }
      };
    } catch (error) {
      logger.error('resources/read processing error', {
        error: error instanceof Error ? error.message : String(error)
      });
      return createJsonRpcError(
        message.id,
        -32603,
        'Internal error',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  return createJsonRpcError(message.id, -32601, 'Method not found');
}

/**
 * MCP 라우터 생성
 */
export function createMcpRouter(
  db: Database.Database | null,
  serverServices: ServerServices | null,
  transports: Record<string, SSETransport>
): Router {
  const router = Router();

  const applyMcpCorsHeaders = (req: Request, res: Response): void => {
    const origin = req.get('origin') ?? undefined;
    const headers = buildMcpManualCorsHeaders(origin, mementoConfig.corsAllowedOrigins);
    for (const [key, value] of Object.entries(headers)) {
      res.setHeader(key, value);
    }
  };

  const sendMcpCorsPreflight = (req: Request, res: Response): void => {
    applyMcpCorsHeaders(req, res);
    res.status(204).end();
  };
  router.options('/mcp', sendMcpCorsPreflight);
  router.options('/messages', sendMcpCorsPreflight);

  // MCP SSE 엔드포인트
  router.get('/mcp', async (req, res) => {
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
      // SSE 헤더 설정 (CORS_ALLOWED_ORIGINS와 정합; 비어 있으면 ACAO 미설정)
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...manualCors
      });

      // 세션 ID 생성
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // 엔드포인트 이벤트 전송
      const endpointUrl = `/messages?sessionId=${sessionId}`;
      res.write(`event: endpoint\ndata: ${endpointUrl}\n\n`);

      // MCP 서버 준비 완료 알림
      res.write(`data: {"type": "ready"}\n\n`);

      // Keep-alive ping 전송
      const keepAliveInterval = setInterval(() => {
        if (res.writableEnded) {
          clearInterval(keepAliveInterval);
          return;
        }
        try {
          res.write(`data: {"type": "ping"}\n\n`);
        } catch (error) {
          clearInterval(keepAliveInterval);
        }
      }, 30000); // 30초마다 ping

      // Transport 정보 저장
      transports[sessionId] = {
        res: res,
        sessionId: sessionId,
        keepAliveInterval: keepAliveInterval
      };

      // 연결 종료 처리
      req.on('close', () => {
        logger.info('MCP SSE client connection closed', { sessionId });
        clearInterval(keepAliveInterval);
        delete transports[sessionId];
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
        clearInterval(keepAliveInterval);
        delete transports[sessionId];
      });

      logger.info('MCP SSE stream setup completed', { sessionId });
      return;
    } catch (error) {
      logger.error('SSE stream setup failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      if (!res.headersSent) {
        res.status(500).send('Error establishing SSE stream');
      }
      return;
    }
  });

  router.post('/mcp', async (req, res) => {
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
  });

  // Messages 엔드포인트 (JSON-RPC 요청 수신)
  router.post('/messages', async (req, res) => {
    logger.info('MCP message received', { method: req.body.method });

    // 세션 ID 추출
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

      // SSE 응답 전송
      try {
        if (!transport || !transport.res || transport.res.writableEnded) {
          logger.error('SSE transport invalid');
          res.status(500).json({ error: 'SSE transport invalid' });
          return;
        }

        const sseData = `data: ${JSON.stringify(result)}\n\n`;
        transport.res.write(sseData);
      } catch (sseError) {
        logger.error('SSE response send failed', {
          error: sseError instanceof Error ? sseError.message : String(sseError)
        });
      }

      // HTTP 응답 전송
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

      // SSE 에러 응답 전송
      try {
        if (transport && transport.res && !transport.res.writableEnded) {
          const errorSseData = `data: ${JSON.stringify(errorResponse)}\n\n`;
          transport.res.write(errorSseData);
        }
      } catch (errorSseError) {
        logger.error('SSE error response send failed', {
          error: errorSseError instanceof Error ? errorSseError.message : String(errorSseError)
        });
      }

      // HTTP 응답 전송
      res.json({ status: 'error' });
    }
  });

  return router;
}
