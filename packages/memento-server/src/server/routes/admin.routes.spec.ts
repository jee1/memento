/**
 * Admin 라우터 — sleep consolidation 계약 (contracts/admin-api.md)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import express from 'express';
import http from 'http';
import Database from 'better-sqlite3';
import { createAdminRouter } from './admin.routes.js';
import type { ServerServices } from '../bootstrap.js';
import {
  type SleepConsolidationRunResult,
  TelemetryService,
  TelemetryRepository,
  TelemetryEventsMigration,
  TelemetryDailyMetricsMigration,
  MetaMemoryStatsSchemaMigration,
  MemoryReviewCandidateSchemaMigration,
  upsertPendingMemoryReviewCandidates,
  getBatchScheduler,
  resetBatchScheduler
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
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
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
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
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
    db = new Database(':memory:');
    createBaseSchema(db);
    await new MetaMemoryStatsSchemaMigration().up(db);
    await new MemoryReviewCandidateSchemaMigration().up(db);
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
    try {
      db.close();
    } catch {
      /* ignore */
    }
  });

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
    }
  });
});

