import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cleanupTestDatabase,
  setupTestDatabase,
  type TestDatabaseContext,
} from './test/helpers/test-database.js';

type HttpResponse = {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
};

function getRequest(
  port: number,
  path: string,
  headers: Record<string, string> = {},
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
          ...headers,
        },
      },
      (res) => {
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
    req.end();
  });
}

describe('scoped API tokens integration', () => {
  let ctx: TestDatabaseContext | null = null;
  let closeServer: (() => Promise<void>) | null = null;

  async function startRealHttpServer(): Promise<number> {
    const { __test, cleanup } = await import('./http-server.js');
    __test.setTestDependencies({
      database: ctx!.db,
      serverServices: ctx!.services,
    });
    await __test.initializeServer();

    const server = __test.getServer() as http.Server;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closeServer = async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await cleanup();
    };

    return (server.address() as AddressInfo).port;
  }

  beforeEach(async () => {
    vi.stubEnv('ADMIN_API_KEY', '');
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

  it('tools token: /tools OK, /api/v1/quality 403', async () => {
    vi.stubEnv(
      'MEMENTO_API_TOKENS',
      JSON.stringify([
        { id: 'tools-1', secret: 'tools-only-secret', scopes: ['tools:invoke'] },
      ]),
    );
    vi.resetModules();

    const port = await startRealHttpServer();

    const tools = await getRequest(port, '/tools', {
      Authorization: 'Bearer tools-only-secret',
    });
    expect(tools.statusCode).toBe(200);

    const quality = await getRequest(port, '/api/v1/quality/metrics', {
      Authorization: 'Bearer tools-only-secret',
    });
    expect(quality.statusCode).toBe(403);
    expect(quality.body).toContain('admin:destructive');
  });

  it('admin token: /tools and /api/v1/quality both OK', async () => {
    vi.stubEnv(
      'MEMENTO_API_TOKENS',
      JSON.stringify([
        {
          id: 'admin-1',
          secret: 'admin-secret',
          scopes: ['admin:destructive', 'tools:invoke'],
        },
      ]),
    );
    vi.resetModules();

    const port = await startRealHttpServer();

    const tools = await getRequest(port, '/tools', {
      Authorization: 'Bearer admin-secret',
    });
    expect(tools.statusCode).toBe(200);

    const quality = await getRequest(port, '/api/v1/quality/metrics', {
      Authorization: 'Bearer admin-secret',
    });
    expect(quality.statusCode).toBe(200);
  });

  it('legacy ADMIN_API_KEY: /tools and /api/v1/quality both OK', async () => {
    vi.stubEnv('ADMIN_API_KEY', 'legacy-integration-key');
    vi.resetModules();

    const port = await startRealHttpServer();

    const tools = await getRequest(port, '/tools', {
      Authorization: 'Bearer legacy-integration-key',
    });
    expect(tools.statusCode).toBe(200);

    const quality = await getRequest(port, '/api/v1/quality/metrics', {
      Authorization: 'Bearer legacy-integration-key',
    });
    expect(quality.statusCode).toBe(200);
  });
});
