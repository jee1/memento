import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'http';
import Database from 'better-sqlite3';
import { createAdminRouter } from '../admin.routes.js';
import { resetBatchScheduler } from '@memento/core';
import type { ServerServices } from '../../bootstrap.js';
import { createSessionStore } from '../../auth/session-store.js';
import {
  createSessionAuthMiddleware,
  DASHBOARD_SESSION_COOKIE_NAME,
} from '../../middleware/session-auth.middleware.js';

async function listen(app: express.Express): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') resolve({ server, port: addr.port });
      else reject(new Error('no port'));
    });
  });
}

function getAdmin(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: { Connection: 'close', ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function mountAdminWithSessionAuth(
  db: Database.Database,
  serverServices: ServerServices | null,
): { cookie: string; app: express.Express } {
  const store = createSessionStore({ idleTtlMs: 60_000, absoluteTtlMs: 60_000 });
  const session = store.create();
  const cookie = `${DASHBOARD_SESSION_COOKIE_NAME}=${session.sessionId}`;
  const sessionAuth = createSessionAuthMiddleware({
    store,
    cookieName: DASHBOARD_SESSION_COOKIE_NAME,
  });
  const app = express();
  app.use('/admin', sessionAuth, createAdminRouter(db, serverServices));
  return { cookie, app };
}

describe('GET /admin/ops/summary (#1561)', () => {
  let db: Database.Database;
  let server: http.Server | undefined;

  beforeEach(() => {
    db = new Database(':memory:');
    resetBatchScheduler();
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    db.close();
  });

  it('returns 401 without dashboard session (same stack as http-server /admin)', async () => {
    const app = express();
    const store = createSessionStore({ idleTtlMs: 60_000, absoluteTtlMs: 60_000 });
    const sessionAuth = createSessionAuthMiddleware({
      store,
      cookieName: DASHBOARD_SESSION_COOKIE_NAME,
    });
    app.use('/admin', sessionAuth, createAdminRouter(db, null));
    ({ server } = await listen(app));
    const port = (server.address() as { port: number }).port;
    const res = await getAdmin(port, '/admin/ops/summary?period=24h');
    expect(res.statusCode).toBe(401);
  });

  it('returns four questions and embeds admin_status contract', async () => {
    const telemetryService = {
      getSearchQuality: () => ({
        search_count: 0,
        avg_latency_ms: null,
        p95_latency_ms: null,
        empty_retrieval_rate: null,
      }),
      getSystemMetrics: () => ({
        tools: {
          recall: { request_count: 0, error_count: 0 },
          remember: { request_count: 0, error_count: 0 },
          feedback: { request_count: 0, error_count: 0 },
        },
      }),
      getEvents: () => ({ events: [], total: 0 }),
    };
    const { cookie, app } = mountAdminWithSessionAuth(
      db,
      { telemetryService } as unknown as ServerServices,
    );
    ({ server } = await listen(app));
    const port = (server.address() as { port: number }).port;
    const res = await getAdmin(port, '/admin/ops/summary?period=24h', { Cookie: cookie });
    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body) as {
      admin_status_path: string;
      admin_status: { windowDays: number };
      questions: Record<string, { availability: string }>;
    };
    expect(payload.admin_status_path).toBe('/admin/status');
    expect(payload.admin_status.windowDays).toBe(30);
    expect(payload.questions.search_health).toBeDefined();
    expect(payload.questions.batch_jobs).toBeDefined();
    expect(payload.questions.llm_pressure.availability).toBe('unmeasured');
    expect(payload.questions.quality_trend).toBeDefined();
  });

  it('rejects invalid period', async () => {
    const { cookie, app } = mountAdminWithSessionAuth(db, null);
    ({ server } = await listen(app));
    const port = (server.address() as { port: number }).port;
    const res = await getAdmin(port, '/admin/ops/summary?period=bad', { Cookie: cookie });
    expect(res.statusCode).toBe(400);
  });
});
