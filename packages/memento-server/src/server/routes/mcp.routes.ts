import { Router } from 'express';
import type Database from 'better-sqlite3';
import type { ServerServices } from '../bootstrap.js';
import {
  handleMcpModernMethodNotAllowed,
  handleMcpSseConnection,
  handleSseMessagePost,
  handleStreamableMcpPost,
  sendMcpCorsPreflight
} from './mcp/handlers.js';
import type { SSETransport } from './mcp/types.js';

export type { SSETransport } from './mcp/types.js';

/**
 * MCP 라우터 생성
 */
export function createMcpRouter(
  db: Database.Database | null,
  serverServices: ServerServices | null,
  transports: Record<string, SSETransport>
): Router {
  const router = Router();

  router.options('/mcp', sendMcpCorsPreflight);
  router.options('/messages', sendMcpCorsPreflight);
  router.get('/mcp', (req, res) => void handleMcpSseConnection(req, res, transports));
  router.delete('/mcp', (req, res) => void handleMcpModernMethodNotAllowed(req, res));
  router.post('/mcp', (req, res) => void handleStreamableMcpPost(req, res, db, serverServices));
  router.post('/messages', (req, res) =>
    void handleSseMessagePost(req, res, db, serverServices, transports)
  );

  return router;
}
