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
  body: string;
};

function getJson(port: number, path: string, headers: Record<string, string>): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path, headers: { Connection: 'close', ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });
}

function postJson(
  port: number,
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
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
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function seedOwnerScopedMemories(ctx: TestDatabaseContext): void {
  const insert = ctx.db.prepare(`
    INSERT INTO memory_item (id, type, content, importance, privacy_scope, owner_id, created_at, is_deleted)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 0)
  `);
  insert.run('mem-owner-a', 'semantic', 'owner scope alpha secret token', 0.8, 'private', 'agent-a');
  insert.run('mem-owner-b', 'semantic', 'owner scope beta secret token', 0.8, 'private', 'agent-b');
}

function memoryExists(ctx: TestDatabaseContext, id: string): boolean {
  const row = ctx.db
    .prepare('SELECT is_deleted FROM memory_item WHERE id = ?')
    .get(id) as { is_deleted: number } | undefined;
  return row !== undefined && row.is_deleted === 0;
}

describe('token-bound agent identity integration', () => {
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
    vi.stubEnv(
      'MEMENTO_API_TOKENS',
      JSON.stringify([
        { id: 'a', secret: 'secret-a', scopes: ['tools:invoke'], agent_id: 'agent-a' },
        { id: 'u', secret: 'secret-u', scopes: ['tools:invoke'] },
      ]),
    );
    vi.stubEnv('MEMENTO_OWNER_SCOPE_MODE', 'strict');
    vi.resetModules();
    ctx = await setupTestDatabase();
    seedOwnerScopedMemories(ctx);
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

  it('bound token: recall with mismatched agent header returns 403 without leaking memory', async () => {
    const port = await startRealHttpServer();

    const response = await postJson(
      port,
      '/tools/recall',
      {
        query: 'owner scope secret token',
        type: 'semantic',
        limit: 10,
        enable_hybrid: false,
      },
      {
        Authorization: 'Bearer secret-a',
        'X-Memento-Agent-Id': 'agent-b',
      },
    );

    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain('owner scope beta secret token');
  });

  it('bound token: recall naming another owner_id is refused without leaking memory', async () => {
    const port = await startRealHttpServer();

    const response = await postJson(
      port,
      '/tools/recall',
      {
        query: 'owner scope secret token',
        type: 'semantic',
        owner_id: 'agent-b',
        limit: 10,
        enable_hybrid: false,
      },
      { Authorization: 'Bearer secret-a' },
    );

    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('owner scope beta secret token');
  });

  it('bound token: recall without agent header uses bound id and returns only owned memories', async () => {
    const port = await startRealHttpServer();

    const response = await postJson(
      port,
      '/tools/recall',
      {
        query: 'owner scope secret token',
        type: 'semantic',
        limit: 10,
        enable_hybrid: false,
      },
      {
        Authorization: 'Bearer secret-a',
      },
    );

    expect(response.statusCode).toBe(200);
    const parsed = JSON.parse(response.body) as {
      result: { items: Array<{ id: string; owner_id?: string | null }> };
    };
    const items = parsed.result.items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.owner_id === 'agent-a')).toBe(true);
    expect(items.some((item) => item.id === 'mem-owner-b')).toBe(false);
  });

  it('bound token: forget with mismatched agent header returns 403 and memory remains', async () => {
    const port = await startRealHttpServer();

    const response = await postJson(
      port,
      '/tools/forget',
      {
        id: 'mem-owner-b',
        confirm: true,
      },
      {
        Authorization: 'Bearer secret-a',
        'X-Memento-Agent-Id': 'agent-b',
      },
    );

    expect(response.statusCode).toBe(403);
    expect(memoryExists(ctx!, 'mem-owner-b')).toBe(true);
  });

  it('bound token: MCP tools/call with mismatched agent header returns 403 at auth layer', async () => {
    const port = await startRealHttpServer();

    const response = await postJson(
      port,
      '/mcp',
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'recall',
          arguments: {
            query: 'owner scope secret token',
            type: 'semantic',
            limit: 10,
            enable_hybrid: false,
          },
        },
      },
      {
        Authorization: 'Bearer secret-a',
        'X-Memento-Agent-Id': 'agent-b',
      },
    );

    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain('owner scope beta secret token');
  });

  it('bound token: agent API refuses cross-agent endpoints and other owners', async () => {
    const port = await startRealHttpServer();

    const bound = await getJson(port, '/api/v1/agent/sessions/aggregate', { Authorization: 'Bearer secret-a' });
    expect(bound.statusCode).toBe(403);
    const otherOwner = await getJson(port, '/api/v1/agent/sessions?owner_id=agent-b', { Authorization: 'Bearer secret-a' });
    expect(otherOwner.statusCode).toBe(403);

    const unbound = await getJson(port, '/api/v1/agent/sessions/aggregate', { Authorization: 'Bearer secret-u' });
    expect(unbound.statusCode).toBe(200);
  });

  it('unbound token: recall with any agent header keeps legacy behavior', async () => {
    const port = await startRealHttpServer();

    const response = await postJson(
      port,
      '/tools/recall',
      {
        query: 'owner scope secret token',
        type: 'semantic',
        limit: 10,
        enable_hybrid: false,
      },
      {
        Authorization: 'Bearer secret-u',
        'X-Memento-Agent-Id': 'agent-b',
      },
    );

    expect(response.statusCode).toBe(200);
    const parsed = JSON.parse(response.body) as {
      result: { items: Array<{ id: string; owner_id?: string | null }> };
    };
    const items = parsed.result.items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.owner_id === 'agent-b')).toBe(true);
  });
});
