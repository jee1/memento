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
  type SleepConsolidationRunResult,
  TelemetryService,
  TelemetryRepository,
  TelemetryEventsMigration,
  TelemetryDailyMetricsMigration
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

function getAdmin(port: number, path: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: { Connection: 'close' }
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

describe('admin.routes telemetry', () => {
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

  const sampleSearchQuality = {
    period: '24h' as const,
    owner_id: null,
    search_count: 0,
    avg_latency_ms: null,
    p95_latency_ms: null,
    empty_retrieval_rate: null,
    avg_candidate_count: null,
    top_k_selected_rate: null,
    timestamp: '2026-03-29T12:00:00.000Z'
  };

  const sampleMemoryQuality = {
    owner_id: null,
    total_memories: 0,
    type_distribution: {},
    duplicate_write_rate_24h: null,
    relation_coverage_ratio: null,
    orphan_memory_ratio: null,
    timestamp: '2026-03-29T12:00:00.000Z'
  };

  const emptyBucket = {
    request_count: null,
    success_count: null,
    error_count: null,
    error_rate: null,
    avg_latency_ms: null,
    p95_latency_ms: null
  };

  const sampleSystem = {
    period: '24h' as const,
    tools: {
      recall: emptyBucket,
      remember: emptyBucket,
      feedback: emptyBucket
    },
    background_jobs: {
      sleep_consolidation: {
        last_run_at: null,
        last_outcome: null,
        total_runs_24h: null,
        success_runs_24h: null,
        failure_runs_24h: null,
        avg_duration_ms: null,
        last_duration_ms: null
      },
      telemetry_cleanup: {
        last_run_at: null,
        last_outcome: null,
        total_runs_24h: null,
        success_runs_24h: null,
        failure_runs_24h: null,
        avg_duration_ms: null,
        last_duration_ms: null
      }
    },
    timestamp: '2026-03-29T12:00:00.000Z'
  };

  it('GET /admin/telemetry/search-quality 200 및 period=7d', async () => {
    const getSearchQuality = vi.fn().mockImplementation((period: string) => ({
      ...sampleSearchQuality,
      period
    }));
    const app = express();
    app.use(
      '/admin',
      createAdminRouter(db, {
        telemetryService: {
          getSearchQuality,
          getMemoryQuality: vi.fn(),
          getSystemMetrics: vi.fn(),
          getEvents: vi.fn()
        }
      } as unknown as ServerServices)
    );
    const { server, port } = await listen(app);
    try {
      const res = await getAdmin(port, '/admin/telemetry/search-quality?period=7d');
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { period: string };
      expect(body.period).toBe('7d');
      expect(getSearchQuality).toHaveBeenCalledWith('7d', null);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/telemetry/search-quality 잘못된 period는 400', async () => {
    const app = express();
    app.use(
      '/admin',
      createAdminRouter(db, {
        telemetryService: {
          getSearchQuality: vi.fn(),
          getMemoryQuality: vi.fn(),
          getSystemMetrics: vi.fn(),
          getEvents: vi.fn()
        }
      } as unknown as ServerServices)
    );
    const { server, port } = await listen(app);
    try {
      const res = await getAdmin(port, '/admin/telemetry/search-quality?period=bad');
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { allowed: string[] };
      expect(body.allowed).toEqual(['24h', '7d', '30d']);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/telemetry/search-quality 빈 period 문자열은 400 (FR-013)', async () => {
    const app = express();
    app.use(
      '/admin',
      createAdminRouter(db, {
        telemetryService: {
          getSearchQuality: vi.fn(),
          getMemoryQuality: vi.fn(),
          getSystemMetrics: vi.fn(),
          getEvents: vi.fn()
        }
      } as unknown as ServerServices)
    );
    const { server, port } = await listen(app);
    try {
      const res = await getAdmin(port, '/admin/telemetry/search-quality?period=');
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { allowed: string[] };
      expect(body.allowed).toEqual(['24h', '7d', '30d']);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/telemetry/system 잘못된 period는 400 (FR-013)', async () => {
    const app = express();
    app.use(
      '/admin',
      createAdminRouter(db, {
        telemetryService: {
          getSearchQuality: vi.fn(),
          getMemoryQuality: vi.fn(),
          getSystemMetrics: vi.fn(),
          getEvents: vi.fn()
        }
      } as unknown as ServerServices)
    );
    const { server, port } = await listen(app);
    try {
      const resBad = await getAdmin(port, '/admin/telemetry/system?period=bad');
      expect(resBad.statusCode).toBe(400);
      const bodyBad = JSON.parse(resBad.body) as { allowed: string[] };
      expect(bodyBad.allowed).toEqual(['24h', '7d', '30d']);

      const resEmpty = await getAdmin(port, '/admin/telemetry/system?period=');
      expect(resEmpty.statusCode).toBe(400);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/telemetry/memory-quality 200 및 필수 필드', async () => {
    const getMemoryQuality = vi.fn().mockReturnValue(sampleMemoryQuality);
    const app = express();
    app.use(
      '/admin',
      createAdminRouter(db, {
        telemetryService: {
          getSearchQuality: vi.fn(),
          getMemoryQuality,
          getSystemMetrics: vi.fn(),
          getEvents: vi.fn()
        }
      } as unknown as ServerServices)
    );
    const { server, port } = await listen(app);
    try {
      const res = await getAdmin(port, '/admin/telemetry/memory-quality');
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as typeof sampleMemoryQuality;
      expect(body).toHaveProperty('type_distribution');
      expect(body).toHaveProperty('duplicate_write_rate_24h');
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/telemetry/system tools·background_jobs 형식', async () => {
    const getSystemMetrics = vi.fn().mockReturnValue(sampleSystem);
    const app = express();
    app.use(
      '/admin',
      createAdminRouter(db, {
        telemetryService: {
          getSearchQuality: vi.fn(),
          getMemoryQuality: vi.fn(),
          getSystemMetrics,
          getEvents: vi.fn()
        }
      } as unknown as ServerServices)
    );
    const { server, port } = await listen(app);
    try {
      const res = await getAdmin(port, '/admin/telemetry/system?period=24h');
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as typeof sampleSystem;
      expect(body.tools.recall).toHaveProperty('p95_latency_ms');
      expect(body.background_jobs.telemetry_cleanup).toHaveProperty('success_runs_24h');
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/telemetry/events limit>100 이면 400', async () => {
    const app = express();
    app.use(
      '/admin',
      createAdminRouter(db, {
        telemetryService: {
          getSearchQuality: vi.fn(),
          getMemoryQuality: vi.fn(),
          getSystemMetrics: vi.fn(),
          getEvents: vi.fn()
        }
      } as unknown as ServerServices)
    );
    const { server, port } = await listen(app);
    try {
      const res = await getAdmin(port, '/admin/telemetry/events?limit=101');
      expect(res.statusCode).toBe(400);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/telemetry/events from>to 이면 400', async () => {
    const app = express();
    app.use(
      '/admin',
      createAdminRouter(db, {
        telemetryService: {
          getSearchQuality: vi.fn(),
          getMemoryQuality: vi.fn(),
          getSystemMetrics: vi.fn(),
          getEvents: vi.fn()
        }
      } as unknown as ServerServices)
    );
    const { server, port } = await listen(app);
    try {
      const res = await getAdmin(
        port,
        '/admin/telemetry/events?from=2026-03-02T00:00:00.000Z&to=2026-03-01T00:00:00.000Z'
      );
      expect(res.statusCode).toBe(400);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it(
    'SC-003: search-quality 단일 요청이 2000ms 미만 (실 TelemetryRepository·querySearchQuality·HTTP 경로)',
    async () => {
      const telemDb = new Database(':memory:');
      try {
        await new TelemetryEventsMigration().up(telemDb);
        await new TelemetryDailyMetricsMigration().up(telemDb);
        const repo = new TelemetryRepository(telemDb);
        telemDb.transaction(() => {
          for (let i = 0; i < 1000; i++) {
            const rid = `adm-sc3-${i}`;
            repo.insertEventSync({
              eventType: 'memory.search.requested',
              requestId: rid,
              ownerId: null,
              outcome: 'success'
            });
            repo.insertEventSync({
              eventType: 'memory.search.empty',
              requestId: rid,
              ownerId: null,
              outcome: 'empty',
              latencyMs: (i % 40) + 1
            });
          }
        })();
        const telemetryService = new TelemetryService(repo);
        const app = express();
        app.use(
          '/admin',
          createAdminRouter(telemDb, {
            telemetryService
          } as unknown as ServerServices)
        );
        const { server, port } = await listen(app);
        try {
          const t0 = Date.now();
          const res = await getAdmin(port, '/admin/telemetry/search-quality?period=24h');
          expect(res.statusCode).toBe(200);
          expect(Date.now() - t0).toBeLessThan(2000);
          const body = JSON.parse(res.body) as { search_count: number };
          expect(body.search_count).toBe(1000);
        } finally {
          await new Promise<void>(r => server.close(() => r()));
        }
      } finally {
        try {
          telemDb.close();
        } catch {
          /* ignore */
        }
      }
    },
    10_000
  );
});
