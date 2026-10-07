import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolContext } from '@memento/core';
import {
  cleanupTestDatabase,
  setupTestDatabase,
  type TestDatabaseContext,
} from './test/helpers/test-database.js';
import { readProjectIdHeader } from './utils/project-id-header.js';
import * as auditDispatch from './audit-tool-dispatch.js';

type HttpResponse = {
  statusCode: number;
  body: string;
};

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

function mockRequest(headers: Record<string, string | undefined> = {}): Request {
  return {
    get(name: string) {
      const key = Object.keys(headers).find((h) => h.toLowerCase() === name.toLowerCase());
      return key ? headers[key] : undefined;
    },
  } as Request;
}

describe('readProjectIdHeader', () => {
  it('returns trimmed value when within max length', () => {
    expect(readProjectIdHeader(mockRequest({ 'x-memento-project-id': '  memento  ' }))).toBe('memento');
  });

  it('returns undefined for blank or over-length values', () => {
    expect(readProjectIdHeader(mockRequest({ 'x-memento-project-id': '   ' }))).toBeUndefined();
    expect(readProjectIdHeader(mockRequest({ 'x-memento-project-id': 'x'.repeat(201) }))).toBeUndefined();
    expect(readProjectIdHeader(mockRequest())).toBeUndefined();
  });
});

describe('createToolDispatcher projectId', () => {
  it('passes auditContext.projectId into ToolContext', async () => {
    let captured: ToolContext | undefined;
    const dispatch = auditDispatch.createToolDispatcher({
      execute: async (_name, _args, context) => {
        captured = context;
        return { content: [] };
      },
    });

    await dispatch(
      'remember',
      {},
      {} as never,
      {} as never,
      { transport: 'rest', projectId: 'proj-from-header' },
    );

    expect(captured?.projectId).toBe('proj-from-header');
  });
});

describe('X-Memento-Project-Id integration', () => {
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

  function projectIdForContent(content: string): string | null {
    const row = ctx!.db.prepare(
      'SELECT project_id FROM memory_item WHERE content = ?',
    ).get(content) as { project_id: string | null } | undefined;
    return row?.project_id ?? null;
  }

  beforeEach(async () => {
    vi.stubEnv('ADMIN_API_KEY', '');
    vi.stubEnv(
      'MEMENTO_API_TOKENS',
      JSON.stringify([
        { id: 'u', secret: 'secret-u', scopes: ['tools:invoke'] },
      ]),
    );
    vi.stubEnv('MEMENTO_OWNER_SCOPE_MODE', 'off');
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

  it('stores project_id from X-Memento-Project-Id on REST remember', async () => {
    const port = await startRealHttpServer();

    const response = await postJson(
      port,
      '/tools/remember',
      {
        content: 'header project memory',
        type: 'semantic',
      },
      {
        Authorization: 'Bearer secret-u',
        'X-Memento-Project-Id': 'memento',
      },
    );

    expect(response.statusCode).toBe(200);
    expect(projectIdForContent('header project memory')).toBe('memento');
  });

  it('stores NULL project_id when header is absent', async () => {
    const port = await startRealHttpServer();

    const response = await postJson(
      port,
      '/tools/remember',
      {
        content: 'no header project memory',
        type: 'semantic',
      },
      {
        Authorization: 'Bearer secret-u',
      },
    );

    expect(response.statusCode).toBe(200);
    expect(projectIdForContent('no header project memory')).toBeNull();
  });

  it('ignores over-length X-Memento-Project-Id header', async () => {
    const port = await startRealHttpServer();

    const response = await postJson(
      port,
      '/tools/remember',
      {
        content: 'overlong header project memory',
        type: 'semantic',
      },
      {
        Authorization: 'Bearer secret-u',
        'X-Memento-Project-Id': 'x'.repeat(201),
      },
    );

    expect(response.statusCode).toBe(200);
    expect(projectIdForContent('overlong header project memory')).toBeNull();
  });
});
