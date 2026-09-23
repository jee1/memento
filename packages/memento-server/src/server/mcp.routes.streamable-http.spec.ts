import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import packageJson from '../../package.json' with { type: 'json' };

async function listenWithMcpRouter(): Promise<{ port: number; close: () => Promise<void> }> {
  const { createMcpRouter } = await import('./routes/mcp.routes.js');
  const app = express();
  const transports: Record<string, unknown> = {};

  app.use(express.json());
  app.use(createMcpRouter(null, null, transports as any));

  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });

  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      })
  };
}

function postJsonRpc(
  port: number,
  path: string,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {}
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  const payload = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Connection: 'close',
          ...extraHeaders
        }
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function openSse(
  port: number,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; firstChunk: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Connection: 'close',
          ...headers
        }
      },
      res => {
        let settled = false;
        const finish = (firstChunk: string) => {
          if (settled) return;
          settled = true;
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            firstChunk
          });
          res.destroy();
        };

        res.on('data', (chunk: Buffer) => finish(chunk.toString('utf8')));
        res.on('end', () => finish(''));
      }
    );

    req.on('error', reject);
    req.end();
  });
}


async function listenWithMcpRouterAndMocks(): Promise<{ port: number; close: () => Promise<void> }> {
  const core = await import('@memento/core');
  const { createMcpRouter } = await import('./routes/mcp.routes.js');
  const app = express();
  const transports: Record<string, unknown> = {};

  app.use(express.json());
  app.use(createMcpRouter({} as never, {} as never, transports as any));

  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });

  return {
    port: (server.address() as import('node:net').AddressInfo).port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      })
  };
}

