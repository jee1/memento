import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as core from '@memento/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

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
  body: Record<string, unknown>
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
          Connection: 'close'
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
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'memento-memory',
            version: '0.1.0'
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
    const currentCore: typeof core = await import('@memento/core');
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
});
