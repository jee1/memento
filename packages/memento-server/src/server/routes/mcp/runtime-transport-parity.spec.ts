/**
 * Docker(TRANSPORT_TYPE=sse), npm run dev:http, stdio MCP가 동일한 도구 결과를 반환하는지 검증.
 * transport 차이는 인증·agentId 주입 등 셸 계층에만 있어야 하며, executeTool 결과 형식은 동일해야 한다.
 */

import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AuditHashChainService,
  CORE_TOOLSET,
  createToolContext,
  getExposedTools,
  getToolRegistry,
} from '@memento/core';
import * as core from '@memento/core';
import express from 'express';
import type { WebSocket, WebSocketServer } from 'ws';
import { dispatchTool } from '../../audit-tool-dispatch.js';
import { setupWebSocketServer } from '../../http-server-websocket.js';
import { createHttpAuditMiddleware } from '../../middleware/http-audit.middleware.js';
import { createToolsRouter } from '../tools.routes.js';
import { processMcpMessage } from './message-processor.js';
import {
  cleanupTestDatabase,
  setupTestDatabase,
  type TestDatabaseContext,
} from '../../test/helpers/test-database.js';

describe('runtime transport parity (stdio vs HTTP MCP)', () => {
  let ctx: TestDatabaseContext;

  beforeEach(async () => {
    ctx = await setupTestDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestDatabase(ctx);
  });

  async function listToolNames(): Promise<string[]> {
    const response = await processMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      ctx.db,
      ctx.services,
    );
    return (response.result as { tools: { name: string }[] }).tools
      .map((t) => t.name)
      .sort();
  }

  it('tools/list exposes the same set as getExposedTools()', async () => {
    // Both transports read getExposedTools(), so the listings cannot drift apart.
    expect(await listToolNames()).toEqual(getExposedTools().map((t) => t.name).sort());
  });

  it('lists only the core toolset by default and the full registry under MEMENTO_TOOLSET=full', async () => {
    vi.stubEnv('MEMENTO_TOOLSET', '');
    expect(await listToolNames()).toEqual([...CORE_TOOLSET].sort());

    vi.stubEnv('MEMENTO_TOOLSET', 'full');
    expect(await listToolNames()).toEqual(
      getToolRegistry().getAll().map((t) => t.name).sort(),
    );

    vi.unstubAllEnvs();
  });

  it('keeps unlisted tools callable so progressive disclosure never breaks a client', async () => {
    vi.stubEnv('MEMENTO_TOOLSET', '');
    expect(await listToolNames()).not.toContain('get_telemetry_summary');

    const response = await processMcpMessage(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'get_telemetry_summary', arguments: {} },
      },
      ctx.db,
      ctx.services,
    );

    expect(response.error).toBeUndefined();
    vi.unstubAllEnvs();
  });

  it('tools/call passes executeTool ToolResult through unchanged (stdio parity)', async () => {
    const params = {
      content: 'transport parity probe',
      type: 'semantic',
      tags: ['parity'],
      importance: 0.5,
    };
    const spy = vi.spyOn(core, 'executeTool');

    const httpResponse = await processMcpMessage(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'remember', arguments: params },
      },
      ctx.db,
      ctx.services,
    );

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]?.[0]).toBe('remember');
    expect(spy.mock.calls[0]?.[1]).toEqual(params);
    const stdioResult = await spy.mock.results[0]?.value;
    expect(httpResponse.result).toEqual(stdioResult);

    const payload = JSON.parse(
      (stdioResult.content[0] as { text: string }).text,
    ) as { memory_id?: string; type?: string };
    expect(typeof payload.memory_id).toBe('string');
    expect(payload.type).toBe('semantic');
  });

  it('tools/call recall uses the same executeTool path as stdio', async () => {
    await core.executeTool(
      'remember',
      { content: 'parity recall seed memory', type: 'episodic' },
      core.createToolContext(ctx.db, ctx.services),
    );

    const recallParams = { query: 'parity recall seed', limit: 5, type: 'episodic' };
    const spy = vi.spyOn(core, 'executeTool');

    const httpResponse = await processMcpMessage(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'recall', arguments: recallParams },
      },
      ctx.db,
      ctx.services,
    );

    expect(spy).toHaveBeenCalledWith('recall', recallParams, expect.any(Object));
    const stdioResult = await spy.mock.results[0]?.value;
    expect(httpResponse.result).toEqual(stdioResult);
  });
});

class FakeWebSocket extends EventEmitter {
  readonly readyState = 1;
  readonly sent: string[] = [];
  send(payload: string): void {
    this.sent.push(payload);
  }
}

class FakeWebSocketServer extends EventEmitter {}

async function waitForMessage(ws: FakeWebSocket): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 20 && ws.sent.length === 0; attempt += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  expect(ws.sent).toHaveLength(1);
  return JSON.parse(ws.sent[0]!) as Record<string, unknown>;
}

async function postJson(
  port: number,
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        connection: 'close',
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
      }));
    });
    request.on('error', reject);
    request.end(payload);
  });
}

async function startRestServer(
  ctx: TestDatabaseContext,
  logPath: string,
  anchorMapSubscribers: Map<string, Set<WebSocket>> = new Map(),
): Promise<http.Server> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.programmaticAuth = { keyId: 'rest-key', scopes: [] };
    req.toolContext = createToolContext({ db: ctx.db, services: ctx.services, agentId: 'rest-agent' });
    next();
  });
  app.use(
    '/tools',
    createHttpAuditMiddleware({ database: ctx.db, logPath }),
    createToolsRouter(ctx.db, ctx.services, anchorMapSubscribers),
  );
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

function serverPort(server: http.Server): number {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No REST test server port');
  return address.port;
}