describe('mcp.routes streamable_http', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('POST /mcp initialize should respond with JSON-RPC payload directly', async () => {
    const { port, close } = await listenWithMcpRouter();

    try {
      const res = await postJsonRpc(port, '/mcp', {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {}
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      expect(typeof res.headers['mcp-session-id']).toBe('string');
      expect(JSON.parse(res.body)).toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {
            tools: {},
            resources: {},
            prompts: {}
          },
          serverInfo: {
            name: 'memento-mcp-server',
            version: packageJson.version
          }
        }
      });
    } finally {
      await close();
    }
  });

  it('POST /mcp tools/list should respond with JSON-RPC tool list directly', async () => {
    const { port, close } = await listenWithMcpRouter();

    try {
      const res = await postJsonRpc(port, '/mcp', {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      const body = JSON.parse(res.body) as {
        jsonrpc: string;
        id: number;
        result: { tools: Array<{ name: string }> };
      };
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe(2);
      expect(Array.isArray(body.result.tools)).toBe(true);
      expect(body.result.tools.some(tool => tool.name === 'remember')).toBe(true);
    } finally {
      await close();
    }
  });

  it('POST /mcp initialized notification should return 202 with empty body', async () => {
    const { port, close } = await listenWithMcpRouter();

    try {
      const res = await postJsonRpc(port, '/mcp', {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {}
      });

      expect(res.statusCode).toBe(202);
      expect(res.body).toBe('');
    } finally {
      await close();
    }
  });

  it('SDK streamable HTTP client should connect and list tools', async () => {
    const { port, close } = await listenWithMcpRouter();
    const client = new Client({
      name: 'streamable-http-spec-test',
      version: '1.0.0'
    });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));

    try {
      await client.connect(transport);
      expect(typeof transport.sessionId).toBe('string');
      const result = await client.listTools();
      expect(result.tools.some(tool => tool.name === 'remember')).toBe(true);
    } finally {
      await client.close();
      await close();
    }
  });

  it('GET /mcp with MCP-Protocol-Version should return 405 for streamable HTTP polling', async () => {
    const { port, close } = await listenWithMcpRouter();

    try {
      const res = await openSse(port, '/mcp', {
        'MCP-Protocol-Version': '2024-11-05'
      });

      expect(res.statusCode).toBe(405);
    } finally {
      await close();
    }
  });

  it('POST /mcp tools/call should return JSON-RPC error directly when services are unavailable', async () => {
    const { port, close } = await listenWithMcpRouter();

    try {
      const res = await postJsonRpc(port, '/mcp', {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'remember',
          arguments: {
            content: 'streamable_http smoke test'
          }
        }
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      expect(JSON.parse(res.body)).toEqual({
        jsonrpc: '2.0',
        id: 3,
        error: {
          code: -32603,
          message: 'Internal error',
          data: '서비스가 초기화되지 않았습니다'
        }
      });
    } finally {
      await close();
    }
  });

  it('POST /messages with an unknown session should return 404 and log an inactive-session warning', async () => {
    const currentCore: typeof import('@memento/core') = await import('@memento/core');
    const errorSpy = vi.spyOn(currentCore.logger, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(currentCore.logger, 'warn').mockImplementation(() => undefined);
    const { port, close } = await listenWithMcpRouter();

    try {
      const res = await postJsonRpc(port, '/messages?sessionId=test123', {
        jsonrpc: '2.0',
        id: 99,
        method: 'initialize',
        params: {}
      });

      expect(res.statusCode).toBe(404);
      expect(res.body).toBe('Session not found');
      expect(errorSpy).not.toHaveBeenCalledWith(
        'No active transport found for session ID',
        expect.anything()
      );
      expect(warnSpy).toHaveBeenCalledWith(
        'MCP message received for inactive or unknown session',
        expect.objectContaining({
          sessionId: 'test123',
          reason: 'inactive_session',
          method: 'initialize'
        })
      );
    } finally {
      await close();
    }
  });
  it('POST /mcp tools/call should return -32602 for Zod validation errors without streamable ERROR log', async () => {
    const { z } = await import('zod');
    const core = await import('@memento/core');
    const errorSpy = vi.spyOn(core.logger, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(core.logger, 'warn').mockImplementation(() => undefined);
    vi.spyOn(core, 'executeTool').mockRejectedValue(
      new z.ZodError([
        {
          code: 'custom',
          path: ['content'],
          message: "type='core' 또는 'vault'일 때는 key, value가 필수이고, 나머지는 content가 필수입니다"
        }
      ])
    );

    const { port, close } = await listenWithMcpRouterAndMocks();

    try {
      const res = await postJsonRpc(port, '/mcp', {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'remember',
          arguments: {}
        }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        jsonrpc: string;
        id: number;
        error: { code: number; message: string; data: unknown };
      };
      expect(body.error.code).toBe(-32602);
      // #861: type 누락 이유가 message 로 나가야 한다 (클라이언트는 data 를 버린다).
      expect(body.error.message).toMatch(/^Invalid params: .*type/);
      expect(errorSpy).not.toHaveBeenCalledWith(
        'MCP streamable_http processing failed',
        expect.anything()
      );
      expect(warnSpy).toHaveBeenCalledWith(
        'MCP tools/call rejected invalid params',
        expect.objectContaining({ tool: 'remember' })
      );
    } finally {
      await close();
    }
  });


});

/**
 * #840 Phase 0: initialize 응답이 서버의 실제 상태를 말해야 한다.
 * era 분기·_meta·server/discover 는 이 이슈의 다음 단계이고 여기 없다.
 */
describe('#840 Phase 0 initialize parity', () => {
  it('클라이언트가 요청한 버전을 지원하면 그대로 돌려준다 (옛 하드코딩 값도 최신 값도 아닌 버전으로 확인한다)', async () => {
    const { port, close } = await listenWithMcpRouter();
    try {
      const res = await postJsonRpc(port, '/mcp', {
        jsonrpc: '2.0',
        id: 7,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18' }
      });
      const body = JSON.parse(res.body) as { result: { protocolVersion: string } };
      expect(body.result.protocolVersion).toBe('2025-06-18');
    } finally {
      await close();
    }
  });

  it('지원하지 않는 버전을 요청하면 서버가 지원하는 최신 버전으로 답한다', async () => {
    const { port, close } = await listenWithMcpRouter();
    try {
      const res = await postJsonRpc(port, '/mcp', {
        jsonrpc: '2.0',
        id: 8,
        method: 'initialize',
        params: { protocolVersion: '1999-01-01' }
      });
      const body = JSON.parse(res.body) as { result: { protocolVersion: string } };
      expect(body.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
    } finally {
      await close();
    }
  });

  it('HTTP 가 실제로 서빙하는 prompts·resources 를 capability 로 광고한다', async () => {
    const { port, close } = await listenWithMcpRouter();
    try {
      const res = await postJsonRpc(port, '/mcp', {
        jsonrpc: '2.0',
        id: 9,
        method: 'initialize',
        params: {}
      });
      const body = JSON.parse(res.body) as {
        result: { capabilities: Record<string, unknown> };
      };
      expect(Object.keys(body.result.capabilities).sort()).toEqual([
        'prompts',
        'resources',
        'tools'
      ]);
    } finally {
      await close();
    }
  });

  it('logging 은 HTTP 에 핸들러가 없으므로 광고하지 않는다', async () => {
    const { port, close } = await listenWithMcpRouter();
    try {
      const res = await postJsonRpc(port, '/mcp', {
        jsonrpc: '2.0',
        id: 10,
        method: 'initialize',
        params: {}
      });
      const body = JSON.parse(res.body) as {
        result: { capabilities: Record<string, unknown> };
      };
      expect(body.result.capabilities).not.toHaveProperty('logging');
    } finally {
      await close();
    }
  });
});

const MODERN_PROTOCOL_VERSION = '2026-07-28';

function modernMeta(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
    'io.modelcontextprotocol/clientInfo': { name: 'phase-1b-test', version: '1.0.0' },
    'io.modelcontextprotocol/clientCapabilities': {},
    ...overrides,
  };
}

function modernHeaders(method: string, mcpName?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION,
    'Mcp-Method': method,
  };
  if (mcpName !== undefined) {
    headers['Mcp-Name'] = mcpName;
  }
  return headers;
}

