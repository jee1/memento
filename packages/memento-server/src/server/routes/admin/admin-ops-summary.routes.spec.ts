import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'http';
import Database from 'better-sqlite3';
import { createAdminRouter } from '../admin.routes.js';
import { resetBatchScheduler } from '@memento/core';
import type { ServerServices } from '../../bootstrap.js';

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

function getAdmin(port: number, path: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'GET', headers: { Connection: 'close' } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.end();
  });
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
    const app = express();
    app.use(
      '/admin',
      createAdminRouter(db, { telemetryService } as unknown as ServerServices),
    );
    ({ server } = await listen(app));
    const port = (server.address() as { port: number }).port;
    const res = await getAdmin(port, '/admin/ops/summary?period=24h');
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
    const app = express();
    app.use('/admin', createAdminRouter(db, null));
    ({ server } = await listen(app));
    const port = (server.address() as { port: number }).port;
    const res = await getAdmin(port, '/admin/ops/summary?period=bad');
    expect(res.statusCode).toBe(400);
  });
});
