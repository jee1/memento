import { getExposedTools, type ServerServices } from '@memento/core';
import { Server, type ListToolsResult } from '@modelcontextprotocol/server';
import type Database from 'better-sqlite3';
import packageJson from '../../package.json' with { type: 'json' };
import { dispatchTool } from './audit-tool-dispatch.js';

export const MEMENTO_SERVER_INSTRUCTIONS = `Memento MCP provides persistent memory for AI agents (recall, remember, feedback, memory_injection, search_local, anchors, extract_triples).`;

export interface McpServerFactoryDeps {
  /** resolved once heavy init finishes; handlers await it before touching db/services */
  readyPromise: Promise<unknown>;
  getDb: () => Database.Database | null;
  getServices: () => ServerServices | null;
}

/**
 * SDK v2 저수준 {@link Server} 인스턴스를 구성한다.
 * legacy·modern dual-era를 동일 팩토리로 서빙하며, `serveStdio`는 연결당 하나의 인스턴스를 고정한다 (issue 1110).
 */
export function createMementoMcpServer(deps: McpServerFactoryDeps): Server {
  const server = new Server(
    { name: 'memento-mcp-server', version: packageJson.version },
    {
      capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} },
      instructions: MEMENTO_SERVER_INSTRUCTIONS,
    },
  );

  // getExposedTools()는 registry 항목을 그대로 반환하며 handler·Zod inputSchema가 남아 있다.
  // HTTP modern 경로(routes/mcp/message-processor.ts 243행)도 동일 객체를 내보내므로,
  // 여기서 형태를 좁히면 stdio/HTTP parity가 깨진다. 의도적 캐스트이며 객체 매핑으로 "수정" 금지.
  server.setRequestHandler('tools/list', async (): Promise<ListToolsResult> => ({
    tools: getExposedTools() as unknown as ListToolsResult['tools'],
  }));

  server.setRequestHandler('tools/call', async (request) => {
    await deps.readyPromise;
    const db = deps.getDb();
    const services = deps.getServices();
    if (!db || !services) throw new Error('Server not initialized');

    return dispatchTool(
      request.params.name,
      request.params.arguments,
      db,
      services,
      { transport: 'mcp_stdio' },
    );
  });

  server.setRequestHandler('resources/list', async () => ({ resources: [] }));
  server.setRequestHandler('resources/read', async () => { throw new Error('Not implemented'); });
  server.setRequestHandler('prompts/list', async () => ({ prompts: [] }));
  server.setRequestHandler('prompts/get', async () => { throw new Error('Not implemented'); });

  return server;
}