function requestHttp(
  port: number,
  options: {
    path: string;
    method: 'GET' | 'DELETE' | 'POST';
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
  }
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  const payload = options.body ? JSON.stringify(options.body) : undefined;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: options.path,
        method: options.method,
        headers: {
          ...(options.method === 'GET' ? { Accept: 'text/event-stream' } : {}),
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
          Connection: 'close',
          ...options.headers,
        },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function listenWithMcpRouterPermissiveJson(): Promise<{ port: number; close: () => Promise<void> }> {
  const { createMcpRouter } = await import('./routes/mcp.routes.js');
  const app = express();
  const transports: Record<string, unknown> = {};

  app.use(express.json({ strict: false }));
  app.use(createMcpRouter(null, null, transports as any));

  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });

  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      }),
  };
}

function postRawJson(
  port: number,
  path: string,
  rawBody: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(rawBody),
          Connection: 'close',
          ...extraHeaders,
        },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );

    req.on('error', reject);
    req.write(rawBody);
    req.end();
  });
}

describe('#840 Phase 1b HTTP dual-era', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('legacy initialize 은 HTTP 200·세션ID·바이트 호환 응답을 유지한다', async () => {
    const { port, close } = await listenWithMcpRouter();
    try {
      const res = await postJsonRpc(port, '/mcp', {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      });
      expect(res.statusCode).toBe(200);
      expect(typeof res.headers['mcp-session-id']).toBe('string');
      expect(JSON.parse(res.body)).toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
          },
          serverInfo: {
            name: 'memento-mcp-server',
            version: packageJson.version,
          },
        },
      });
    } finally {
      await close();
    }
  });

  it('legacy tools/call 에러는 HTTP 200 을 유지한다', async () => {
    const { port, close } = await listenWithMcpRouter();
    try {
      const res = await postJsonRpc(port, '/mcp', {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'remember',
          arguments: { content: 'legacy parity' },
        },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({
        jsonrpc: '2.0',
        id: 3,
        error: {
          code: -32603,
          message: 'Internal error',
          data: '서비스가 초기화되지 않았습니다',
        },
      });
    } finally {
      await close();
    }
  });

  it('modern tools/list 는 resultType complete 와 serverInfo 를 반환한다', async () => {
    const { port, close } = await listenWithMcpRouter();
    try {
      const res = await postJsonRpc(
        port,
        '/mcp',
        {
          jsonrpc: '2.0',
          id: 11,
          method: 'tools/list',
          params: { _meta: modernMeta() },
        },
        modernHeaders('tools/list')
      );
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        result: {
          resultType: string;
          tools: Array<{ name: string }>;
          _meta: Record<string, { name: string; version: string }>;
        };
      };
      expect(body.result.resultType).toBe('complete');
      expect(body.result.tools.some(tool => tool.name === 'remember')).toBe(true);
      expect(body.result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('memento-mcp-server');
      expect(res.headers['mcp-session-id']).toBeUndefined();
    } finally {
      await close();
    }
  });

  it('#1129 modern cacheable result 는 ttlMs·cacheScope 를 싣는다 (배선 확인)', async () => {
    const { port, close } = await listenWithMcpRouter();
    try {
      // 순수 함수 유닛 테스트로는 handlers.ts 가 method 를 넘기는지 증명되지 않는다.
      // 실제 HTTP 응답에서 확인해야 배선이 깨졌을 때 빨간불이 켜진다.
      // resources/list 는 DB 가 있어야 해서 이 하네스에서는 500 이 된다. 캐시 필드 배선은
      // 메서드마다 다르지 않으므로 DB 없이 200 이 나오는 둘로 확인한다.
      for (const method of ['tools/list', 'prompts/list'] as const) {
        const res = await postJsonRpc(
          port,
          '/mcp',
          { jsonrpc: '2.0', id: 11, method, params: { _meta: modernMeta() } },
          modernHeaders(method)
        );
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as {
          result: { ttlMs: number; cacheScope: string };
        };
        expect(body.result.ttlMs, `${method} ttlMs`).toBe(0);
        expect(body.result.cacheScope, `${method} cacheScope`).toBe('private');
      }
    } finally {
      await close();
    }
  });

  it('#1129 cacheable 이 아닌 메서드에는 캐시 필드를 붙이지 않는다', async () => {
    const { port, close } = await listenWithMcpRouter();
    try {
      // SEP-2549 의 목록은 닫혀 있다. 규정에 없는 필드를 얹는 것도 위반이다.
      const res = await postJsonRpc(
        port,
        '/mcp',
        {
          jsonrpc: '2.0',
          id: 12,
          method: 'tools/call',
          params: { name: 'remember', arguments: {}, _meta: modernMeta() },
        },
        modernHeaders('tools/call', 'remember')
      );
      const body = JSON.parse(res.body) as { result?: Record<string, unknown> };
      if (body.result) {
        expect(body.result).not.toHaveProperty('ttlMs');
        expect(body.result).not.toHaveProperty('cacheScope');
      }
    } finally {
      await close();
    }
  });

  it('modern _meta 누락 필드는 -32602/400 을 반환한다', async () => {
    const { port, close } = await listenWithMcpRouter();
    try {
      const res = await postJsonRpc(
        port,
        '/mcp',
        {
          jsonrpc: '2.0',
          id: 12,
          method: 'tools/list',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
            },
          },
        },
        modernHeaders('tools/list')
      );
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { error: { code: number } };
      expect(body.error.code).toBe(-32602);
    } finally {
      await close();
    }
  });

  it('modern 헤더 불일치는 -32020/400 을 반환한다', async () => {
    const { port, close } = await listenWithMcpRouter();
    try {
      const res = await postJsonRpc(
        port,
        '/mcp',
        {
          jsonrpc: '2.0',
          id: 13,
          method: 'tools/list',
          params: { _meta: modernMeta() },
        },
        {
          'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION,
          'Mcp-Method': 'tools/call',
        }
      );
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { error: { code: number } };
      expect(body.error.code).toBe(-32020);
    } finally {
      await close();
    }
  });

  it('modern 미지원 버전은 -32022/400 을 반환한다', async () => {
    const { port, close } = await listenWithMcpRouter();
    try {
      const res = await postJsonRpc(
        port,
        '/mcp',
        {
          jsonrpc: '2.0',
          id: 14,
          method: 'tools/list',
          params: {
            _meta: modernMeta({
              'io.modelcontextprotocol/protocolVersion': '2099-01-01',
            }),
          },
        },
        {
          'MCP-Protocol-Version': '2099-01-01',
          'Mcp-Method': 'tools/list',
        }
      );
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { error: { code: number; data: { supported: string[] } } };
      expect(body.error.code).toBe(-32022);
      expect(body.error.data.supported).toContain(MODERN_PROTOCOL_VERSION);
    } finally {
      await close();
    }
  });

  it('modern initialize 는 -32601/404 를 반환한다', async () => {
    const { port, close } = await listenWithMcpRouter();
    try {
      const res = await postJsonRpc(
        port,
        '/mcp',
        {
          jsonrpc: '2.0',
          id: 15,
          method: 'initialize',
          params: { _meta: modernMeta() },
        },
        modernHeaders('initialize')
      );
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body) as { error: { code: number } };
      expect(body.error.code).toBe(-32601);
      expect(res.headers['mcp-session-id']).toBeUndefined();
    } finally {
      await close();
    }
  });

  it('modern tools/call missing Mcp-Name returns -32020/400', async () => {
    const { port, close } = await listenWithMcpRouter();
    try {
      const res = await postJsonRpc(
        port,
        '/mcp',
        {
          jsonrpc: '2.0',
          id: 16,
          method: 'tools/call',
          params: {
            name: 'remember',
            arguments: {},
            _meta: modernMeta(),
          },
        },
        modernHeaders('tools/call')
      );
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { error: { code: number; message: string } };
      expect(body.error.code).toBe(-32020);
      expect(body.error.message).toContain('missing Mcp-Name header');
    } finally {
      await close();
    }
  });

  it('modern tools/call Mcp-Name mismatch returns -32020/400', async () => {
    const { port, close } = await listenWithMcpRouter();
    try {
      const res = await postJsonRpc(
        port,
        '/mcp',
        {
          jsonrpc: '2.0',
          id: 161,
          method: 'tools/call',
          params: {
            name: 'remember',
            arguments: {},
            _meta: modernMeta(),
          },
        },
        modernHeaders('tools/call', 'recall')
      );
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { error: { code: number; message: string } };
      expect(body.error.code).toBe(-32020);
      expect(body.error.message).toContain('does not match body value');
    } finally {
      await close();
    }
  });

  it('modern tools/call accepts RFC2047 Base64 Mcp-Name at validation boundary', async () => {
    const { port, close } = await listenWithMcpRouter();
    try {
      const res = await postJsonRpc(
        port,
        '/mcp',
        {
          jsonrpc: '2.0',
          id: 162,
          method: 'tools/call',
          params: {
            name: '한글도구',
            arguments: {},
            _meta: modernMeta(),
          },
        },
        modernHeaders('tools/call', '=?base64?7ZWc6riA64+E6rWs?=')
      );
      expect(res.statusCode).toBe(500);
      const body = JSON.parse(res.body) as { error: { code: number } };
      expect(body.error.code).toBe(-32603);
    } finally {
      await close();
    }
  });

  it('modern tools/call Zod 검증 실패는 -32602/400 을 반환한다', async () => {
    const { z } = await import('zod');
    const core = await import('@memento/core');
    vi.spyOn(core, 'executeTool').mockRejectedValue(
      new z.ZodError([
        {
          code: 'custom',
          path: ['content'],
          message: "type='core' 또는 'vault'일 때는 key, value가 필수이고, 나머지는 content가 필수입니다",
        },
      ])
    );
    const { port, close } = await listenWithMcpRouterAndMocks();
    try {
      const res = await postJsonRpc(
        port,
        '/mcp',
        {
          jsonrpc: '2.0',
          id: 17,
          method: 'tools/call',
          params: {
            name: 'remember',
            arguments: {},
            _meta: modernMeta(),
          },
        },
        modernHeaders('tools/call', 'remember')
      );
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { error: { code: number } };
      expect(body.error.code).toBe(-32602);
    } finally {
      await close();
    }
  });

  it('GET/DELETE with MCP-Protocol-Version return 405 with Allow: POST', async () => {
    const { port, close } = await listenWithMcpRouter();
    try {
      const getRes = await requestHttp(port, {
        path: '/mcp',
        method: 'GET',
        headers: { 'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION },
      });
      const deleteRes = await requestHttp(port, {
        path: '/mcp',
        method: 'DELETE',
        headers: { 'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION },
      });
      expect(getRes.statusCode).toBe(405);
      expect(getRes.headers.allow).toBe('POST');
      expect(deleteRes.statusCode).toBe(405);
      expect(deleteRes.headers.allow).toBe('POST');
    } finally {
      await close();
    }
  });

  it('legacy null JSON body returns -32600/200 without HTML 500', async () => {
    const { port, close } = await listenWithMcpRouterPermissiveJson();
    try {
      const res = await postRawJson(port, '/mcp', 'null');
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      const body = JSON.parse(res.body) as { error: { code: number; message: string } };
      expect(body.error.code).toBe(-32600);
      expect(body.error.message).toBe('Invalid Request');
    } finally {
      await close();
    }
  });

  it('modern null JSON body with MCP-Protocol-Version returns -32602/400', async () => {
    const { port, close } = await listenWithMcpRouterPermissiveJson();
    try {
      const res = await postRawJson(port, '/mcp', 'null', {
        'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION,
      });
      expect(res.statusCode).toBe(400);
      expect(res.headers['content-type']).toContain('application/json');
      const body = JSON.parse(res.body) as { error: { code: number } };
      expect(body.error.code).toBe(-32602);
    } finally {
      await close();
    }
  });

  it('legacy scalar JSON body returns -32600/200', async () => {
    const { port, close } = await listenWithMcpRouterPermissiveJson();
    try {
      const res = await postRawJson(port, '/mcp', '42');
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { error: { code: number } };
      expect(body.error.code).toBe(-32600);
    } finally {
      await close();
    }
  });

  it('legacy GET without MCP-Protocol-Version still opens SSE', async () => {
    const { port, close } = await listenWithMcpRouter();
    try {
      const res = await openSse(port, '/mcp');
      expect(res.statusCode).toBe(200);
      expect(res.firstChunk).toContain('event: endpoint');
    } finally {
      await close();
    }
  });

  it('MEMENTO_MCP_ERA=legacy gate rejects modern claims with -32022/400', async () => {
    vi.stubEnv('MEMENTO_MCP_ERA', 'legacy');
    vi.resetModules();
    const { port, close } = await listenWithMcpRouter();
    try {
      const res = await postJsonRpc(
        port,
        '/mcp',
        {
          jsonrpc: '2.0',
          id: 18,
          method: 'tools/list',
          params: { _meta: modernMeta() },
        },
        modernHeaders('tools/list')
      );
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { error: { code: number; data: { supported: string[] } } };
      expect(body.error.code).toBe(-32022);
      expect(body.error.data.supported).not.toContain(MODERN_PROTOCOL_VERSION);
    } finally {
      await close();
    }
  });

  it('server/discover advertises 2026-07-28 when modern service is enabled', async () => {
    const { port, close } = await listenWithMcpRouter();
    try {
      const res = await postJsonRpc(port, '/mcp', {
        jsonrpc: '2.0',
        id: 19,
        method: 'server/discover',
        params: {},
      });
      const body = JSON.parse(res.body) as { result: { supportedVersions: string[] } };
      expect(body.result.supportedVersions).toContain(MODERN_PROTOCOL_VERSION);
    } finally {
      await close();
    }
  });
});
