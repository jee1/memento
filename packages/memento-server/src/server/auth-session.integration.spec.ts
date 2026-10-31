import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cleanupTestDatabase,
  setupTestDatabase,
  type TestDatabaseContext
} from './test/helpers/test-database.js';

function postJson(
  port: number,
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
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

function getJson(
  port: number,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
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

function deleteRequest(
  port: number,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'DELETE',
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

describe('auth session integration', () => {
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
    vi.stubEnv('ADMIN_API_KEY', 'integration-admin-key-012345678901');
    vi.stubEnv(
      'MEMENTO_API_TOKENS',
      JSON.stringify([
        {
          id: 'integration',
          secret: 'integration-admin-key-012345678901',
          scopes: ['admin:destructive', 'tools:invoke'],
        },
      ]),
    );
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

  it('creates a session cookie and allows /api access without Authorization header', async () => {
    const port = await startRealHttpServer();

    const login = await postJson(port, '/auth/session', {}, {
      Authorization: 'Bearer integration-admin-key-012345678901'
    });

    expect(login.statusCode).toBe(204);
    expect(login.headers['set-cookie']?.[0]).toContain('memento_admin_session=');

    const api = await getJson(port, '/api/anchors/map?agent_id=default', {
      Cookie: login.headers['set-cookie']?.[0] ?? ''
    });

    expect(api.statusCode).toBe(200);
  });

  it('allows signed-in GET /api/anchors/agents with agent list shape', async () => {
    const port = await startRealHttpServer();

    const login = await postJson(port, '/auth/session', {}, {
      Authorization: 'Bearer integration-admin-key-012345678901'
    });
    const sessionCookie = login.headers['set-cookie']?.[0] ?? '';

    const agents = await getJson(port, '/api/anchors/agents', { Cookie: sessionCookie });

    expect(agents.statusCode).toBe(200);
    const payload = JSON.parse(agents.body) as {
      agents?: unknown[];
      agent_ids?: unknown[];
      timestamp?: string;
    };
    expect(Array.isArray(payload.agents)).toBe(true);
    expect(Array.isArray(payload.agent_ids)).toBe(true);
    expect(typeof payload.timestamp).toBe('string');
  });

  it('allows signed-in POST /api/anchors/search with search_local-compatible result shape', async () => {
    const port = await startRealHttpServer();

    const login = await postJson(port, '/auth/session', {}, {
      Authorization: 'Bearer integration-admin-key-012345678901'
    });
    const sessionCookie = login.headers['set-cookie']?.[0] ?? '';

    const search = await postJson(
      port,
      '/api/anchors/search',
      { query: 'test', slot: 'A', agent_id: 'default', limit: 10 },
      { Cookie: sessionCookie }
    );

    expect(search.statusCode).toBe(200);
    const payload = JSON.parse(search.body) as {
      result?: { items?: unknown[] };
    };
    expect(Array.isArray(payload.result?.items)).toBe(true);
  });

  it('rejects unsigned POST /api/anchors/search with 401', async () => {
    const port = await startRealHttpServer();

    const search = await postJson(port, '/api/anchors/search', {
      query: 'test',
      slot: 'A',
      agent_id: 'default',
      limit: 10
    });

    expect(search.statusCode).toBe(401);
  });

  it('deletes the session cookie and invalidates subsequent /api access', async () => {
    const port = await startRealHttpServer();

    const login = await postJson(port, '/auth/session', {}, {
      Authorization: 'Bearer integration-admin-key-012345678901'
    });
    const sessionCookie = login.headers['set-cookie']?.[0] ?? '';

    const logout = await deleteRequest(port, '/auth/session', {
      Cookie: sessionCookie
    });

    expect(logout.statusCode).toBe(204);
    expect(logout.headers['set-cookie']?.[0]).toContain('memento_admin_session=');

    const api = await getJson(port, '/api/anchors/map?agent_id=default', {
      Cookie: sessionCookie
    });

    expect(api.statusCode).toBe(401);
  });

  it('keeps /api/v1/quality on the header-auth path instead of browser session auth', async () => {
    const port = await startRealHttpServer();

    const qualityWithHeader = await getJson(port, '/api/v1/quality/thresholds', {
      Authorization: 'Bearer integration-admin-key-012345678901'
    });

    expect(qualityWithHeader.statusCode).toBe(200);

    const login = await postJson(port, '/auth/session', {}, {
      Authorization: 'Bearer integration-admin-key-012345678901'
    });
    const sessionCookie = login.headers['set-cookie']?.[0] ?? '';

    const qualityWithCookieOnly = await getJson(port, '/api/v1/quality/thresholds', {
      Cookie: sessionCookie
    });

    expect(qualityWithCookieOnly.statusCode).toBe(401);

    const unknownQualityWithHeader = await getJson(port, '/api/v1/quality/not-found', {
      Authorization: 'Bearer integration-admin-key-012345678901'
    });

    expect(unknownQualityWithHeader.statusCode).toBe(404);
  });

  it('rejects unsigned GET /admin/ops/summary with 401', async () => {
    const port = await startRealHttpServer();
    const res = await getJson(port, '/admin/ops/summary?period=24h');
    expect(res.statusCode).toBe(401);
  });

  it('ops-report CLI session login can read GET /admin/ops/summary', async () => {
    const port = await startRealHttpServer();
    const endpoint = `http://127.0.0.1:${port}`;
    const adminKey = 'integration-admin-key-012345678901';
    const { establishAdminSessionCookie, createOpsReportRequest } = await import('../ops-report-cli.js');
    const { runOpsReport } = await import('../cli/ops-report-core.js');

    const sessionCookie = await establishAdminSessionCookie(endpoint, adminKey, 10_000);
    const request = createOpsReportRequest(endpoint, sessionCookie, 10_000);
    const result = await runOpsReport(
      {
        endpoint,
        apiKey: adminKey,
        period: '24h',
        json: true,
        timeoutMs: 10_000,
      },
      request,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"questions"');
  });
});
