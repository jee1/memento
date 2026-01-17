/**
 * MCP 라우터
 * /mcp, /messages 엔드포인트 처리
 * Phase 1.2: http-server.ts 리팩토링
 */

import { Router, type Response } from 'express';
import type Database from 'better-sqlite3';
import type { ServerServices } from '../bootstrap.js';
import type { ToolContext } from '../../tools/types.js';
import { getToolRegistry } from '../../tools/index.js';
import { createToolContext } from '../context.js';
import { logger } from '../../shared/utils/logger.js';
import { DatabaseUtils } from '../../shared/utils/database.js';
import { MemoryNeighborService } from '../../domains/memory/services/memory-neighbor-service.js';
import { getVectorSearchEngine } from '../../domains/search/algorithms/vector-search-engine.js';

/**
 * SSE Transport 타입
 */
export interface SSETransport {
  res: Response;
  sessionId: string;
  keepAliveInterval: NodeJS.Timeout;
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

  // MCP SSE 엔드포인트
  router.get('/mcp', async (req, res) => {
    logger.info('MCP SSE client connection request');

    try {
      // SSE 헤더 설정
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control, Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'X-Accel-Buffering': 'no'
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
      logger.error('No active transport found for session ID', { sessionId });
      res.status(404).send('Session not found');
      return;
    }

    const message = req.body;
    let result: any;

    try {
      if (message.method === 'initialize') {
        logger.info('MCP initialize request processing');
        result = {
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
      } else if (message.method === 'notifications/initialized') {
        logger.info('MCP initialized notification received');
        result = {
          jsonrpc: '2.0',
          id: message.id,
          result: {}
        };
      } else if (message.method === 'tools/list') {
        logger.info('MCP tools/list request processing');
        
        try {
          const toolRegistry = getToolRegistry();
          const tools = toolRegistry.getAll();

          result = {
            jsonrpc: '2.0',
            id: message.id,
            result: { tools }
          };

          // SSE 응답 즉시 전송
          if (transport && transport.res && !transport.res.writableEnded) {
            const sseData = `data: ${JSON.stringify(result)}\n\n`;
            transport.res.write(sseData);
          }

          // HTTP 응답 전송
          res.json({ status: 'ok' });
          return;
        } catch (toolsError) {
          logger.error('tools/list processing error', {
            error: toolsError instanceof Error ? toolsError.message : String(toolsError)
          });
          const errorResult = {
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32603,
              message: 'Internal error',
              data: toolsError instanceof Error ? toolsError.message : String(toolsError)
            }
          };

          if (transport && transport.res && !transport.res.writableEnded) {
            transport.res.write(`data: ${JSON.stringify(errorResult)}\n\n`);
          }
          res.json({ status: 'error' });
          return;
        }
      } else if (message.method === 'tools/call') {
        const { name, arguments: args } = message.params;

        if (!serverServices) {
          result = {
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32603,
              message: 'Internal error',
              data: '서비스가 초기화되지 않았습니다'
            }
          };
        } else {
          // ToolContext 생성 (Phase 0의 공통 모듈 사용)
          const serverContext = {
            db: db!,
            services: serverServices
          };
          const toolContext = createToolContext(serverContext);

          // 도구 실행
          const toolRegistry = getToolRegistry();
          const toolResult = await toolRegistry.execute(name, args, toolContext);

          result = {
            jsonrpc: '2.0',
            id: message.id,
            result: { content: [{ type: 'text', text: JSON.stringify(toolResult) }] }
          };
        }
      } else if (message.method === 'prompts/list') {
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

        result = {
          jsonrpc: '2.0',
          id: message.id,
          result: { prompts }
        };
      } else if (message.method === 'prompts/get') {
        const { name } = message.params;

        if (name === 'memory_injection') {
          result = {
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
        } else {
          result = {
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32601,
              message: 'Prompt not found'
            }
          };
        }
      } else if (message.method === 'prompts/call') {
        const { name, arguments: args } = message.params;

        if (name === 'memory_injection') {
          try {
            if (!serverServices) {
              result = {
                jsonrpc: '2.0',
                id: message.id,
                error: {
                  code: -32603,
                  message: 'Internal error',
                  data: '서비스가 초기화되지 않았습니다'
                }
              };
            } else {
              // MemoryInjectionPrompt 도구 사용
              const toolRegistry = getToolRegistry();
              const serverContext = {
                db: db!,
                services: serverServices
              };
              const toolContext = createToolContext(serverContext);

              const promptResult = await toolRegistry.execute('memory_injection', args, toolContext);

              result = {
                jsonrpc: '2.0',
                id: message.id,
                result: promptResult
              };
            }
          } catch (error) {
            result = {
              jsonrpc: '2.0',
              id: message.id,
              error: {
                code: -32603,
                message: 'Prompt execution failed',
                data: error instanceof Error ? error.message : 'Unknown error'
              }
            };
          }
        } else {
          result = {
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32601,
              message: 'Prompt not found'
            }
          };
        }
      } else if (message.method === 'resources/list') {
        logger.info('MCP resources/list request processing');
        
        if (!db) {
          result = {
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32603,
              message: 'Internal error',
              data: 'Database not initialized'
            }
          };
        } else {
          try {
            // 모든 메모리 ID 조회
            const memories = await DatabaseUtils.all(db, 'SELECT id FROM memory_item ORDER BY created_at DESC LIMIT 1000');
            
            result = {
              jsonrpc: '2.0',
              id: message.id,
              result: {
                resources: memories.map((memory: any) => ({
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
            result = {
              jsonrpc: '2.0',
              id: message.id,
              error: {
                code: -32603,
                message: 'Internal error',
                data: error instanceof Error ? error.message : 'Unknown error'
              }
            };
          }
        }
      } else if (message.method === 'resources/read') {
        logger.info('MCP resources/read request processing', { uri: message.params?.uri });
        
        const { uri } = message.params;
        
        if (!uri) {
          result = {
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32602,
              message: 'Invalid params',
              data: 'URI parameter is required'
            }
          };
        } else if (!db) {
          result = {
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32603,
              message: 'Internal error',
              data: 'Database not initialized'
            }
          };
        } else {
          try {
            // URI 파싱: memory://{id}?include_neighbors=true
            const uriMatch = uri.match(/^memory:\/\/([^?]+)(\?.*)?$/);
            if (!uriMatch) {
              result = {
                jsonrpc: '2.0',
                id: message.id,
                error: {
                  code: -32602,
                  message: 'Invalid params',
                  data: `Invalid resource URI: ${uri}`
                }
              };
            } else {
              const memoryId = uriMatch[1];
              if (!memoryId) {
                result = {
                  jsonrpc: '2.0',
                  id: message.id,
                  error: {
                    code: -32602,
                    message: 'Invalid params',
                    data: `Invalid memory ID in URI: ${uri}`
                  }
                };
              } else {
                const queryString = uriMatch[2] || '';
                const includeNeighbors = queryString.includes('include_neighbors=true');
                
                // 메모리 조회
                const memory = await DatabaseUtils.get(
                  db,
                  'SELECT id, type, content, importance, privacy_scope, tags, source, created_at, last_accessed, pinned FROM memory_item WHERE id = ?',
                  [memoryId]
                );
                
                if (!memory) {
                  result = {
                    jsonrpc: '2.0',
                    id: message.id,
                    error: {
                      code: -32602,
                      message: 'Invalid params',
                      data: `Memory not found: ${memoryId}`
                    }
                  };
                } else {
                  // 메모리 데이터 구성
                  const memoryData: any = {
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
                  
                  // 이웃 기억 포함 여부 확인
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
                          serverServices.embeddingService
                        );
                        neighborService.setDatabase(db);
                        
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
                  
                  result = {
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
                }
              }
            }
          } catch (error) {
            logger.error('resources/read processing error', {
              error: error instanceof Error ? error.message : String(error)
            });
            result = {
              jsonrpc: '2.0',
              id: message.id,
              error: {
                code: -32603,
                message: 'Internal error',
                data: error instanceof Error ? error.message : 'Unknown error'
              }
            };
          }
        }
      } else {
        result = {
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32601,
            message: 'Method not found'
          }
        };
      }

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

