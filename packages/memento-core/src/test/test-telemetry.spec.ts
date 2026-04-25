/**
 * SC-002~SC-005 요약 시나리오 — 계측 오버헤드·search-quality·집계 일관성·보존 삭제
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { TelemetryEventsMigration } from '@memento/core/infrastructure/database/database/migration/migrations/027-telemetry-events.js';
import { TelemetryDailyMetricsMigration } from '@memento/core/infrastructure/database/database/migration/migrations/028-telemetry-daily-metrics.js';
import { TelemetryRepository } from '@memento/core/domains/telemetry/repositories/telemetry-repository.js';
import { TelemetryService } from '@memento/core/domains/telemetry/services/telemetry-service.js';
import { DatabaseUtils } from '@memento/core/shared/utils/database.js';
import { RecallTool } from '@memento/core/domains/memory/tools/recall-tool.js';
import type { ToolContext } from '@memento/core/types.js';

async function telemetryDb(): Promise<Database.Database> {
  const db = new Database(':memory:');
  await new TelemetryEventsMigration().up(db);
  await new TelemetryDailyMetricsMigration().up(db);
  return db;
}

function percentile95(samples: number[]): number {
  if (samples.length === 0) return 0;
  const s = [...samples].sort((a, b) => a - b);
  const idx = Math.ceil(0.95 * s.length) - 1;
  return s[Math.max(0, idx)]!;
}

describe('test-telemetry (SC-002 recall overhead)', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    await DatabaseUtils.initializeDatabase(db);
    await new TelemetryEventsMigration().up(db);
    await new TelemetryDailyMetricsMigration().up(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  });

  it.skipIf(Boolean(process.env.CI))(
    'SC-002: recall 처리 시간 p95 — 텔레메트리 활성 시 비활성 대비 증가분 5ms 이하',
    async () => {
      const recall = new RecallTool();
      const mockItem = {
        memory_id: 'mem_sc2',
        content: 'sc2 fixture',
        type: 'semantic',
        importance: 0.5,
        created_at: '2026-03-29T00:00:00.000Z',
        final_score: 0.9
      };
      const hybrid = {
        isEmbeddingAvailable: () => true,
        search: async () => ({
          items: [mockItem],
          total_count: 1,
          text_count: 1,
          vector_count: 0,
          query_embedding_providers: ['tfidf'] as const
        })
      };
      const run = async (withTelemetry: boolean, count: number): Promise<number[]> => {
        const repo = new TelemetryRepository(db);
        const telemetryService = new TelemetryService(repo);
        const timings: number[] = [];
        for (let i = 0; i < count; i++) {
          const context: ToolContext = {
            db,
            agentId: 'sc2-agent',
            services: withTelemetry
              ? { telemetryService, hybridSearchEngine: hybrid }
              : { hybridSearchEngine: hybrid }
          };
          const t0 = performance.now();
          if (withTelemetry) {
            await telemetryService.runWithContext('sc2-agent', () =>
              recall.handle(
                {
                  query: `sc2-q-${i}`,
                  type: 'semantic',
                  limit: 5,
                  enable_hybrid: true,
                  include_metadata: false
                },
                context
              )
            );
          } else {
            await recall.handle(
              {
                query: `sc2-q-${i}`,
                type: 'semantic',
                limit: 5,
                enable_hybrid: true,
                include_metadata: false
              },
              context
            );
          }
          timings.push(performance.now() - t0);
        }
        return timings;
      };
      await run(false, 40);
      await run(true, 40);
      const off = await run(false, 120);
      const on = await run(true, 120);
      const delta = percentile95(on) - percentile95(off);
      expect(delta).toBeLessThanOrEqual(5);
    },
    30_000
  );
});

describe('test-telemetry (SC-004/SC-005)', () => {
  let db: Database.Database;
  let repo: TelemetryRepository;

  beforeEach(async () => {
    db = await telemetryDb();
    repo = new TelemetryRepository(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  });

  it(
    'SC-003: 24h search-quality 집계가 대량 이벤트에서도 2000ms 미만',
    () => {
      db.transaction(() => {
        for (let i = 0; i < 1000; i++) {
          const rid = `sc3-${i}`;
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
      const svc = new TelemetryService(repo);
      const t0 = Date.now();
      const q = svc.getSearchQuality('24h', null);
      expect(Date.now() - t0).toBeLessThan(2000);
      expect(q.search_count).toBe(1000);
      expect(q.p95_latency_ms).not.toBeNull();
    },
    10_000
  );

  it('background_jobs 24h 필드가 consolidation·cleanup 텔레메트리 이벤트로 집계된다', () => {
    repo.insertEventSync({
      eventType: 'consolidation.performed',
      requestId: 'c1',
      ownerId: null,
      outcome: 'success',
      latencyMs: 100
    });
    repo.insertEventSync({
      eventType: 'consolidation.performed',
      requestId: 'c2',
      ownerId: null,
      outcome: 'failure',
      latencyMs: 200
    });
    repo.insertEventSync({
      eventType: 'telemetry.cleanup.performed',
      requestId: 't1',
      ownerId: null,
      outcome: 'success',
      latencyMs: 50
    });
    const svc = new TelemetryService(repo);
    const m = svc.getSystemMetrics('24h', null);
    expect(m.background_jobs.sleep_consolidation.success_runs_24h).toBe(1);
    expect(m.background_jobs.sleep_consolidation.failure_runs_24h).toBe(1);
    expect(m.background_jobs.sleep_consolidation.total_runs_24h).toBe(2);
    expect(m.background_jobs.sleep_consolidation.avg_duration_ms).toBeCloseTo(150, 5);
    expect(m.background_jobs.telemetry_cleanup.success_runs_24h).toBe(1);
    expect(m.background_jobs.telemetry_cleanup.failure_runs_24h).toBe(0);
    expect(m.background_jobs.telemetry_cleanup.total_runs_24h).toBe(1);
  });

  it('SC-004: 동일 DB에 대해 연속 search-quality 조회가 동일한 집계를 반환한다', () => {
    repo.insertEventSync({
      eventType: 'memory.search.requested',
      requestId: 'a',
      ownerId: null,
      outcome: 'success'
    });
    repo.insertEventSync({
      eventType: 'memory.search.empty',
      requestId: 'b',
      ownerId: null,
      outcome: 'empty',
      latencyMs: 5
    });
    const q1 = repo.querySearchQuality('24h', null);
    const q2 = repo.querySearchQuality('24h', null);
    expect(q1.search_count).toBe(q2.search_count);
    expect(q1.empty_retrieval_rate).toBe(q2.empty_retrieval_rate);
  });

  it('SC-005: 91일 이전 raw 이벤트는 90일 retention 삭제 대상이다', () => {
    const ancient = new Date(Date.now() - 91 * 86_400_000).toISOString();
    db.prepare(
      `INSERT INTO telemetry_events (id, event_type, request_id, owner_id, latency_ms, outcome, created_at)
       VALUES ('stale', 'memory.search.requested', 'r', NULL, NULL, 'success', ?)`
    ).run(ancient);
    repo.insertEventSync({
      eventType: 'memory.search.requested',
      requestId: 'fresh',
      ownerId: null,
      outcome: 'success'
    });
    const deleted = repo.deleteExpiredEvents(90);
    expect(deleted).toBeGreaterThanOrEqual(1);
    const left = db
      .prepare(`SELECT id FROM telemetry_events WHERE id = 'stale'`)
      .get() as { id: string } | undefined;
    expect(left).toBeUndefined();
  });
});
