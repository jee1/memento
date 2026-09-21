/**
 * Admin 라우터 — sleep consolidation 계약 (contracts/admin-api.md)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import express from 'express';
import http from 'http';
import Database from 'better-sqlite3';
import { createAdminRouter } from './admin.routes.js';
import { resetBatchRunHistoryForTests } from '../batch-run-history.js';
import { resetReviewCandidatesSseHubForTests } from '../review-candidates-sse-hub.js';
import type { ServerServices } from '../bootstrap.js';
import {
  type SleepConsolidationRunResult,
  TelemetryService,
  TelemetryRepository,
  TelemetryEventsMigration,
  TelemetryDailyMetricsMigration,
  MetaMemoryStatsSchemaMigration,
  MemoryReviewCandidateSchemaMigration,
  ReviewQueueHealthSnapshotMigration,
  upsertPendingMemoryReviewCandidates,
  listMemoryReviewCandidates,
  getBatchScheduler,
  resetBatchScheduler,
  JobRunMigration,
  JobRunLogMigration,
  JobRunRepository,
  JobRunLogRepository,
  mementoConfig,
} from '@memento/core';

const DAY_MS = 86_400_000;

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

function deleteAdmin(port: number, path: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'DELETE',
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

describe('admin.routes live stats and maintenance', () => {
  it('preserves performance, forgetting, optimize, and cleanup route contracts', async () => {
    const database = new Database(':memory:');
    database.exec(`
      CREATE TABLE memory_item (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      INSERT INTO memory_item (id, type, pinned, created_at) VALUES
        ('working-old', 'working', 0, datetime('now', '-3 days')),
        ('semantic-pinned', 'semantic', 1, datetime('now'));
    `);
    const app = express();
    app.use(express.json());
    app.use('/admin', createAdminRouter(database, null));
    const { server, port } = await listen(app);

    try {
      const performance = await getAdmin(port, '/admin/stats/performance');
      expect(performance.statusCode).toBe(200);
      expect(JSON.parse(performance.body)).toMatchObject({
        message: '성능 통계 조회 완료',
        stats: { total_memories: 2, working_memories: 1, semantic_memories: 1 },
      });

      const forgetting = await getAdmin(port, '/admin/stats/forgetting');
      expect(forgetting.statusCode).toBe(200);
      expect(JSON.parse(forgetting.body)).toMatchObject({ message: '망각 통계 조회 완료' });

      const optimize = await postAdminJson(port, '/admin/database/optimize', {});
      expect(optimize.statusCode).toBe(200);
      expect(JSON.parse(optimize.body)).toMatchObject({ message: '데이터베이스 최적화 완료' });

      const cleanup = await postAdminJson(port, '/admin/memory/cleanup', {});
      expect(cleanup.statusCode).toBe(200);
      expect(JSON.parse(cleanup.body)).toMatchObject({
        message: '메모리 정리 완료',
        deleted_count: 1,
      });
      expect(database.prepare('SELECT id FROM memory_item ORDER BY id').all()).toEqual([
        { id: 'semantic-pinned' },
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
      database.close();
    }
  });
});

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
      semanticsMerged: 0,
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

  it('POST /admin/consolidation/run 동시 실행 시 no-op 결과(200)', async () => {
    const run = vi.fn().mockResolvedValue({
      runAt: '2026-03-28T03:00:00.000Z',
      durationMs: 0,
      clustersFound: 0,
      clustersProcessed: 0,
      clustersSkipped: 0,
      semanticsCreated: 0,
      semanticsMerged: 0,
      episodicsConsolidated: 0,
      errors: [],
      skippedDueToConcurrentRun: true
    } satisfies SleepConsolidationRunResult);
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
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { success: boolean; result: SleepConsolidationRunResult };
      expect(body.success).toBe(true);
      expect(body.result.skippedDueToConcurrentRun).toBe(true);
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

  it('GET /admin/telemetry/feedback 200 및 period=7d', async () => {
    const getFeedbackQuality = vi.fn().mockImplementation((period: string) => ({
      period,
      owner_id: null,
      helpful_rate: 0.8,
      positive_count: 4,
      negative_count: 1,
      feedback_with_ranking_context_count: 2,
      timestamp: '2026-07-05T00:00:00.000Z'
    }));
    const app = express();
    app.use(
      '/admin',
      createAdminRouter(db, {
        telemetryService: {
          getSearchQuality: vi.fn(),
          getMemoryQuality: vi.fn(),
          getSystemMetrics: vi.fn(),
          getFeedbackQuality,
          getEvents: vi.fn()
        }
      } as unknown as ServerServices)
    );
    const { server, port } = await listen(app);
    try {
      const res = await getAdmin(port, '/admin/telemetry/feedback?period=7d');
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { period: string; helpful_rate: number };
      expect(body.period).toBe('7d');
      expect(body.helpful_rate).toBe(0.8);
      expect(getFeedbackQuality).toHaveBeenCalledWith('7d', null);
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

// ============================================================
// T003~T008: GET /admin/graph 테스트 (009-memory-graph-view)
// Constitution I: 테스트 먼저 작성, 실패 확인 후 구현
// ============================================================

describe('admin.routes graph', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    // memory_item 테이블 생성
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_item (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'working',
        importance REAL DEFAULT 0.5,
        created_at TEXT DEFAULT (datetime('now')),
        tags TEXT DEFAULT '[]',
        pinned INTEGER DEFAULT 0,
          project_id TEXT,
          is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
          deleted_at TEXT
      );
    `);
    // memory_relation 테이블 생성
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_relation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        confidence REAL DEFAULT 1.0
      );
    `);
  });

  afterEach(() => {
    try { db.close(); } catch { /* ignore */ }
    vi.restoreAllMocks();
  });

  function makeApp(database: Database.Database) {
    const app = express();
    app.use(express.json());
    app.use('/admin', createAdminRouter(database, null));
    return app;
  }

  // T003 + T006: 기본 구조 및 nodes/edges 반환 검증
  it('GET /admin/graph — DB에 데이터가 있을 때 nodes와 edges를 반환한다', async () => {
    db.prepare(`INSERT INTO memory_item (id, content, type, importance) VALUES (?, ?, ?, ?)`).run(
      'mem-1', 'TypeScript 인터페이스에 관한 기억', 'semantic', 0.8
    );
    db.prepare(`INSERT INTO memory_item (id, content, type, importance) VALUES (?, ?, ?, ?)`).run(
      'mem-2', 'TDD 방법론에 관한 기억', 'episodic', 0.6
    );
    db.prepare(`INSERT INTO memory_relation (source_id, target_id, relation_type, confidence) VALUES (?, ?, ?, ?)`).run(
      'mem-1', 'mem-2', 'supports', 0.9
    );

    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/graph');
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { nodes: unknown[]; edges: unknown[]; meta: unknown };
      expect(body.nodes).toBeDefined();
      expect(body.edges).toBeDefined();
      expect(body.meta).toBeDefined();
      expect(body.nodes.length).toBe(2);
      expect(body.edges.length).toBe(1);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // T007: 빈 DB 처리
  it('GET /admin/graph — DB가 비어있을 때 빈 nodes/edges를 반환한다', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/graph');
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { nodes: unknown[]; edges: unknown[] };
      expect(Array.isArray(body.nodes)).toBe(true);
      expect(Array.isArray(body.edges)).toBe(true);
      expect(body.nodes.length).toBe(0);
      expect(body.edges.length).toBe(0);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // T008: 응답 포맷 검증 (GraphNode 필드)
  it('GET /admin/graph — GraphNode 응답 포맷이 올바르다 (label, content, type, importance, created_at, tags, pinned)', async () => {
    db.prepare(`
      INSERT INTO memory_item (id, content, type, importance, tags, pinned) VALUES (?, ?, ?, ?, ?, ?)
    `).run('mem-1', 'A'.repeat(100), 'semantic', 0.75, '["tag1","tag2"]', 0);

    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/graph');
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { nodes: Array<Record<string, unknown>> };
      const node = body.nodes[0];
      expect(typeof node['id']).toBe('string');
      expect(typeof node['label']).toBe('string');
      expect((node['label'] as string).length).toBeLessThanOrEqual(53); // 50자 + '...'
      expect(typeof node['content']).toBe('string');
      expect((node['content'] as string).length).toBe(100); // 전체 내용
      expect(typeof node['type']).toBe('string');
      expect(typeof node['importance']).toBe('number');
      expect(typeof node['created_at']).toBe('string');
      expect(Array.isArray(node['tags'])).toBe(true);
      expect(typeof node['pinned']).toBe('boolean');
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // T017: US2 — content 전체 포함 검증
  it('GET /admin/graph — GraphNode에 content 전체와 label(truncated)이 모두 포함된다', async () => {
    const longContent = 'B'.repeat(200);
    db.prepare(`INSERT INTO memory_item (id, content, type) VALUES (?, ?, ?)`).run(
      'mem-1', longContent, 'episodic'
    );

    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/graph');
      const body = JSON.parse(res.body) as { nodes: Array<Record<string, unknown>> };
      const node = body.nodes[0];
      expect(node['content']).toBe(longContent);
      expect(node['label']).toBe('B'.repeat(50) + '...');
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // T021: US3 — types 필터 검증
  it('GET /admin/graph?types=episodic — episodic 타입 노드만 반환한다', async () => {
    db.prepare(`INSERT INTO memory_item (id, content, type) VALUES (?, ?, ?)`).run('m1', '에피소딕 기억', 'episodic');
    db.prepare(`INSERT INTO memory_item (id, content, type) VALUES (?, ?, ?)`).run('m2', '시맨틱 기억', 'semantic');

    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/graph?types=episodic');
      const body = JSON.parse(res.body) as { nodes: Array<Record<string, unknown>> };
      expect(body.nodes.length).toBe(1);
      expect(body.nodes[0]['type']).toBe('episodic');
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // T022: US3 — min_importance 필터 검증
  it('GET /admin/graph?min_importance=0.8 — importance < 0.8인 노드를 제외한다', async () => {
    db.prepare(`INSERT INTO memory_item (id, content, type, importance) VALUES (?, ?, ?, ?)`).run('m1', '높은 중요도', 'semantic', 0.9);
    db.prepare(`INSERT INTO memory_item (id, content, type, importance) VALUES (?, ?, ?, ?)`).run('m2', '낮은 중요도', 'semantic', 0.5);

    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/graph?min_importance=0.8');
      const body = JSON.parse(res.body) as { nodes: Array<Record<string, unknown>> };
      expect(body.nodes.length).toBe(1);
      expect(body.nodes[0]['importance']).toBeGreaterThanOrEqual(0.8);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // T023: US3 — limit 및 meta.truncated 검증
  it('GET /admin/graph?limit=1 — 노드 1개만 반환하고 meta.truncated=true', async () => {
    db.prepare(`INSERT INTO memory_item (id, content, type, importance) VALUES (?, ?, ?, ?)`).run('m1', '기억1', 'semantic', 0.9);
    db.prepare(`INSERT INTO memory_item (id, content, type, importance) VALUES (?, ?, ?, ?)`).run('m2', '기억2', 'semantic', 0.7);

    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/graph?limit=1');
      const body = JSON.parse(res.body) as { nodes: unknown[]; meta: { truncated: boolean } };
      expect(body.nodes.length).toBeLessThanOrEqual(1);
      expect(body.meta.truncated).toBe(true);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // I-002: relation_types 필터 검증
  it('GET /admin/graph?relation_types=supports — 해당 relation_type 엣지만 반환한다', async () => {
    db.prepare(`INSERT INTO memory_item (id, content, type) VALUES (?, ?, ?)`).run('m1', '기억1', 'semantic');
    db.prepare(`INSERT INTO memory_item (id, content, type) VALUES (?, ?, ?)`).run('m2', '기억2', 'semantic');
    db.prepare(`INSERT INTO memory_item (id, content, type) VALUES (?, ?, ?)`).run('m3', '기억3', 'semantic');
    db.prepare(`INSERT INTO memory_relation (source_id, target_id, relation_type, confidence) VALUES (?, ?, ?, ?)`).run('m1', 'm2', 'supports', 0.9);
    db.prepare(`INSERT INTO memory_relation (source_id, target_id, relation_type, confidence) VALUES (?, ?, ?, ?)`).run('m1', 'm3', 'related_to', 0.7);

    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/graph?relation_types=supports');
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { nodes: unknown[]; edges: Array<Record<string, unknown>> };
      expect(body.edges.length).toBe(1);
      expect(body.edges[0]['relation_type']).toBe('supports');
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // #837: DB orphan 제외 — memory_relation 에 한 번도 안 나오는 노드를 뺀다
  it('GET /admin/graph?exclude_orphans=true — memory_relation 에 없는 노드를 제외한다', async () => {
    db.prepare(`INSERT INTO memory_item (id, content, type, importance) VALUES (?, ?, ?, ?)`).run('c1', '연결된 기억1', 'semantic', 0.8);
    db.prepare(`INSERT INTO memory_item (id, content, type, importance) VALUES (?, ?, ?, ?)`).run('c2', '연결된 기억2', 'semantic', 0.7);
    db.prepare(`INSERT INTO memory_item (id, content, type, importance) VALUES (?, ?, ?, ?)`).run('lonely', '고아 기억', 'semantic', 0.99);
    db.prepare(`INSERT INTO memory_relation (source_id, target_id, relation_type, confidence) VALUES (?, ?, ?, ?)`).run('c1', 'c2', 'supports', 0.9);

    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/graph?exclude_orphans=true');
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        nodes: Array<{ id: string }>;
        meta: { total_available_nodes: number; applied_filters: { exclude_orphans: boolean } };
      };
      expect(body.nodes.map(n => n.id).sort()).toEqual(['c1', 'c2']);
      expect(body.meta.total_available_nodes).toBe(2);
      expect(body.meta.applied_filters.exclude_orphans).toBe(true);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // #837: limit 칸이 관계 있는 노드에 쓰인다 (완료 기준 2)
  it('GET /admin/graph?exclude_orphans=true — limit 칸을 관계 있는 노드에 쓴다', async () => {
    db.prepare(`INSERT INTO memory_item (id, content, type, importance) VALUES (?, ?, ?, ?)`).run('c1', '연결된 기억1', 'semantic', 0.8);
    db.prepare(`INSERT INTO memory_item (id, content, type, importance) VALUES (?, ?, ?, ?)`).run('c2', '연결된 기억2', 'semantic', 0.7);
    db.prepare(`INSERT INTO memory_item (id, content, type, importance) VALUES (?, ?, ?, ?)`).run('lonely', '고아 기억', 'semantic', 0.99);
    db.prepare(`INSERT INTO memory_relation (source_id, target_id, relation_type, confidence) VALUES (?, ?, ?, ?)`).run('c1', 'c2', 'supports', 0.9);

    const off = await listen(makeApp(db));
    try {
      const res = await getAdmin(off.port, '/admin/graph?limit=2');
      const body = JSON.parse(res.body) as { nodes: Array<{ id: string }>; edges: unknown[] };
      expect(body.nodes.map(n => n.id).sort()).toEqual(['c1', 'lonely']);
      expect(body.edges.length).toBe(0);
    } finally {
      await new Promise<void>(r => off.server.close(() => r()));
    }

    const on = await listen(makeApp(db));
    try {
      const res = await getAdmin(on.port, '/admin/graph?limit=2&exclude_orphans=true');
      const body = JSON.parse(res.body) as { nodes: Array<{ id: string }>; edges: unknown[] };
      expect(body.nodes.map(n => n.id).sort()).toEqual(['c1', 'c2']);
      expect(body.edges.length).toBe(1);
    } finally {
      await new Promise<void>(r => on.server.close(() => r()));
    }
  });

  // #837: relation_types 가 걸리면 그 유형만 관계로 인정한다
  it('GET /admin/graph?exclude_orphans=true&relation_types=supports — 다른 유형으로만 연결된 노드는 고아로 본다', async () => {
    db.prepare(`INSERT INTO memory_item (id, content, type, importance) VALUES (?, ?, ?, ?)`).run('s1', 'supports 로 연결', 'semantic', 0.9);
    db.prepare(`INSERT INTO memory_item (id, content, type, importance) VALUES (?, ?, ?, ?)`).run('s2', 'supports 로 연결', 'semantic', 0.8);
    db.prepare(`INSERT INTO memory_item (id, content, type, importance) VALUES (?, ?, ?, ?)`).run('r1', 'related_to 로만 연결', 'semantic', 0.85);
    db.prepare(`INSERT INTO memory_item (id, content, type, importance) VALUES (?, ?, ?, ?)`).run('r2', 'related_to 로만 연결', 'semantic', 0.1);
    db.prepare(`INSERT INTO memory_relation (source_id, target_id, relation_type, confidence) VALUES (?, ?, ?, ?)`).run('s1', 's2', 'supports', 0.9);
    db.prepare(`INSERT INTO memory_relation (source_id, target_id, relation_type, confidence) VALUES (?, ?, ?, ?)`).run('r1', 'r2', 'related_to', 0.7);

    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/graph?exclude_orphans=true&relation_types=supports');
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { nodes: Array<{ id: string }> };
      expect(body.nodes.map(n => n.id).sort()).toEqual(['s1', 's2']);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // #837: 기본값은 off — 고아를 그대로 남긴다 (#126 발견 용도)
  it('GET /admin/graph — exclude_orphans 기본값은 false 이고 고아가 남는다', async () => {
    db.prepare(`INSERT INTO memory_item (id, content, type, importance) VALUES (?, ?, ?, ?)`).run('c1', '연결된 기억1', 'semantic', 0.8);
    db.prepare(`INSERT INTO memory_item (id, content, type, importance) VALUES (?, ?, ?, ?)`).run('c2', '연결된 기억2', 'semantic', 0.7);
    db.prepare(`INSERT INTO memory_item (id, content, type, importance) VALUES (?, ?, ?, ?)`).run('lonely', '고아 기억', 'semantic', 0.99);
    db.prepare(`INSERT INTO memory_relation (source_id, target_id, relation_type, confidence) VALUES (?, ?, ?, ?)`).run('c1', 'c2', 'supports', 0.9);

    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/graph');
      const body = JSON.parse(res.body) as {
        nodes: Array<{ id: string }>;
        meta: { applied_filters: { exclude_orphans: boolean } };
      };
      expect(body.nodes.length).toBe(3);
      expect(body.meta.applied_filters.exclude_orphans).toBe(false);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // #837: 잘못된 값은 400
  it('GET /admin/graph?exclude_orphans=yes — 400 반환', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/graph?exclude_orphans=yes');
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toBe('잘못된 파라미터');
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // I-005: types 화이트리스트 검증
  it('GET /admin/graph?types=invalid — 400 반환', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/graph?types=invalid_type');
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toBe('잘못된 파라미터');
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // T033: 잘못된 파라미터 검증 — min_importance 범위 초과
  it('GET /admin/graph?min_importance=1.5 — 400 반환', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/graph?min_importance=1.5');
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toBe('잘못된 파라미터');
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // T033: 잘못된 파라미터 검증 — limit 범위 초과
  it('GET /admin/graph?limit=9999 — 400 반환', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/graph?limit=9999');
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toBe('잘못된 파라미터');
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/graph?view=full — 기본 1000개 제한을 넘겨 축약 그래프를 반환한다', async () => {
    const insert = db.prepare(`
      INSERT INTO memory_item (id, content, type, importance) VALUES (?, ?, 'semantic', ?)
    `);
    const tx = db.transaction(() => {
      for (let i = 0; i < 1100; i++) {
        insert.run(`m${i}`, `전체 그래프 테스트 기억 ${i}`, 0.5);
      }
    });
    tx();

    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/graph?view=full');
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        nodes: unknown[];
        meta: {
          total_available_nodes: number;
          graph_view: string;
          fields: string;
          default_limit: number;
          max_limit: number;
          truncated: boolean;
        };
      };
      expect(body.nodes).toHaveLength(1100);
      expect(body.meta.total_available_nodes).toBe(1100);
      expect(body.meta.graph_view).toBe('full');
      expect(body.meta.fields).toBe('minimal');
      expect(body.meta.default_limit).toBe(5000);
      expect(body.meta.max_limit).toBe(5000);
      expect(body.meta.truncated).toBe(false);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/graph?view=full&fields=minimal — 긴 content를 축약해 대용량 응답을 완화한다', async () => {
    const longContent = '긴 본문 '.repeat(120);
    db.prepare(`INSERT INTO memory_item (id, content, type, importance) VALUES (?, ?, ?, ?)`).run(
      'm-long', longContent, 'semantic', 0.9
    );

    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/graph?view=full&fields=minimal');
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        nodes: Array<{ content: string; content_truncated?: boolean }>;
        meta: { fields: string };
      };
      expect(body.meta.fields).toBe('minimal');
      expect(body.nodes[0].content.length).toBeLessThan(longContent.length);
      expect(body.nodes[0].content_truncated).toBe(true);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/graph?view=full&limit=5001 — full 모드 상한 초과 시 400 반환', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/graph?view=full&limit=5001');
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { error: string; message: string };
      expect(body.error).toBe('잘못된 파라미터');
      expect(body.message).toContain('1~5000');
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/graph?view=full&fields=full — 대용량 본문 응답을 거부한다', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/graph?view=full&fields=full');
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { error: string; message: string };
      expect(body.error).toBe('잘못된 파라미터');
      expect(body.message).toContain('fields=minimal');
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });
});

// ============================================================
// Project memory admin routes (Issue #81)
// ============================================================

describe('Project memory admin routes', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_item (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'working',
        content TEXT NOT NULL,
        importance REAL DEFAULT 0.5,
        project_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        is_deleted INTEGER DEFAULT 0,
          deleted_at TEXT
      )
    `);
  });

  afterEach(() => {
    try { db.close(); } catch { /* ignore */ }
    vi.restoreAllMocks();
  });

  function makeApp(database: Database.Database) {
    const app = express();
    app.use(express.json());
    app.use('/admin', createAdminRouter(database, null));
    return app;
  }

  it('GET /admin/memory/project/:project_id/stats returns counts', async () => {
    db.exec(`
      INSERT INTO memory_item (id, type, content, importance, project_id, created_at, is_deleted)
      VALUES
        ('ps1', 'semantic', 'a', 0.5, 'proj-test', datetime('now'), 0),
        ('ps2', 'episodic', 'b', 0.5, 'proj-test', datetime('now'), 0),
        ('ps3', 'semantic', 'c', 0.5, 'other-proj', datetime('now'), 0)
    `);

    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/memory/project/proj-test/stats');
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { project_id: string; total: number };
      expect(body.project_id).toBe('proj-test');
      expect(body.total).toBe(2);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/memory/project/:project_id/cleanup/preview returns 400 when older_than_days missing', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/memory/project/proj-x/cleanup/preview');
      expect(res.statusCode).toBe(400);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/memory/project/:project_id/cleanup/preview returns 400 when types includes core', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/memory/project/proj-x/cleanup/preview?older_than_days=90&types=core');
      expect(res.statusCode).toBe(400);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/memory/project/:project_id/cleanup/preview returns would_delete without deleting', async () => {
    const old = new Date(Date.now() - 100 * DAY_MS).toISOString();
    db.exec(`INSERT INTO memory_item (id, type, content, importance, project_id, created_at, is_deleted) VALUES ('old1', 'episodic', 'old', 0.5, 'proj-preview', '${old}', 0)`);

    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/memory/project/proj-preview/cleanup/preview?older_than_days=90');
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { would_delete: number };
      expect(body.would_delete).toBe(1);
      // Verify not deleted
      const count = db.prepare(`SELECT COUNT(*) as c FROM memory_item WHERE id = 'old1'`).get() as { c: number };
      expect(count.c).toBe(1);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('DELETE /admin/memory/project/:project_id/cleanup deletes old memories', async () => {
    const old = new Date(Date.now() - 100 * DAY_MS).toISOString();
    db.exec(`INSERT INTO memory_item (id, type, content, importance, project_id, created_at, is_deleted) VALUES ('del1', 'episodic', 'del', 0.5, 'proj-del', '${old}', 0)`);

    const { server, port } = await listen(makeApp(db));
    try {
      const res = await deleteAdmin(port, '/admin/memory/project/proj-del/cleanup?older_than_days=90');
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { deleted: number };
      expect(body.deleted).toBe(1);
      const count = db.prepare(`SELECT COUNT(*) as c FROM memory_item WHERE id = 'del1'`).get() as { c: number };
      expect(count.c).toBe(0);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/memory/project/:project_id/cleanup/preview returns 400 when older_than_days > 3650', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/memory/project/proj-x/cleanup/preview?older_than_days=3651');
      expect(res.statusCode).toBe(400);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('DELETE /admin/memory/project/:project_id/cleanup returns 400 when older_than_days > 3650', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await deleteAdmin(port, '/admin/memory/project/proj-x/cleanup?older_than_days=9999999');
      expect(res.statusCode).toBe(400);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/memory/project/:project_id/stats returns 400 when project_id exceeds 200 chars', async () => {
    const longId = 'a'.repeat(201);
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, `/admin/memory/project/${longId}/stats`);
      expect(res.statusCode).toBe(400);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });
});

describe('admin.routes memory review candidates', () => {
  let db: Database.Database;
  let pendingId: string;
  const NOW = '2026-06-01T12:00:00.000Z';

  function createBaseSchema(database: Database.Database): void {
    database.exec(`
      CREATE TABLE IF NOT EXISTS memory_item (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        importance REAL DEFAULT 0.5,
        privacy_scope TEXT DEFAULT 'private',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_accessed TIMESTAMP,
        last_accessed_at TEXT,
        pinned BOOLEAN DEFAULT FALSE,
        tags TEXT,
        source TEXT,
        project_id TEXT,
        owner_id TEXT,
        is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
        deleted_at TEXT
      );
    `);
    database.exec(`
      CREATE TABLE IF NOT EXISTS memento_schema_version (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        migration_name TEXT NOT NULL,
        checksum TEXT,
        applied_by TEXT DEFAULT 'system',
        description TEXT
      );
    `);
  }

  function makeApp(database: Database.Database) {
    const app = express();
    app.use(express.json());
    app.use('/admin', createAdminRouter(database, null));
    return app;
  }

  beforeEach(async () => {
    resetReviewCandidatesSseHubForTests();
    db = new Database(':memory:');
    createBaseSchema(db);
    await new MetaMemoryStatsSchemaMigration().up(db);
    await new MemoryReviewCandidateSchemaMigration().up(db);
    await new ReviewQueueHealthSnapshotMigration().up(db);
    await new JobRunMigration().up(db);
    await new JobRunLogMigration().up(db);
    db.pragma('foreign_keys = ON');
    db.exec(`
      INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at, pinned, is_deleted, deleted_at)
      VALUES (
        'mem_stale',
        'semantic',
        'Stale high-importance memory',
        0.85,
        'private',
        '2020-01-15 00:00:00',
        0,
        0,
        NULL
      )
    `);
    db.exec(`
      INSERT INTO meta_memory_stats (
        memory_id, recall_count, success_count, failure_count,
        avg_confidence, last_recalled_at, created_at, updated_at
      ) VALUES (
        'mem_stale',
        10, 8, 2,
        0.8,
        '2020-06-01 00:00:00',
        '2020-06-01 00:00:00',
        '2020-06-01 00:00:00'
      )
    `);
    upsertPendingMemoryReviewCandidates(
      db,
      [
        {
          memory_id: 'mem_stale',
          priority: 0.7,
          reason: 'test seed',
          due_at: '2026-07-01T00:00:00.000Z',
          metadata_json: null
        }
      ],
      NOW
    );
    const row = db
      .prepare(`SELECT id FROM memory_review_candidate WHERE memory_id = ? AND status = 'pending'`)
      .get('mem_stale') as { id: string };
    pendingId = row.id;
  });

  afterEach(() => {
    resetReviewCandidatesSseHubForTests();
    try {
      db.close();
    } catch {
      /* ignore */
    }
  });

  function readStreamUntil(
    port: number,
    path: string,
    needle: string,
    timeoutMs: number
  ): Promise<{ statusCode: number; contentType: string; text: string }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        req.destroy();
        reject(new Error(`stream read timeout waiting for: ${needle}`));
      }, timeoutMs);
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method: 'GET',
          headers: { Connection: 'close' }
        },
        res => {
          const statusCode = res.statusCode ?? 0;
          const rawCt = res.headers['content-type'];
          const contentType = Array.isArray(rawCt) ? rawCt[0] : (rawCt ?? '');
          let buf = '';
          res.on('data', (c: Buffer) => {
            buf += c.toString('utf8');
            if (buf.includes(needle)) {
              clearTimeout(timer);
              req.destroy();
              resolve({ statusCode, contentType, text: buf });
            }
          });
          res.on('end', () => {
            clearTimeout(timer);
            reject(new Error(`stream ended without needle; got: ${buf.slice(0, 200)}`));
          });
        }
      );
      req.on('error', err => {
        clearTimeout(timer);
        reject(err);
      });
      req.end();
    });
  }

  it('GET /admin/memory/items/mem_stale returns 200 with memory.content', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/memory/items/mem_stale');
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body) as { memory?: { content?: string; id?: string } };
      expect(json.memory?.id).toBe('mem_stale');
      expect(json.memory?.content).toBe('Stale high-importance memory');
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/memory/items/bad..id returns 400', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/memory/items/not%20valid');
      expect(res.statusCode).toBe(400);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/memory/items/mem_missing returns 404', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/memory/items/mem_does_not_exist');
      expect(res.statusCode).toBe(404);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/memory/review-candidates returns 200 and no memory_item.content field', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/memory/review-candidates');
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body) as { candidates: unknown[] };
      expect(Array.isArray(json.candidates)).toBe(true);
      const first = json.candidates[0] as Record<string, unknown> | undefined;
      if (first) {
        expect(first).not.toHaveProperty('content');
        expect(first).toHaveProperty('memory_id');
      }
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/memory/review-candidates?status=bad returns 400', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/memory/review-candidates?status=bad');
      expect(res.statusCode).toBe(400);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('#897: paginated review-candidates returns metadata and enriched fields without content', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(
        port,
        '/admin/memory/review-candidates?status=pending&page_size=25&page=1&importance_min=0.8',
      );
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body) as {
        candidates: Array<Record<string, unknown>>;
        pagination?: { page_size?: number; total_count?: number };
        filters_applied?: { importance_min?: number };
      };
      expect(json.pagination).toMatchObject({ page_size: 25, total_count: 1 });
      expect(json.filters_applied?.importance_min).toBe(0.8);
      expect(json.candidates[0]).toMatchObject({
        memory_id: 'mem_stale',
        memory_type: 'semantic',
      });
      expect(json.candidates[0]).not.toHaveProperty('content');
      expect(json.candidates[0]).toHaveProperty('unused_days');
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('#897: rejects invalid page_size and page without page_size', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const badSize = await getAdmin(port, '/admin/memory/review-candidates?page_size=100');
      expect(badSize.statusCode).toBe(400);
      const pageOnly = await getAdmin(port, '/admin/memory/review-candidates?page=2');
      expect(pageOnly.statusCode).toBe(400);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('#897: rejects malformed numeric query params without parseInt truncation', async () => {
    const { server, port } = await listen(makeApp(db));
    const malformed = [
      '/admin/memory/review-candidates?status=pending&page_size=25abc&page=1',
      '/admin/memory/review-candidates?status=pending&page_size=25&page=1.9',
      '/admin/memory/review-candidates?status=pending&page_size=25&page=10days',
      '/admin/memory/review-candidates?status=pending&page_size=25&page=1&unused_days_min=10days',
      '/admin/memory/review-candidates?status=pending&page_size=25&page=1&importance_min=0.8abc',
      '/admin/memory/review-candidates?status=pending&page_size=25&page=1&importance_min=1.9',
    ];
    try {
      for (const path of malformed) {
        const res = await getAdmin(port, path);
        expect(res.statusCode).toBe(400);
      }
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('#897: has_prev is false when filtered total_count is zero on page > 1', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(
        port,
        '/admin/memory/review-candidates?status=pending&page_size=25&page=3&importance_min=0.99',
      );
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body) as {
        candidates: unknown[];
        pagination?: { total_count?: number; has_prev?: boolean; page?: number };
      };
      expect(json.candidates).toHaveLength(0);
      expect(json.pagination).toMatchObject({
        total_count: 0,
        page: 3,
        has_prev: false,
      });
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('POST review twice returns 409 on second call', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res1 = await postAdminJson(port, `/admin/memory/review-candidates/${pendingId}/review`, {});
      expect(res1.statusCode).toBe(200);
      const res2 = await postAdminJson(port, `/admin/memory/review-candidates/${pendingId}/review`, {});
      expect(res2.statusCode).toBe(409);
      const j2 = JSON.parse(res2.body) as { code: string };
      expect(j2.code).toBe('memory_review_candidate_not_actionable');
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('POST dismiss for unknown UUID returns 404', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const id = randomUUID();
      const res = await postAdminJson(port, `/admin/memory/review-candidates/${id}/dismiss`, {});
      expect(res.statusCode).toBe(404);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('POST review with invalid id returns 400', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await postAdminJson(port, '/admin/memory/review-candidates/not-a-uuid/review', {});
      expect(res.statusCode).toBe(400);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('POST bulk-dismiss updates all pending candidates', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await postAdminJson(port, '/admin/memory/review-candidates/bulk-dismiss', {
        all_pending: true,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { action?: string; matched?: number; updated?: number };
      expect(body).toMatchObject({ action: 'dismiss', matched: 1, updated: 1 });
      expect(listMemoryReviewCandidates(db, { status: 'dismissed' })).toHaveLength(1);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('POST bulk-expire rejects mixed selectors', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await postAdminJson(port, '/admin/memory/review-candidates/bulk-expire', {
        all_pending: true,
        ids: [pendingId],
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('POST /admin/batch/run accepts memory_review_candidates (200 with started scheduler)', async () => {
    resetBatchScheduler();
    const scheduler = getBatchScheduler();
    await scheduler.start(db);
    try {
      const { server, port } = await listen(makeApp(db));
      try {
        const res = await postAdminJson(port, '/admin/batch/run', { jobType: 'memory_review_candidates' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { result?: { jobType?: string } };
        expect(body.result?.jobType).toBe('memory_review_candidates');
      } finally {
        await new Promise<void>(r => server.close(() => r()));
      }
    } finally {
      await scheduler.stop();
      resetBatchScheduler();
      resetBatchRunHistoryForTests();
    }
  });

  it('GET /admin/batch/run-history is empty before any manual run (#295)', async () => {
    resetBatchRunHistoryForTests();
    const { server, port } = await listen(makeApp(db));
    try {
      const histRes = await getAdmin(port, '/admin/batch/run-history');
      expect(histRes.statusCode).toBe(200);
      const body = JSON.parse(histRes.body) as { entries?: unknown[] };
      expect(body.entries).toEqual([]);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/batch/run-history lists entry after POST /admin/batch/run (#295)', async () => {
    resetBatchRunHistoryForTests();
    resetBatchScheduler();
    const scheduler = getBatchScheduler();
    await scheduler.start(db);
    try {
      const { server, port } = await listen(makeApp(db));
      try {
        const postRes = await postAdminJson(port, '/admin/batch/run', { jobType: 'memory_review_candidates' });
        expect(postRes.statusCode).toBe(200);
        const histRes = await getAdmin(port, '/admin/batch/run-history?limit=10');
        expect(histRes.statusCode).toBe(200);
        const body = JSON.parse(histRes.body) as {
          entries?: Array<{ jobType?: string; success?: boolean }>;
        };
        expect(Array.isArray(body.entries)).toBe(true);
        expect(body.entries?.length).toBeGreaterThanOrEqual(1);
        expect(body.entries?.[0]?.jobType).toBe('memory_review_candidates');
        expect(body.entries?.[0]?.success).toBe(true);
      } finally {
        await new Promise<void>(r => server.close(() => r()));
      }
    } finally {
      await scheduler.stop();
      resetBatchScheduler();
      resetBatchRunHistoryForTests();
    }
  });

  it('GET /admin/batch/runs is empty before any run (#833)', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/batch/runs');
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { runs?: unknown[]; limit?: number };
      expect(body.runs).toEqual([]);
      expect(body.limit).toBe(50);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/batch/runs lists a durable manual-trigger entry after POST /admin/batch/run (#833)', async () => {
    resetBatchScheduler();
    resetBatchRunHistoryForTests();
    const scheduler = getBatchScheduler();
    await scheduler.start(db);
    try {
      const { server, port } = await listen(makeApp(db));
      try {
        const postRes = await postAdminJson(port, '/admin/batch/run', { jobType: 'memory_review_candidates' });
        expect(postRes.statusCode).toBe(200);

        const runsRes = await getAdmin(port, '/admin/batch/runs');
        expect(runsRes.statusCode).toBe(200);
        const body = JSON.parse(runsRes.body) as {
          runs: Array<{
            id: string;
            jobName: string;
            trigger: string;
            startedAt: string;
            endedAt: string;
            success: boolean;
            durationMs: number;
          }>;
          limit: number;
        };
        expect(body.runs).toHaveLength(1);
        expect(body.runs[0]).toMatchObject({
          jobName: 'memory_review_candidates',
          trigger: 'manual',
          success: true,
        });
        expect(typeof body.runs[0]?.id).toBe('string');
        expect(typeof body.runs[0]?.durationMs).toBe('number');
      } finally {
        await new Promise<void>(r => server.close(() => r()));
      }
    } finally {
      await scheduler.stop();
      resetBatchScheduler();
      resetBatchRunHistoryForTests();
    }
  });

  it('GET /admin/batch/runs?job= filters by job name (#833)', async () => {
    new JobRunRepository().append(db, {
      job_name: 'cleanup',
      trigger: 'schedule',
      started_at: '2026-09-06T00:00:00.000Z',
      ended_at: '2026-09-06T00:00:01.000Z',
      success: true,
      duration_ms: 1000,
    });
    new JobRunRepository().append(db, {
      job_name: 'monitoring',
      trigger: 'schedule',
      started_at: '2026-09-06T00:00:02.000Z',
      ended_at: '2026-09-06T00:00:03.000Z',
      success: true,
      duration_ms: 1000,
    });
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/batch/runs?job=monitoring');
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { runs: Array<{ jobName: string }> };
      expect(body.runs).toHaveLength(1);
      expect(body.runs[0]?.jobName).toBe('monitoring');
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/batch/runs?limit= clamps to 1..100 (#833)', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const tooLow = await getAdmin(port, '/admin/batch/runs?limit=0');
      expect((JSON.parse(tooLow.body) as { limit: number }).limit).toBe(1);

      const tooHigh = await getAdmin(port, '/admin/batch/runs?limit=1000');
      expect((JSON.parse(tooHigh.body) as { limit: number }).limit).toBe(100);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/batch/runs returns 500 when db is unavailable (#833)', async () => {
    const app = express();
    app.use(express.json());
    app.use('/admin', createAdminRouter(null, null));
    const { server, port } = await listen(app);
    try {
      const res = await getAdmin(port, '/admin/batch/runs');
      expect(res.statusCode).toBe(500);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/batch/stats returns JSON-safe detailed shape (#832)', async () => {
    resetBatchScheduler();
    const scheduler = getBatchScheduler();
    await scheduler.start(db);
    try {
      const { server, port } = await listen(makeApp(db));
      try {
        const res = await getAdmin(port, '/admin/batch/stats');
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as Record<string, unknown>;
        expect(typeof body.message).toBe('string');
        expect(typeof body.schedulerRunning).toBe('boolean');
        expect(body.schedulerRunning).toBe(true);
        expect(typeof body.timestamp).toBe('string');
        expect(body).not.toHaveProperty('status');

        const health = body.health as Record<string, unknown>;
        expect(typeof health.memoryUsage).toBe('number');
        expect(typeof health.runningJobs).toBe('number');
        expect(typeof health.queueSize).toBe('number');
        expect(typeof health.errorRate).toBe('number');
        expect(typeof health.uptime).toBe('number');
        expect(typeof health.uptimeHuman).toBe('string');
        expect(String(health.uptimeHuman)).toMatch(/(일|시간|분|초)$/);

        const jobs = body.jobs as Array<Record<string, unknown>>;
        expect(Array.isArray(jobs)).toBe(true);
        expect(jobs.length).toBeGreaterThan(0);
        for (const job of jobs) {
          expect(typeof job.name).toBe('string');
          expect(job.intervalMs === null || typeof job.intervalMs === 'number').toBe(true);
          expect(job.enabled).toBe(true);
          expect(job.paused).toBe(false);
          expect(job.lastExecution === null || typeof job.lastExecution === 'string').toBe(true);
          expect(typeof job.totalExecutions).toBe('number');
          expect(typeof job.errorCount).toBe('number');
          expect(typeof job.errorRate).toBe('number');
          expect(typeof job.isRunning).toBe('boolean');
        }

        const queue = body.queue as Record<string, unknown>;
        expect(typeof queue.size).toBe('number');
        expect(typeof queue.runningCount).toBe('number');
        expect(Array.isArray(queue.runningNames)).toBe(true);
        expect(Array.isArray(queue.queuedNames)).toBe(true);

        // Round-trip: no Map/Date leakage (JSON stays plain).
        const again = JSON.parse(JSON.stringify(body)) as typeof body;
        expect(again).toEqual(body);
      } finally {
        await new Promise<void>(r => server.close(() => r()));
      }
    } finally {
      await scheduler.stop();
      resetBatchScheduler();
    }
  });

  it('GET /admin/batch/stats is empty-safe when scheduler is not running (#832)', async () => {
    resetBatchScheduler();
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/batch/stats');
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        schedulerRunning: boolean;
        jobs: unknown[];
        queue: { size: number; runningCount: number; runningNames: string[]; queuedNames: string[] };
        health: { runningJobs: number; queueSize: number; uptime: number };
      };
      expect(body.schedulerRunning).toBe(false);
      expect(body.jobs).toEqual([]);
      expect(body.queue.size).toBe(0);
      expect(body.queue.runningCount).toBe(0);
      expect(body.queue.runningNames).toEqual([]);
      expect(body.queue.queuedNames).toEqual([]);
      expect(body.health.runningJobs).toBe(0);
      expect(body.health.queueSize).toBe(0);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
      resetBatchScheduler();
    }
  });

  it('GET /admin/batch/status shape remains unchanged (#832 US4)', async () => {
    resetBatchScheduler();
    const scheduler = getBatchScheduler();
    await scheduler.start(db);
    try {
      const { server, port } = await listen(makeApp(db));
      try {
        const res = await getAdmin(port, '/admin/batch/status');
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as {
          message?: string;
          status?: { isRunning?: boolean; activeJobs?: string[]; config?: unknown };
          timestamp?: string;
        };
        expect(body.message).toBe('배치 스케줄러 상태 조회 완료');
        expect(typeof body.timestamp).toBe('string');
        expect(body.status?.isRunning).toBe(true);
        expect(Array.isArray(body.status?.activeJobs)).toBe(true);
        expect(body.status?.config).toBeDefined();
        expect(body).not.toHaveProperty('health');
        expect(body).not.toHaveProperty('queue');
        expect(body).not.toHaveProperty('jobs');
      } finally {
        await new Promise<void>(r => server.close(() => r()));
      }
    } finally {
      await scheduler.stop();
      resetBatchScheduler();
    }
  });

  it('GET /admin/memory/review-candidates/metrics returns live + snapshots (#294)', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/memory/review-candidates/metrics?history_limit=10');
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        live?: { pendingTotal?: number; window1h?: { netFlow?: number } };
        snapshots?: unknown[];
      };
      expect(body.live?.pendingTotal).toBe(1);
      expect(Array.isArray(body.snapshots)).toBe(true);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/memory/review-candidates/stream returns SSE ready (#276)', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const { statusCode, contentType, text } = await readStreamUntil(
        port,
        '/admin/memory/review-candidates/stream',
        'event: ready',
        3000
      );
      expect(statusCode).toBe(200);
      expect(contentType).toContain('text/event-stream');
      expect(text).toContain('retry:');
      expect(text).toContain('event: ready');
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('SSE stream receives changed after POST review (#276)', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          req.destroy();
          reject(new Error('timeout waiting for SSE changed'));
        }, 8000);
        let posted = false;
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: '/admin/memory/review-candidates/stream',
            method: 'GET',
            headers: { Connection: 'close' }
          },
          res => {
            try {
              expect(res.statusCode).toBe(200);
              const rawCt = res.headers['content-type'];
              const ct = Array.isArray(rawCt) ? rawCt[0] : (rawCt ?? '');
              expect(ct).toContain('text/event-stream');
            } catch (e) {
              clearTimeout(timer);
              reject(e);
              return;
            }
            let buf = '';
            res.on('data', (c: Buffer) => {
              buf += c.toString('utf8');
              if (!posted && buf.includes('event: ready')) {
                posted = true;
                void postAdminJson(port, `/admin/memory/review-candidates/${pendingId}/review`, {})
                  .then(r => {
                    expect(r.statusCode).toBe(200);
                  })
                  .catch(err => {
                    clearTimeout(timer);
                    reject(err);
                  });
              }
              if (buf.includes('event: changed')) {
                clearTimeout(timer);
                try {
                  expect(buf).toContain('"reason":"review"');
                  req.destroy();
                  resolve();
                } catch (e) {
                  reject(e);
                }
              }
            });
            res.on('error', err => {
              clearTimeout(timer);
              reject(err);
            });
          }
        );
        req.on('error', err => {
          clearTimeout(timer);
          reject(err);
        });
        req.end();
      });
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // --- Issue #834 Phase 3 ---

  it('GET /admin/batch/runs/:runId/logs returns 404 for unknown runId (#834)', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/batch/runs/jr_missing/logs');
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body)).toMatchObject({ error: 'run not found' });
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/batch/runs/:runId/logs returns empty logs for known run (#834)', async () => {
    const run = new JobRunRepository().append(db, {
      job_name: 'cleanup',
      trigger: 'manual',
      started_at: '2026-09-06T00:00:00.000Z',
      ended_at: '2026-09-06T00:00:01.000Z',
      success: true,
      duration_ms: 1000,
    });
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, `/admin/batch/runs/${run.id}/logs`);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { runId: string; logs: unknown[]; limit: number };
      expect(body.runId).toBe(run.id);
      expect(body.logs).toEqual([]);
      expect(body.limit).toBe(200);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('GET /admin/batch/runs/:runId/logs returns chronological logs (#834)', async () => {
    const run = new JobRunRepository().append(db, {
      job_name: 'cleanup',
      trigger: 'schedule',
      started_at: '2026-09-06T00:00:00.000Z',
      ended_at: '2026-09-06T00:00:01.000Z',
      success: true,
      duration_ms: 1000,
    });
    const logRepo = new JobRunLogRepository();
    logRepo.append(db, {
      run_id: run.id,
      ts: '2026-09-06T00:00:00.200Z',
      level: 'info',
      message: 'second',
    });
    logRepo.append(db, {
      run_id: run.id,
      ts: '2026-09-06T00:00:00.100Z',
      level: 'info',
      message: 'first',
      context_json: JSON.stringify({ phase: 'start' }),
    });

    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, `/admin/batch/runs/${run.id}/logs?limit=10`);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        logs: Array<{ message: string; context: unknown }>;
        limit: number;
      };
      expect(body.limit).toBe(10);
      expect(body.logs).toHaveLength(2);
      expect(body.logs[0]?.message).toBe('first');
      expect(body.logs[0]?.context).toEqual({ phase: 'start' });
      expect(body.logs[1]?.message).toBe('second');
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('POST /admin/batch/pause and resume are idempotent for cleanup (#834)', async () => {
    resetBatchScheduler();
    const scheduler = getBatchScheduler();
    await scheduler.start(db);
    try {
      const { server, port } = await listen(makeApp(db));
      try {
        const pause1 = await postAdminJson(port, '/admin/batch/pause', { jobType: 'cleanup' });
        expect(pause1.statusCode).toBe(200);
        expect(JSON.parse(pause1.body)).toMatchObject({ paused: true, jobType: 'cleanup' });

        const pause2 = await postAdminJson(port, '/admin/batch/pause', { jobType: 'cleanup' });
        expect(pause2.statusCode).toBe(200);

        expect(scheduler.isJobPaused('cleanup')).toBe(true);

        const resume1 = await postAdminJson(port, '/admin/batch/resume', { jobType: 'cleanup' });
        expect(resume1.statusCode).toBe(200);
        expect(JSON.parse(resume1.body)).toMatchObject({ paused: false, jobType: 'cleanup' });
        expect(scheduler.isJobPaused('cleanup')).toBe(false);

        const resume2 = await postAdminJson(port, '/admin/batch/resume', { jobType: 'cleanup' });
        expect(resume2.statusCode).toBe(200);
      } finally {
        await new Promise<void>(r => server.close(() => r()));
      }
    } finally {
      await scheduler.stop();
      resetBatchScheduler();
    }
  });

  it('POST /admin/batch/pause returns 400 for unknown jobType (#834)', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await postAdminJson(port, '/admin/batch/pause', { jobType: 'not_a_real_job' });
      expect(res.statusCode).toBe(400);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('POST /admin/batch/run accepts widened jobType healthcheck (#834)', async () => {
    resetBatchScheduler();
    const scheduler = getBatchScheduler();
    await scheduler.start(db);
    try {
      const { server, port } = await listen(makeApp(db));
      try {
        const res = await postAdminJson(port, '/admin/batch/run', { jobType: 'healthcheck' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { result?: { jobType?: string } };
        expect(body.result?.jobType).toBe('healthcheck');
      } finally {
        await new Promise<void>(r => server.close(() => r()));
      }
    } finally {
      await scheduler.stop();
      resetBatchScheduler();
      resetBatchRunHistoryForTests();
    }
  });

  it('POST /admin/batch/run returns 409 when job already running (#834)', async () => {
    resetBatchScheduler();
    const scheduler = getBatchScheduler();
    await scheduler.start(db);
    const original = scheduler.isJobRunning.bind(scheduler);
    scheduler.isJobRunning = (name: string) => (name === 'cleanup' ? true : original(name));
    try {
      const { server, port } = await listen(makeApp(db));
      try {
        const res = await postAdminJson(port, '/admin/batch/run', { jobType: 'cleanup' });
        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body)).toMatchObject({ error: 'job already running' });
      } finally {
        await new Promise<void>(r => server.close(() => r()));
      }
    } finally {
      await scheduler.stop();
      resetBatchScheduler();
    }
  });

  it('POST /admin/batch/run returns 400 for unknown jobType (#834)', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await postAdminJson(port, '/admin/batch/run', { jobType: 'not_registered' });
      expect(res.statusCode).toBe(400);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('POST pause/resume/run return 403 when ADMIN_JOBS_READ_ONLY (#834)', async () => {
    const prev = mementoConfig.adminJobsReadOnly;
    mementoConfig.adminJobsReadOnly = true;
    try {
      const { server, port } = await listen(makeApp(db));
      try {
        expect((await postAdminJson(port, '/admin/batch/pause', { jobType: 'cleanup' })).statusCode).toBe(403);
        expect((await postAdminJson(port, '/admin/batch/resume', { jobType: 'cleanup' })).statusCode).toBe(403);
        expect((await postAdminJson(port, '/admin/batch/run', { jobType: 'cleanup' })).statusCode).toBe(403);

        const getOk = await getAdmin(port, '/admin/batch/stats');
        expect(getOk.statusCode).toBe(200);
      } finally {
        await new Promise<void>(r => server.close(() => r()));
      }
    } finally {
      mementoConfig.adminJobsReadOnly = prev;
    }
  });
});

describe('GET /admin/status', () => {
  let db: Database.Database;

  function createBaseSchema(database: Database.Database): void {
    database.exec(`
      CREATE TABLE IF NOT EXISTS memory_item (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        importance REAL DEFAULT 0.5,
        privacy_scope TEXT DEFAULT 'private',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_accessed TIMESTAMP,
        last_accessed_at TEXT,
        pinned BOOLEAN DEFAULT FALSE,
        tags TEXT,
        source TEXT,
        project_id TEXT,
        owner_id TEXT,
        is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
        deleted_at TEXT
      );
    `);
    database.exec(`
      CREATE TABLE IF NOT EXISTS memento_schema_version (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        migration_name TEXT NOT NULL,
        checksum TEXT,
        applied_by TEXT DEFAULT 'system',
        description TEXT
      );
    `);
    database.exec(`
      CREATE TABLE IF NOT EXISTS memory_embedding (
        memory_id TEXT NOT NULL,
        embedding_provider TEXT NOT NULL,
        projection_type TEXT NOT NULL,
        embedding TEXT NOT NULL,
        dim INTEGER NOT NULL,
        dimensions INTEGER,
        model TEXT,
        created_by TEXT,
        created_at TEXT,
        UNIQUE(memory_id, embedding_provider, projection_type)
      );
    `);
  }

  function makeApp(database: Database.Database | null) {
    const app = express();
    app.use(express.json());
    app.use('/admin', createAdminRouter(database, null));
    return app;
  }

  beforeEach(async () => {
    resetBatchScheduler();
    db = new Database(':memory:');
    createBaseSchema(db);
    await new MetaMemoryStatsSchemaMigration().up(db);
    await new MemoryReviewCandidateSchemaMigration().up(db);
    await new ReviewQueueHealthSnapshotMigration().up(db);
    await new JobRunMigration().up(db);
    db.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
    resetBatchScheduler();
  });

  it('returns 200 with the frozen AdminStatusResponse shape', async () => {
    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/status');
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as Record<string, unknown>;
      expect(body).toMatchObject({
        windowDays: 30,
        process: {
          status: 'ok',
          database: 'connected',
        },
        scheduler: {
          status: 'ok',
          running: false,
        },
        batchImpact: {
          status: 'ok',
        },
        review: {
          status: 'ok',
        },
        embedding: {
          status: 'ok',
          provider: 'minilm',
        },
      });
      expect(body.timestamp).toBeTruthy();
      expect(body.since).toBeTruthy();
      expect(body.dataSince).toBeNull();
      expect(body.process).toMatchObject({
        uptimeMs: expect.any(Number),
        uptimeHuman: expect.any(String),
        version: expect.any(String),
      });
      expect(body.scheduler).toMatchObject({
        uptimeMs: expect.any(Number),
        uptimeHuman: expect.any(String),
        runningJobs: expect.any(Number),
        queueSize: expect.any(Number),
      });
      expect(body.batchImpact).toMatchObject({
        since: expect.any(String),
        failedRunCount: expect.any(Number),
        durationMsSum: expect.any(Number),
        durationHuman: expect.any(String),
        successRunCount: expect.any(Number),
        lastFailedAt: null,
      });
      expect(body.review).toMatchObject({
        pendingTotal: expect.any(Number),
        netFlow1h: expect.any(Number),
      });
      expect(body.embedding).toMatchObject({
        problemCount: expect.any(Number),
      });
      expect(body).not.toHaveProperty('errorRate');
      expect(body).not.toHaveProperty('memoryUsage');
      expect(body).not.toHaveProperty('coverage');
      expect(body.process).not.toHaveProperty('errorRate');
      expect(body.process).not.toHaveProperty('memoryUsage');
      expect(body.process).not.toHaveProperty('coverage');
      expect(body.scheduler).not.toHaveProperty('errorRate');
      expect(body.embedding).not.toHaveProperty('coverage');
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('keeps process.uptimeMs and scheduler.uptimeMs as separate fields', async () => {
    const scheduler = getBatchScheduler();
    await scheduler.start(db);
    try {
      const { server, port } = await listen(makeApp(db));
      try {
        const res = await getAdmin(port, '/admin/status');
        const body = JSON.parse(res.body) as {
          process: { uptimeMs: number };
          scheduler: { uptimeMs: number };
        };
        expect(res.statusCode).toBe(200);
        expect(typeof body.process.uptimeMs).toBe('number');
        expect(typeof body.scheduler.uptimeMs).toBe('number');
        expect(body.process.uptimeMs).toBeGreaterThanOrEqual(0);
        expect(body.scheduler.uptimeMs).toBeGreaterThanOrEqual(0);
      } finally {
        await new Promise<void>(r => server.close(() => r()));
      }
    } finally {
      await scheduler.stop();
    }
  });

  it('matches failed batch duration sum from job_run seed data', async () => {
    const since = new Date(Date.now() - 30 * DAY_MS).toISOString();
    const repo = new JobRunRepository();
    repo.append(db, {
      job_name: 'cleanup',
      trigger: 'schedule',
      started_at: new Date(Date.now() - 2 * DAY_MS).toISOString(),
      ended_at: new Date(Date.now() - 2 * DAY_MS + 60_000).toISOString(),
      success: false,
      duration_ms: 300_000,
    });
    repo.append(db, {
      job_name: 'cleanup',
      trigger: 'schedule',
      started_at: new Date(Date.now() - DAY_MS).toISOString(),
      ended_at: new Date(Date.now() - DAY_MS + 120_000).toISOString(),
      success: false,
      duration_ms: 420_000,
    });

    const expected = db
      .prepare(
        `SELECT COALESCE(SUM(duration_ms), 0) AS ms
         FROM job_run WHERE success = 0 AND started_at >= ?`,
      )
      .get(since) as { ms: number };

    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/status');
      const body = JSON.parse(res.body) as {
        windowDays: number;
        dataSince: string | null;
        since: string;
        batchImpact: { since: string; durationMsSum: number };
      };
      expect(res.statusCode).toBe(200);
      expect(body.windowDays).toBe(30);
      expect(body.dataSince).toBeTruthy();
      expect(body.batchImpact.since).toBe(body.since);
      expect(body.batchImpact.durationMsSum).toBe(Number(expected.ms));
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('degrades embedding while still returning HTTP 200 when diagnose throws', async () => {
    const { EmbeddingReindexService } = await import('@memento/core');
    const spy = vi.spyOn(EmbeddingReindexService.prototype, 'diagnose').mockImplementation(() => {
      throw new Error('diagnose failed');
    });

    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/status');
      const body = JSON.parse(res.body) as {
        embedding: { status: string };
        process: { status: string };
        batchImpact: { status: string };
        review: { status: string };
      };
      expect(res.statusCode).toBe(200);
      expect(body.embedding.status).toBe('degraded');
      expect(body.process.status).toBe('ok');
      expect(body.batchImpact.status).toBe('ok');
      expect(body.review.status).toBe('ok');
    } finally {
      spy.mockRestore();
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('review.netFlow1h counts the 1h window, not the 24h window', async () => {
    const now = Date.now();
    const tenMinAgo = new Date(now - 10 * 60_000).toISOString();
    const fiveHoursAgo = new Date(now - 5 * 3_600_000).toISOString();

    const insertMemory = db.prepare(
      `INSERT INTO memory_item (id, type, content) VALUES (?, ?, ?)`,
    );
    const insertCandidate = db.prepare(`
      INSERT INTO memory_review_candidate (
        id, memory_id, status, priority, reason, due_at, created_at, updated_at,
        reviewed_at, dismissed_at
      ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, NULL, NULL)
    `);

    insertMemory.run('mem-c1', 'semantic', 'content c1');
    insertMemory.run('mem-c2', 'semantic', 'content c2');
    insertMemory.run('mem-c3', 'semantic', 'content c3');
    insertMemory.run('mem-c4', 'semantic', 'content c4');

    insertCandidate.run('c1', 'mem-c1', 0.5, 'reason', '2026-09-19T00:00:00.000Z', tenMinAgo, tenMinAgo);
    insertCandidate.run('c2', 'mem-c2', 0.5, 'reason', '2026-09-19T00:00:00.000Z', fiveHoursAgo, fiveHoursAgo);
    insertCandidate.run('c3', 'mem-c3', 0.5, 'reason', '2026-09-19T00:00:00.000Z', fiveHoursAgo, fiveHoursAgo);
    insertCandidate.run('c4', 'mem-c4', 0.5, 'reason', '2026-09-19T00:00:00.000Z', fiveHoursAgo, fiveHoursAgo);

    const { server, port } = await listen(makeApp(db));
    try {
      const res = await getAdmin(port, '/admin/status');
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        review: { pendingTotal: number; netFlow1h: number };
      };
      expect(body.review.pendingTotal).toBe(4);
      expect(body.review.netFlow1h).toBe(1);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });
});
