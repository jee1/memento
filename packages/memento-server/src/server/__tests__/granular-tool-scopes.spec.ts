import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertToolScope,
  auditActionForTool,
  ToolScopeForbiddenError,
} from '../audit-tool-dispatch.js';
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

describe('auditActionForTool and assertToolScope units', () => {
  it('maps tool names to correct audit actions', () => {
    expect(auditActionForTool('recall')).toBe('read');
    expect(auditActionForTool('memory_injection')).toBe('read');
    expect(auditActionForTool('export')).toBe('read');
    expect(auditActionForTool('search_local')).toBe('read');
    expect(auditActionForTool('get_status')).toBe('read');
    expect(auditActionForTool('list_anchors')).toBe('read');

    expect(auditActionForTool('forget')).toBe('delete');
    expect(auditActionForTool('remove_relation')).toBe('delete');
    expect(auditActionForTool('delete_batch')).toBe('delete');

    expect(auditActionForTool('remember')).toBe('write');
    expect(auditActionForTool('pin')).toBe('write');
    expect(auditActionForTool('unpin')).toBe('write');
    expect(auditActionForTool('feedback')).toBe('write');
    expect(auditActionForTool('add_relation')).toBe('write');
  });

  it('allows all actions for tools:invoke', () => {
    expect(() => assertToolScope('recall', ['tools:invoke'])).not.toThrow();
    expect(() => assertToolScope('remember', ['tools:invoke'])).not.toThrow();
    expect(() => assertToolScope('forget', ['tools:invoke'])).not.toThrow();
  });

  it('enforces read-only behavior for tools:read', () => {
    expect(() => assertToolScope('recall', ['tools:read'])).not.toThrow();
    expect(() => assertToolScope('remember', ['tools:read'])).toThrow(ToolScopeForbiddenError);
    expect(() => assertToolScope('forget', ['tools:read'])).toThrow(ToolScopeForbiddenError);

    try {
      assertToolScope('remember', ['tools:read']);
    } catch (e) {
      expect((e as Error).message).toContain('scope tools:read does not permit action write');
    }

    try {
      assertToolScope('forget', ['tools:read']);
    } catch (e) {
      expect((e as Error).message).toContain('scope tools:read does not permit action delete');
    }
  });

  it('enforces write behavior for tools:write', () => {
    expect(() => assertToolScope('remember', ['tools:write'])).not.toThrow();
    expect(() => assertToolScope('forget', ['tools:write'])).not.toThrow();
    expect(() => assertToolScope('recall', ['tools:write'])).toThrow(ToolScopeForbiddenError);

    try {
      assertToolScope('recall', ['tools:write']);
    } catch (e) {
      expect((e as Error).message).toContain('scope tools:write does not permit action read');
    }
  });

  it('allows both read and write for combined scopes', () => {
    expect(() => assertToolScope('recall', ['tools:read', 'tools:write'])).not.toThrow();
    expect(() => assertToolScope('remember', ['tools:read', 'tools:write'])).not.toThrow();
    expect(() => assertToolScope('forget', ['tools:read', 'tools:write'])).not.toThrow();
  });

  it('rejects operator-only tools when boundAgentId is set', () => {
    expect(() => assertToolScope('get_introspection_summary', ['tools:invoke'], 'agent-b')).toThrow(ToolScopeForbiddenError);
    expect(() => assertToolScope('get_introspection_summary', ['tools:invoke'])).not.toThrow();
    expect(() => assertToolScope('forgetting_stats', ['tools:invoke'], 'agent-b')).toThrow(ToolScopeForbiddenError);
    expect(() => assertToolScope('forgetting_stats', ['tools:invoke'])).not.toThrow();
    expect(() => assertToolScope('performance_stats', ['tools:invoke'], 'agent-b')).toThrow(ToolScopeForbiddenError);
    expect(() => assertToolScope('performance_stats', ['tools:invoke'])).not.toThrow();
    expect(() => assertToolScope('introspection_heal', ['tools:invoke'], 'agent-b')).toThrow(ToolScopeForbiddenError);
    expect(() => assertToolScope('cleanup_memory', ['tools:invoke'], 'agent-b')).toThrow(ToolScopeForbiddenError);
    expect(() => assertToolScope('migrate_embeddings', ['tools:invoke'], 'agent-b')).toThrow(ToolScopeForbiddenError);
    expect(() => assertToolScope('introspection_heal', ['tools:invoke'])).not.toThrow();
    expect(() => assertToolScope('recall', ['tools:invoke'], 'agent-b')).not.toThrow();
  });

  it('rejects operator-only tools when only boundProjectId is set', () => {
    for (const name of ['get_introspection_summary', 'forgetting_stats', 'performance_stats', 'introspection_heal', 'cleanup_memory', 'migrate_embeddings']) {
      expect(() => assertToolScope(name, ['tools:invoke'], null, 'project-b'), name).toThrow(ToolScopeForbiddenError);
    }
    expect(() => assertToolScope('recall', ['tools:invoke'], null, 'project-b')).not.toThrow();
  });
});

