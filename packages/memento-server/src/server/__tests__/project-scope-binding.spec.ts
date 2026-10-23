import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cleanupTestDatabase,
  setupTestDatabase,
  type TestDatabaseContext,
} from '../test/helpers/test-database.js';

type HttpResponse = {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
};

function request(
  port: number,
  path: string,
  method: string,
  headers: Record<string, string> = {},
  payload?: unknown,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const postData = payload !== undefined ? JSON.stringify(payload) : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          Connection: 'close',
          ...(postData ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } : {}),
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
    if (postData) req.write(postData);
    req.end();
  });
}

describe('project-scope-binding integration', () => {
  let ctx: TestDatabaseContext | null = null;
  let closeServer: (() => Promise<void>) | null = null;

  async function startRealHttpServer(): Promise<number> {
    const { __test, cleanup } = await import('../http-server.js');
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

  it('bound token without header uses bound project_id', async () => {
    vi.stubEnv(
      'MEMENTO_API_TOKENS',
      JSON.stringify([
        { id: 'proj-token', secret: 'bound-sec', scopes: ['tools:invoke'], projectId: 'project-a' },
      ]),
    );
    vi.resetModules();

    const port = await startRealHttpServer();
    const res = await request(port, '/tools', 'GET', { Authorization: 'Bearer bound-sec' });
    expect(res.statusCode).toBe(200);
  });

  it('bound token with matching header succeeds', async () => {
    vi.stubEnv(
      'MEMENTO_API_TOKENS',
      JSON.stringify([
        { id: 'proj-token', secret: 'bound-sec', scopes: ['tools:invoke'], projectId: 'project-a' },
      ]),
    );
    vi.resetModules();

    const port = await startRealHttpServer();
    const res = await request(port, '/tools', 'GET', {
      Authorization: 'Bearer bound-sec',
      'X-Memento-Project-Id': 'project-a',
    });
    expect(res.statusCode).toBe(200);
  });

  it('bound token with conflicting project header returns 403', async () => {
    vi.stubEnv(
      'MEMENTO_API_TOKENS',
      JSON.stringify([
        { id: 'proj-token', secret: 'bound-sec', scopes: ['tools:invoke'], projectId: 'project-a' },
      ]),
    );
    vi.resetModules();

    const port = await startRealHttpServer();
    const res = await request(port, '/tools', 'GET', {
      Authorization: 'Bearer bound-sec',
      'X-Memento-Project-Id': 'project-conflict',
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain('X-Memento-Project-Id does not match the project bound to this API token.');
  });

  it('unbound token with custom project header keeps legacy behavior', async () => {
    vi.stubEnv(
      'MEMENTO_API_TOKENS',
      JSON.stringify([
        { id: 'unbound-token', secret: 'unbound-sec', scopes: ['tools:invoke'] },
      ]),
    );
    vi.resetModules();

    const port = await startRealHttpServer();
    const res = await request(port, '/tools', 'GET', {
      Authorization: 'Bearer unbound-sec',
      'X-Memento-Project-Id': 'custom-project',
    });
    expect(res.statusCode).toBe(200);
  });

  it('tool dispatch with bound project token scopes inserted memory to project', async () => {
    vi.stubEnv(
      'MEMENTO_API_TOKENS',
      JSON.stringify([
        { id: 'proj-token', secret: 'bound-sec', scopes: ['tools:invoke'], projectId: 'project-scoped' },
      ]),
    );
    vi.resetModules();

    const port = await startRealHttpServer();
    const res = await request(
      port,
      '/tools/remember',
      'POST',
      { Authorization: 'Bearer bound-sec' },
      { content: 'Project memory test', type: 'episodic' },
    );

    expect(res.statusCode).toBe(200);
    const row = ctx!.db.prepare('SELECT project_id FROM memory_item WHERE content = ?').get('Project memory test') as { project_id?: string };
    expect(row?.project_id).toBe('project-scoped');
  });
});
