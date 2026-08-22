/**
 * Tools 라우터
 * /tools/* 엔드포인트 처리
 * Phase 1.2: http-server.ts 리팩토링
 */

import { getExposedTools, logger } from '@memento/core';
import type Database from 'better-sqlite3';
import { Router } from 'express';
import type { WebSocket } from 'ws';
import type { ServerServices } from '../bootstrap.js';
import { broadcastAnchorMapUpdate } from '../handlers/anchor-map.handler.js';
import { extractToolResultPayload } from '../handlers/tool-result.utils.js';
import { dispatchTool, mapToolDispatchError } from '../audit-tool-dispatch.js';

function httpStatusForToolError(code: number): number {
  if (code === -32602) return 400;
  if (code === -32601) return 404;
  return 500;
}

/**
 * Tools 라우터 생성
 */

export function createToolsRouter(
  db: Database.Database,
  serverServices: ServerServices | null,
  anchorMapSubscribers: Map<string, Set<WebSocket>>
): Router {
  const router = Router();

  // 도구 목록 조회
  router.get('/', (req, res) => {
    try {
      const tools = getExposedTools();
      res.json({
        tools,
        count: tools.length,
        server: 'Memento MCP Server'
      });
    } catch (error) {
      logger.error('Tool list retrieval failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({
        error: 'Failed to get tools',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // 도구 실행
  router.post('/:name', async (req, res) => {
    const { name } = req.params;
    const params = req.body;

    try {
      // Phase 0: 미들웨어에서 주입된 ToolContext 사용
      if (!req.toolContext || !serverServices) {
        return res.status(500).json({
          error: 'ToolContext not initialized',
          message: 'ToolContext가 초기화되지 않았습니다. tool-context 미들웨어를 먼저 적용하세요.'
        });
      }

      // 도구 실행
      const toolResult = await dispatchTool(name, params, db, serverServices, {
        transport: 'rest',
        actorId: req.programmaticAuth?.keyId,
        agentId: req.toolContext.agentId,
      });

      const actualResult = extractToolResultPayload(toolResult);

      // 앵커 관련 도구 실행 후 WebSocket 브로드캐스트
      if (name === 'set_anchor' || name === 'clear_anchor') {
        const agentId = params.agent_id || 'default';
        // 비동기로 브로드캐스트 (응답 지연 방지)
        setImmediate(() => {
          broadcastAnchorMapUpdate(db, serverServices, anchorMapSubscribers, agentId).catch(error => {
            logger.error('Anchor Map broadcast failed', {
              error: error instanceof Error ? error.message : String(error)
            });
          });
        });
      }

      return res.json({
        result: actualResult,
        tool: name,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      const mapped = mapToolDispatchError(error);
      logger.error('Tool execution failed', {
        tool: name,
        code: mapped.code,
        error: mapped.data,
      });
      return res.status(httpStatusForToolError(mapped.code)).json({
        error: mapped.protocolMessage,
        code: mapped.code,
        tool: name,
        message: typeof mapped.data === 'string' ? mapped.data : mapped.protocolMessage,
      });
    }
  });

  return router;
}