describe('granular-tool-scopes HTTP integration', () => {
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

  it('tools:invoke super-scope allows all tools', async () => {
    vi.stubEnv(
      'MEMENTO_API_TOKENS',
      JSON.stringify([
        { id: 'invoke-tok', secret: 'sec-invoke-01234567890123456789012', scopes: ['tools:invoke'], agent_id: 'test-agent' },
      ]),
    );
    vi.resetModules();

    const port = await startRealHttpServer();

    const remRes = await request(
      port,
      '/tools/remember',
      'POST',
      { Authorization: 'Bearer sec-invoke-01234567890123456789012' },
      { content: 'Super scope test', type: 'episodic' },
    );
    expect(remRes.statusCode).toBe(200);

    const recRes = await request(
      port,
      '/tools/recall',
      'POST',
      { Authorization: 'Bearer sec-invoke-01234567890123456789012' },
      { query: 'Super scope test', type: 'episodic' },
    );
    expect(recRes.statusCode).toBe(200);
  });

  it('tools:read allows recall (200), rejects remember (403) and forget (403)', async () => {
    vi.stubEnv(
      'MEMENTO_API_TOKENS',
      JSON.stringify([
        { id: 'read-tok', secret: 'sec-read-0123456789012345678901234', scopes: ['tools:read'], agent_id: 'test-agent' },
      ]),
    );
    vi.resetModules();

    const port = await startRealHttpServer();

    const recRes = await request(
      port,
      '/tools/recall',
      'POST',
      { Authorization: 'Bearer sec-read-0123456789012345678901234' },
      { query: 'any query', type: 'episodic' },
    );
    expect(recRes.statusCode).toBe(200);

    const remRes = await request(
      port,
      '/tools/remember',
      'POST',
      { Authorization: 'Bearer sec-read-0123456789012345678901234' },
      { content: 'Must fail', type: 'episodic' },
    );
    expect(remRes.statusCode).toBe(403);
    expect(remRes.body).toContain('scope tools:read does not permit action write');

    const fgtRes = await request(
      port,
      '/tools/forget',
      'POST',
      { Authorization: 'Bearer sec-read-0123456789012345678901234' },
      { id: 'non-existent', hard: false },
    );
    expect(fgtRes.statusCode).toBe(403);
    expect(fgtRes.body).toContain('scope tools:read does not permit action delete');
  });

  it('tools:write allows remember (200), rejects recall (403)', async () => {
    vi.stubEnv(
      'MEMENTO_API_TOKENS',
      JSON.stringify([
        { id: 'write-tok', secret: 'sec-write-012345678901234567890123', scopes: ['tools:write'], agent_id: 'test-agent' },
      ]),
    );
    vi.resetModules();

    const port = await startRealHttpServer();

    const remRes = await request(
      port,
      '/tools/remember',
      'POST',
      { Authorization: 'Bearer sec-write-012345678901234567890123' },
      { content: 'Write only test', type: 'episodic' },
    );
    expect(remRes.statusCode).toBe(200);

    const recRes = await request(
      port,
      '/tools/recall',
      'POST',
      { Authorization: 'Bearer sec-write-012345678901234567890123' },
      { query: 'any query', type: 'episodic' },
    );
    expect(recRes.statusCode).toBe(403);
    expect(recRes.body).toContain('scope tools:write does not permit action read');
  });

  it('combined tools:read and tools:write allows both recall and remember', async () => {
    vi.stubEnv(
      'MEMENTO_API_TOKENS',
      JSON.stringify([
        { id: 'dual-tok', secret: 'sec-dual-0123456789012345678901234', scopes: ['tools:read', 'tools:write'], agent_id: 'test-agent' },
      ]),
    );
    vi.resetModules();

    const port = await startRealHttpServer();

    const remRes = await request(
      port,
      '/tools/remember',
      'POST',
      { Authorization: 'Bearer sec-dual-0123456789012345678901234' },
      { content: 'Dual scope test', type: 'episodic' },
    );
    expect(remRes.statusCode).toBe(200);

    const recRes = await request(
      port,
      '/tools/recall',
      'POST',
      { Authorization: 'Bearer sec-dual-0123456789012345678901234' },
      { query: 'Dual scope test', type: 'episodic' },
    );
    expect(recRes.statusCode).toBe(200);
  });

  it('admin:destructive token is segregated and rejected from tool routes at middleware', async () => {
    vi.stubEnv(
      'MEMENTO_API_TOKENS',
      JSON.stringify([
        { id: 'admin-tok', secret: 'sec-admin-012345678901234567890123', scopes: ['admin:destructive'], agent_id: 'test-agent' },
      ]),
    );
    vi.resetModules();

    const port = await startRealHttpServer();

    const res = await request(
      port,
      '/tools/recall',
      'POST',
      { Authorization: 'Bearer sec-admin-012345678901234567890123' },
      { query: 'test', type: 'episodic' },
    );
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain('Insufficient API token scope');
  });

  it('logs audit failure when dispatch is rejected for missing scope (Lane 9)', async () => {
    vi.stubEnv(
      'MEMENTO_API_TOKENS',
      JSON.stringify([
        { id: 'read-tok', secret: 'sec-read-0123456789012345678901234', scopes: ['tools:read'], agent_id: 'test-agent' },
      ]),
    );
    vi.resetModules();

    const port = await startRealHttpServer();

    await request(
      port,
      '/tools/remember',
      'POST',
      { Authorization: 'Bearer sec-read-0123456789012345678901234' },
      { content: 'Will fail audit check', type: 'episodic' },
    );

    const logRow = ctx!.db
      .prepare("SELECT result_status, tool_or_endpoint, action FROM audit_log WHERE tool_or_endpoint = 'remember' ORDER BY id DESC LIMIT 1")
      .get() as { result_status?: string; tool_or_endpoint?: string; action?: string };

    expect(['failure', 'denied']).toContain(logRow?.result_status);
    expect(logRow?.tool_or_endpoint).toBe('remember');
    expect(['write', 'auth_denied']).toContain(logRow?.action);
  });
});
