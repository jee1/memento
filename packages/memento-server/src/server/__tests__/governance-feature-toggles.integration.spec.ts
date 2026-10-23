import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mementoConfig } from '@memento/core';
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

describe('governance feature toggles (integration)', () => {
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
    mementoConfig.projectScopeEnabled = true;
    mementoConfig.granularToolScopesEnabled = true;
    mementoConfig.wipeMemoryEnabled = true;
  });

  describe('projectScopeEnabled toggle (MEMENTO_PROJECT_SCOPE_ENABLED)', () => {
    it('when true (ON, default), conflicting project header returns 403', async () => {
      vi.stubEnv('MEMENTO_PROJECT_SCOPE_ENABLED', 'true');
      vi.stubEnv(
        'MEMENTO_API_TOKENS',
        JSON.stringify([
          { id: 'proj-tok', secret: 'sec-proj', scopes: ['tools:invoke'], agent_id: 'test-agent', project_id: 'proj-alpha' },
        ]),
      );
      vi.resetModules();

      const port = await startRealHttpServer();
      const res = await request(
        port,
        '/tools/remember',
        'POST',
        {
          Authorization: 'Bearer sec-proj',
          'X-Memento-Project-Id': 'proj-beta',
        },
        { content: 'Test project mismatch', type: 'episodic' },
      );

      expect(res.statusCode).toBe(403);
      expect(res.body).toContain('X-Memento-Project-Id does not match');
    });

    it('when false (OFF), conflicting project header is permitted without 403', async () => {
      vi.stubEnv('MEMENTO_PROJECT_SCOPE_ENABLED', 'false');
      vi.stubEnv(
        'MEMENTO_API_TOKENS',
        JSON.stringify([
          { id: 'proj-tok', secret: 'sec-proj', scopes: ['tools:invoke'], agent_id: 'test-agent', project_id: 'proj-alpha' },
        ]),
      );
      vi.resetModules();

      const port = await startRealHttpServer();
      const res = await request(
        port,
        '/tools/remember',
        'POST',
        {
          Authorization: 'Bearer sec-proj',
          'X-Memento-Project-Id': 'proj-beta',
        },
        { content: 'Test project mismatch allowed when off', type: 'episodic' },
      );

      expect(res.statusCode).toBe(200);
    });
  });

  describe('granularToolScopesEnabled toggle (MEMENTO_GRANULAR_TOOL_SCOPES_ENABLED)', () => {
    it('when true (ON, default), tools:read token is rejected from remember with 403', async () => {
      vi.stubEnv('MEMENTO_GRANULAR_TOOL_SCOPES_ENABLED', 'true');
      vi.stubEnv(
        'MEMENTO_API_TOKENS',
        JSON.stringify([
          { id: 'read-tok', secret: 'sec-read', scopes: ['tools:read'], agent_id: 'test-agent' },
        ]),
      );
      vi.resetModules();

      const port = await startRealHttpServer();
      const res = await request(
        port,
        '/tools/remember',
        'POST',
        { Authorization: 'Bearer sec-read' },
        { content: 'Should fail in granular mode', type: 'episodic' },
      );

      expect(res.statusCode).toBe(403);
      expect(res.body).toContain('scope tools:read does not permit action write');
    });

    it('when false (OFF), tools:read token is permitted to execute remember (200)', async () => {
      vi.stubEnv('MEMENTO_GRANULAR_TOOL_SCOPES_ENABLED', 'false');
      vi.stubEnv(
        'MEMENTO_API_TOKENS',
        JSON.stringify([
          { id: 'read-tok', secret: 'sec-read', scopes: ['tools:read'], agent_id: 'test-agent' },
        ]),
      );
      vi.resetModules();

      const port = await startRealHttpServer();
      const res = await request(
        port,
        '/tools/remember',
        'POST',
        { Authorization: 'Bearer sec-read' },
        { content: 'Allowed when granular scope enforcement is off', type: 'episodic' },
      );

      expect(res.statusCode).toBe(200);
    });
  });
});
