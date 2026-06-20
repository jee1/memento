import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cleanupTestDatabase,
  setupTestDatabase,
  type TestDatabaseContext
} from './test/helpers/test-database.js';

type HttpResponse = {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
};

type OpenMcpStreamResult = HttpResponse & {
  close: () => Promise<void>;
};

function postJson(
  port: number,
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<HttpResponse> {
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
          ...headers
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

function getRequest(
  port: number,
  path: string,
  headers: Record<string, string> = {}
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: {
          Connection: 'close',
          ...headers
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
    req.end();
  });
}

function optionsRequest(
  port: number,
  path: string,
  headers: Record<string, string> = {}
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'OPTIONS',
        headers: {
          Connection: 'close',
          ...headers
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
    req.end();
  });
}

function openMcpStream(
  port: number,
  headers: Record<string, string> = {}
): Promise<OpenMcpStreamResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Connection: 'close',
          ...headers
        }
      },
      res => {
        const chunks: Buffer[] = [];
        let settled = false;

        const finish = () => {
          if (settled) {
            return;
          }
          settled = true;
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
            close: async () => {
              req.destroy();
              res.destroy();
              await new Promise(resolveClose => setImmediate(resolveClose));
            }
          });
        };

        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode !== 200 || body.includes('/messages?sessionId=')) {
            finish();
          }
        });
        res.on('end', finish);
        res.on('close', finish);
      }
    );

    req.on('error', error => {
      if ((error as NodeJS.ErrnoException).code === 'ECONNRESET') {
        return;
      }
      reject(error);
    });
    req.end();
  });
}

function extractSessionPath(streamBody: string): string {
  const match = streamBody.match(/\/messages\?sessionId=[^\n]+/);
  expect(match?.[0]).toBeTruthy();
  return match![0];
}

describe('programmatic auth integration', () => {
  let ctx: TestDatabaseContext | null = null;
  let closeServer: (() => Promise<void>) | null = null;

  async function startRealHttpServer(): Promise<number> {
    const { __test, cleanup } = await import('./http-server.js');
    __test.setTestDependencies({
      database: ctx!.db,
      serverServices: ctx!.services
    });
    await __test.initializeServer();

    const server = __test.getServer() as http.Server;
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    closeServer = async () => {
      await new Promise<void>(resolve => server.close(() => resolve()));
      await cleanup();
    };

    return (server.address() as AddressInfo).port;
  }

  beforeEach(async () => {
    vi.stubEnv('ADMIN_API_KEY', 'integration-admin-key');
    vi.stubEnv('CORS_ALLOWED_ORIGINS', 'https://trusted.app');
    vi.resetModules();
    ctx = await setupTestDatabase();
  });

  afterEach(async () => {
    if (closeServer) {
      await closeServer();
      closeServer = null;
    }
    await cleanupTestDatabase(ctx);
    ctx = null;
    vi.unstubAllEnvs();
  });

  it('rejects cookie-only access to /tools and MCP endpoints while allowing explicit header auth', async () => {
    const port = await startRealHttpServer();

    const login = await postJson(port, '/auth/session', {}, {
      Authorization: 'Bearer integration-admin-key'
    });
    expect(login.statusCode).toBe(204);

    const sessionCookie = login.headers['set-cookie']?.[0] ?? '';
    expect(sessionCookie).toContain('memento_admin_session=');

    const toolsWithCookieOnly = await getRequest(port, '/tools', {
      Cookie: sessionCookie
    });
    expect(toolsWithCookieOnly.statusCode).toBe(401);

    const searchLocalWithCookieOnly = await postJson(
      port,
      '/tools/search_local',
      { query: 'test', slot: 'A', agent_id: 'default', limit: 10 },
      { Cookie: sessionCookie }
    );
    expect(searchLocalWithCookieOnly.statusCode).toBe(401);

    const toolsWithHeader = await getRequest(port, '/tools', {
      Authorization: 'Bearer integration-admin-key'
    });
    expect(toolsWithHeader.statusCode).toBe(200);

    const toolsWithApiKey = await getRequest(port, '/tools', {
      'X-API-Key': 'integration-admin-key'
    });
    expect(toolsWithApiKey.statusCode).toBe(200);

    const toolsPreflight = await optionsRequest(port, '/tools', {
      Origin: 'https://trusted.app',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'x-api-key'
    });
    expect(toolsPreflight.statusCode).toBe(204);
    expect(toolsPreflight.headers['access-control-allow-origin']).toBe('https://trusted.app');
    expect(toolsPreflight.headers['access-control-allow-headers']).toContain('X-API-Key');

    const mcpPreflight = await optionsRequest(port, '/mcp', {
      Origin: 'https://trusted.app',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'x-api-key'
    });
    expect(mcpPreflight.statusCode).toBe(204);
    expect(mcpPreflight.headers['access-control-allow-origin']).toBe('https://trusted.app');
    expect(mcpPreflight.headers['access-control-allow-headers']).toContain('X-API-Key');

    const mcpStreamWithCookieOnly = await openMcpStream(port, {
      Cookie: sessionCookie
    });
    expect(mcpStreamWithCookieOnly.statusCode).toBe(401);

    const mcpStreamTrailingSlashWithCookieOnly = await getRequest(port, '/mcp/', {
      Accept: 'text/event-stream',
      Cookie: sessionCookie
    });
    expect(mcpStreamTrailingSlashWithCookieOnly.statusCode).toBe(401);

    const mcpStreamWithHeader = await openMcpStream(port, {
      Authorization: 'Bearer integration-admin-key'
    });
    expect(mcpStreamWithHeader.statusCode).toBe(200);
    const messagesPath = extractSessionPath(mcpStreamWithHeader.body);

    const mcpStreamWithApiKey = await openMcpStream(port, {
      'X-API-Key': 'integration-admin-key'
    });
    expect(mcpStreamWithApiKey.statusCode).toBe(200);

    const mcpPostWithCookieOnly = await postJson(port, '/mcp', {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {}
    }, {
      Cookie: sessionCookie
    });
    expect(mcpPostWithCookieOnly.statusCode).toBe(401);

    const mcpPostWithHeader = await postJson(port, '/mcp', {
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: {}
    }, {
      Authorization: 'Bearer integration-admin-key'
    });
    expect(mcpPostWithHeader.statusCode).toBe(200);

    const mcpPostWithApiKey = await postJson(port, '/mcp', {
      jsonrpc: '2.0',
      id: 3,
      method: 'initialize',
      params: {}
    }, {
      'X-API-Key': 'integration-admin-key'
    });
    expect(mcpPostWithApiKey.statusCode).toBe(200);

    const messagesWithCookieOnly = await postJson(port, messagesPath, {
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    }, {
      Cookie: sessionCookie
    });
    expect(messagesWithCookieOnly.statusCode).toBe(401);

    const messagesWithHeader = await postJson(port, messagesPath, {
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    }, {
      Authorization: 'Bearer integration-admin-key'
    });
    expect(messagesWithHeader.statusCode).toBe(200);

    const messagesWithApiKey = await postJson(port, messagesPath, {
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    }, {
      'X-API-Key': 'integration-admin-key'
    });
    expect(messagesWithApiKey.statusCode).toBe(200);

    const messagesTrailingSlashWithCookieOnly = await postJson(port, '/messages/?sessionId=trailing-slash', {
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    }, {
      Cookie: sessionCookie
    });
    expect(messagesTrailingSlashWithCookieOnly.statusCode).toBe(401);

    await mcpStreamWithApiKey.close();
    await mcpStreamWithHeader.close();
    await mcpStreamWithCookieOnly.close();
  });
});
