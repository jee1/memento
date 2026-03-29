/**
 * Admin 라우터 — sleep consolidation 계약 (contracts/admin-api.md)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'http';
import Database from 'better-sqlite3';
import { createAdminRouter } from './admin.routes.js';
import type { ServerServices } from '../bootstrap.js';
import {
  ConsolidationAlreadyRunningError,
  type SleepConsolidationRunResult
} from '@memento/core';

async function listen(app: express.Express): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve({ server, port: addr.port });
      } else {
        reject(new Error('no port'));
      }
    });
  });
}

/** fetch keep-alive로 Vitest 프로세스가 매달리는 것을 막기 위해 Connection: close + http.request 사용 */
function postAdminJson(
  port: number,
  path: string,
  body: Record<string, unknown>
): Promise<{ statusCode: number; body: string }> {
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
          Connection: 'close'
        }
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
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

describe('admin.routes consolidation', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    vi.restoreAllMocks();
  });

  it('POST /admin/consolidation/run (라우터를 /admin에 마운트) 200 및 result 형식', async () => {
    const sample: SleepConsolidationRunResult = {
      runAt: '2026-03-28T03:00:00.000Z',
      durationMs: 10,
      clustersFound: 2,
      clustersProcessed: 2,
      clustersSkipped: 0,
      semanticsCreated: 2,
      episodicsConsolidated: 8,
      errors: []
    };
    const run = vi.fn().mockResolvedValue(sample);
    const app = express();
    app.use(express.json());
    app.use(
      '/admin',
      createAdminRouter(db, {
        sleepConsolidationService: { run }
      } as unknown as ServerServices)
    );
    const { server, port } = await listen(app);
    try {
      const res = await postAdminJson(port, '/admin/consolidation/run', {
        dryRun: true,
        ownerIdFilter: 'agent-1'
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { success: boolean; result: SleepConsolidationRunResult };
      expect(body.success).toBe(true);
      expect(body.result.semanticsCreated).toBe(2);
      expect(run).toHaveBeenCalledWith({ dryRun: true, ownerIdFilter: 'agent-1' });
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('POST /admin/consolidation/run 동시 실행 시 409', async () => {
    const run = vi.fn().mockRejectedValue(new ConsolidationAlreadyRunningError());
    const app = express();
    app.use(express.json());
    app.use(
      '/admin',
      createAdminRouter(db, {
        sleepConsolidationService: { run }
      } as unknown as ServerServices)
    );
    const { server, port } = await listen(app);
    try {
      const res = await postAdminJson(port, '/admin/consolidation/run', {});
      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body) as { success: boolean; error: string };
      expect(body.success).toBe(false);
      expect(body.error).toBe('Consolidation already running');
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });
});
