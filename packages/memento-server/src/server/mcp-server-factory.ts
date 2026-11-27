import { getExposedTools, type ServerServices } from '@memento/core';
import { Server, type ListToolsResult } from '@modelcontextprotocol/server';
import type Database from 'better-sqlite3';
import packageJson from '../../package.json' with { type: 'json' };
import { dispatchTool } from './audit-tool-dispatch.js';
import { MEMENTO_SERVER_INSTRUCTIONS } from './mcp-instructions.js';
import { mcpLogger } from './mcp-logger.js';
import { countConnectionSignal, stdioUsageConnection } from './usage-recording.js';

interface McpServerFactoryDeps {
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

  // 옛 방식 클라이언트의 initialize 완료(#1768). 새 방식에는 initialize 가 없어 이 훅이 불리지 않는다.
  server.oninitialized = () => {
    const connection = stdioUsageConnection(undefined, () => server.getClientVersion());
    void deps.readyPromise.then(
      () => {
        const db = deps.getDb();
        if (db) countConnectionSignal(db, connection, 'initialize');
      },
      () => mcpLogger.logServer('warn', '사용 집계 연결 신호를 세지 못했다: 서버 초기화가 실패했다'),
    );
  };

  // getExposedTools()는 registry 항목을 그대로 반환하며 handler·Zod inputSchema가 남아 있다.
  // HTTP modern 경로(routes/mcp/message-processor.ts 243행)도 동일 객체를 내보내므로,
  // 여기서 형태를 좁히면 stdio/HTTP parity가 깨진다. 의도적 캐스트이며 객체 매핑으로 "수정" 금지.
  server.setRequestHandler('tools/list', async (_request, ctx): Promise<ListToolsResult> => {
    // 연결 신호(#1768). 새 방식 클라이언트는 연결 직후 tools/list 를 먼저 보내는데 그때 DB 는 아직 준비 중일 수 있다.
    // 응답은 늦추지 않고, 준비되는 대로 백그라운드에서 센다. 연결 정보는 지금 읽어 둬야 한다(ctx 는 요청이 끝나면 쓸 수 없다).
    const connection = stdioUsageConnection(ctx.mcpReq.envelope, () => server.getClientVersion());
    void deps.readyPromise.then(
      () => {
        const db = deps.getDb();
        if (db) countConnectionSignal(db, connection, 'tools/list');
      },
      () => mcpLogger.logServer('warn', '사용 집계 연결 신호를 세지 못했다: 서버 초기화가 실패했다'),
    );
    return { tools: getExposedTools() as unknown as ListToolsResult['tools'] };
  });

  server.setRequestHandler('tools/call', async (request, ctx) => {
    await deps.readyPromise;
    const db = deps.getDb();
    const services = deps.getServices();
    if (!db || !services) throw new Error('Server not initialized');

    return dispatchTool(
      request.params.name,
      request.params.arguments,
      db,
      services,
      { transport: 'mcp_stdio', usage: stdioUsageConnection(ctx.mcpReq.envelope, () => server.getClientVersion()) },
    );
  });

  server.setRequestHandler('resources/list', async () => ({ resources: [] }));
  server.setRequestHandler('resources/read', async () => { throw new Error('Not implemented'); });
  server.setRequestHandler('prompts/list', async () => ({ prompts: [] }));
  server.setRequestHandler('prompts/get', async () => { throw new Error('Not implemented'); });

  return server;
}