describe('runtime transport parity (all four tool wrappers)', () => {
  let ctx: TestDatabaseContext;
  let tempDir: string;

  beforeEach(async () => {
    ctx = await setupTestDatabase();
    tempDir = mkdtempSync(join(tmpdir(), 'memento-dispatch-parity-'));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanupTestDatabase(ctx);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('preserves REST framing and broadcast while recording request and tool audit entries', async () => {
    const subscriber = new FakeWebSocket();
    const subscribers = new Map<string, Set<WebSocket>>([
      ['rest-agent', new Set([subscriber as unknown as WebSocket])],
    ]);
    const server = await startRestServer(ctx, join(tempDir, 'http-audit.jsonl'), subscribers);

    try {
      const response = await postJson(serverPort(server), '/tools/remember', {
        content: 'REST dispatch parity',
        type: 'semantic',
      });
      expect(response).toMatchObject({
        status: 200,
        body: { result: expect.any(Object), tool: 'remember', timestamp: expect.any(String) },
      });
      const memoryId = (response.body.result as { memory_id?: string }).memory_id;
      expect(memoryId).toEqual(expect.any(String));

      const anchorResponse = await postJson(serverPort(server), '/tools/set_anchor', {
        memory_id: memoryId,
        slot: 'A',
        agent_id: 'rest-agent',
      });
      expect(anchorResponse).toMatchObject({
        status: 200,
        body: { result: expect.any(Object), tool: 'set_anchor', timestamp: expect.any(String) },
      });
      for (let attempt = 0; attempt < 20 && subscriber.sent.length === 0; attempt += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(JSON.parse(subscriber.sent[0]!) as Record<string, unknown>)
        .toMatchObject({ type: 'anchor_map_update' });

      const records = new AuditHashChainService(ctx.db).list();
      expect(records).toEqual(expect.arrayContaining([
        expect.objectContaining({ transport: 'rest', toolOrEndpoint: 'remember' }),
        expect.objectContaining({ transport: 'mcp_http', toolOrEndpoint: 'remember' }),
      ]));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('records a WebSocket upgrade separately from its tool dispatch', async () => {
    const wss = new FakeWebSocketServer();
    setupWebSocketServer(
      wss as unknown as WebSocketServer,
      new Map(),
      () => ctx.db,
      () => ctx.services,
    );
    const ws = new FakeWebSocket();
    wss.emit('connection', ws as unknown as WebSocket);
    ws.emit('message', Buffer.from(JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'get_telemetry_summary', arguments: {} },
    })));

    const response = await waitForMessage(ws);
    expect(response).toMatchObject({ jsonrpc: '2.0', id: 7, result: expect.any(Object) });
    expect(new AuditHashChainService(ctx.db).list({ transport: 'mcp_ws' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolOrEndpoint: '/websocket', requestSeen: true, responseSeen: true }),
      expect.objectContaining({ toolOrEndpoint: 'get_telemetry_summary' }),
    ]));
  });

  it('maps the same unknown-tool failure contract in all four wrappers', async () => {
    const stdioError = await dispatchTool(
      'not_a_real_tool', {}, ctx.db, ctx.services, { transport: 'mcp_stdio' },
    ).catch((error: unknown) => error) as { code: number; protocolMessage: string };

    const httpResponse = await processMcpMessage(
      {
        jsonrpc: '2.0', id: 8, method: 'tools/call',
        params: { name: 'not_a_real_tool', arguments: {} },
      },
      ctx.db,
      ctx.services,
    );

    const wss = new FakeWebSocketServer();
    setupWebSocketServer(wss as unknown as WebSocketServer, new Map(), () => ctx.db, () => ctx.services);
    const ws = new FakeWebSocket();
    wss.emit('connection', ws as unknown as WebSocket);
    ws.emit('message', Buffer.from(JSON.stringify({
      jsonrpc: '2.0', id: 9, method: 'tools/call',
      params: { name: 'not_a_real_tool', arguments: {} },
    })));
    const wsResponse = await waitForMessage(ws);

    const restServer = await startRestServer(ctx, join(tempDir, 'http-audit-errors.jsonl'));
    let restResponse: Awaited<ReturnType<typeof postJson>>;
    try {
      restResponse = await postJson(serverPort(restServer), '/tools/not_a_real_tool', {});
    } finally {
      await new Promise<void>((resolve) => restServer.close(() => resolve()));
    }

    expect(stdioError).toMatchObject({ code: -32601, protocolMessage: 'Method not found' });
    expect(httpResponse.error).toMatchObject({ code: -32601, message: 'Method not found' });
    expect(wsResponse.error).toMatchObject({ code: -32601, message: 'Method not found' });
    expect(restResponse).toMatchObject({
      status: 404,
      body: { error: 'Method not found', code: -32601, tool: 'not_a_real_tool' },
    });
  });

  it('rejects unauthenticated WebSocket deletion in strict mode', async () => {
    vi.stubEnv('MEMENTO_AUDIT_MODE', 'strict');
    const wss = new FakeWebSocketServer();
    setupWebSocketServer(wss as unknown as WebSocketServer, new Map(), () => ctx.db, () => ctx.services);
    const ws = new FakeWebSocket();
    wss.emit('connection', ws as unknown as WebSocket);
    ws.emit('message', Buffer.from(JSON.stringify({
      jsonrpc: '2.0', id: 10, method: 'tools/call',
      params: { name: 'forget', arguments: { memory_id: 'never-executed' } },
    })));

    const response = await waitForMessage(ws);
    expect(response.error).toMatchObject({ code: -32603, message: 'Internal error' });
    expect(new AuditHashChainService(ctx.db).list({ transport: 'mcp_ws' }))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ toolOrEndpoint: 'forget' })]));
  });
});
