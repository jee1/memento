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

  beforeEach(async () => {
    vi.stubEnv('ADMIN_API_KEY', 'integration-admin-key');
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
    const { __test } = await import('./http-server.js');
    __test.setTestDependencies({
      database: ctx!.db,
      serverServices: ctx!.services
    });
    await __test.initializeServer();

    const server = __test.getServer() as http.Server;
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    closeServer = async () => {
      await new Promise<void>(resolve => server.close(() => resolve()));
    };
    const port = (server.address() as AddressInfo).port;

    const login = await postJson(port, '/auth/session', {}, {
      Authorization: 'Bearer integration-admin-key'
    });

    expect(login.statusCode).toBe(204);
    expect(login.headers['set-cookie']?.[0]).toContain('memento_admin_session=');

    const api = await getJson(port, '/api/anchors/map?agent_id=default', {
      Cookie: login.headers['set-cookie']?.[0] ?? ''
    });

    expect(api.statusCode).toBe(200);
  });

  it('deletes the session cookie and invalidates subsequent /api access', async () => {
    const { __test } = await import('./http-server.js');
    __test.setTestDependencies({
      database: ctx!.db,
      serverServices: ctx!.services
    });
    await __test.initializeServer();

    const server = __test.getServer() as http.Server;
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    closeServer = async () => {
      await new Promise<void>(resolve => server.close(() => resolve()));
    };
    const port = (server.address() as AddressInfo).port;

    const login = await postJson(port, '/auth/session', {}, {
      Authorization: 'Bearer integration-admin-key'
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
    const { __test } = await import('./http-server.js');
    __test.setTestDependencies({
      database: ctx!.db,
      serverServices: ctx!.services
    });
    await __test.initializeServer();

    const server = __test.getServer() as http.Server;
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    closeServer = async () => {
      await new Promise<void>(resolve => server.close(() => resolve()));
    };
    const port = (server.address() as AddressInfo).port;

    const qualityWithHeader = await getJson(port, '/api/v1/quality/thresholds', {
      Authorization: 'Bearer integration-admin-key'
    });

    expect(qualityWithHeader.statusCode).toBe(200);

    const login = await postJson(port, '/auth/session', {}, {
      Authorization: 'Bearer integration-admin-key'
    });
    const sessionCookie = login.headers['set-cookie']?.[0] ?? '';

    const qualityWithCookieOnly = await getJson(port, '/api/v1/quality/thresholds', {
      Cookie: sessionCookie
    });

    expect(qualityWithCookieOnly.statusCode).toBe(401);
  });
});
