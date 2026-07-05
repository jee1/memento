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
  body: string;
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

function seedOwnerScopedMemories(ctx: TestDatabaseContext): void {
  const insert = ctx.db.prepare(`
    INSERT INTO memory_item (id, type, content, importance, privacy_scope, owner_id, created_at, is_deleted)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 0)
  `);
  insert.run('mem-owner-a', 'semantic', 'owner scope alpha secret token', 0.8, 'private', 'agent-a');
  insert.run('mem-owner-b', 'semantic', 'owner scope beta secret token', 0.8, 'private', 'agent-b');
}

describe('HTTP owner scope integration', () => {
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

  it('strict mode: recall with X-Memento-Agent-Id returns only that owner memories', async () => {
    const port = await startRealHttpServer();

    const response = await postJson(
      port,
      '/tools/recall',
      {
        query: 'owner scope secret token',
        type: 'semantic',
        limit: 10,
        enable_hybrid: false
      },
      {
        Authorization: 'Bearer integration-admin-key',
        'X-Memento-Agent-Id': 'agent-a'
      }
    );

    expect(response.statusCode).toBe(200);
    const parsed = JSON.parse(response.body) as {
      result: { items: Array<{ id: string; owner_id?: string | null }> };
    };
    const items = parsed.result.items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every(item => item.owner_id === 'agent-a')).toBe(true);
    expect(items.some(item => item.id === 'mem-owner-b')).toBe(false);
  });

  it('strict mode: recall without agent header or owner_id returns 400', async () => {
    const port = await startRealHttpServer();

    const response = await postJson(
      port,
      '/tools/recall',
      {
        query: 'owner scope secret token',
        type: 'semantic',
        limit: 10,
        enable_hybrid: false
      },
      {
        Authorization: 'Bearer integration-admin-key'
      }
    );

    expect(response.statusCode).toBe(400);
    const parsed = JSON.parse(response.body) as { error: string; message: string };
    expect(parsed.error).toBe('Owner scope required');
    expect(parsed.message).toContain('MEMENTO_OWNER_SCOPE_MODE=strict');
  });
});
