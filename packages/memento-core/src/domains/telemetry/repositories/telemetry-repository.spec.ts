import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { TelemetryEventsMigration } from '../../../infrastructure/database/database/migration/migrations/027-telemetry-events.js';
import { TelemetryDailyMetricsMigration } from '../../../infrastructure/database/database/migration/migrations/028-telemetry-daily-metrics.js';
import { TelemetryRepository, percentile95Sorted } from './telemetry-repository.js';

async function openTelemetryDb(): Promise<Database.Database> {
  const db = new Database(':memory:');
  await new TelemetryEventsMigration().up(db);
  await new TelemetryDailyMetricsMigration().up(db);
  return db;
}

describe('percentile95Sorted', () => {
  it('빈 배열은 null', () => {
    expect(percentile95Sorted([])).toBeNull();
  });

  it('20개 1..20에서 p95는 19', () => {
    const sorted = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile95Sorted(sorted)).toBe(19);
  });
});

describe('TelemetryRepository', () => {
  let db: Database.Database;
  let repo: TelemetryRepository;

  beforeEach(async () => {
    db = await openTelemetryDb();
    repo = new TelemetryRepository(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  });

  it('insertEventSync는 이벤트와 일별 메트릭을 기록한다', () => {
    repo.insertEventSync({
      eventType: 'memory.search.requested',
      requestId: 'req-1',
      ownerId: 'agent-a',
      latencyMs: 100,
      outcome: 'success'
    });
    const n = db.prepare('SELECT COUNT(*) AS c FROM telemetry_events').get() as { c: number };
    expect(n.c).toBe(1);
    const m = db
      .prepare(
        `SELECT event_count, avg_latency_ms, error_count FROM telemetry_daily_metrics
         WHERE event_type = 'memory.search.requested' AND owner_id = 'agent-a'`
      )
      .get() as { event_count: number; avg_latency_ms: number; error_count: number };
    expect(m.event_count).toBe(1);
    expect(m.avg_latency_ms).toBe(100);
    expect(m.error_count).toBe(0);
  });

  it('동일 일·타입·owner에 대해 avg_latency_ms가 롤링 평균으로 갱신된다', () => {
    const day = new Date().toISOString().slice(0, 10);
    repo.insertEventSync({
      eventType: 'memory.write.completed',
      requestId: 'r1',
      ownerId: '',
      latencyMs: 10,
      outcome: 'success'
    });
    repo.insertEventSync({
      eventType: 'memory.write.completed',
      requestId: 'r2',
      ownerId: '',
      latencyMs: 30,
      outcome: 'success'
    });
    const m = db
      .prepare(
        `SELECT event_count, avg_latency_ms FROM telemetry_daily_metrics
         WHERE date = ? AND event_type = 'memory.write.completed' AND owner_id = ''`
      )
      .get(day) as { event_count: number; avg_latency_ms: number };
    expect(m.event_count).toBe(2);
    expect(m.avg_latency_ms).toBe(20);
  });

  it('deleteExpiredEvents는 retention 일보다 오래된 행만 삭제한다', () => {
    const oldIso = new Date(Date.now() - 100 * 86_400_000).toISOString();
    db.prepare(
      `INSERT INTO telemetry_events (id, event_type, request_id, owner_id, latency_ms, outcome, created_at)
       VALUES ('old1', 'memory.search.requested', 'q', NULL, NULL, 'success', ?)`
    ).run(oldIso);
    repo.insertEventSync({
      eventType: 'memory.search.requested',
      requestId: 'new',
      ownerId: null,
      outcome: 'success'
    });
    const deleted = repo.deleteExpiredEvents(90);
    expect(deleted).toBeGreaterThanOrEqual(1);
    const rest = db.prepare(`SELECT COUNT(*) AS c FROM telemetry_events`).get() as { c: number };
    expect(rest.c).toBe(1);
  });

  it('hasPriorWriteCompletedWithContentHash는 동일 owner·해시·기간 내 완료 이벤트를 본다', () => {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const hash = 'abcd1234ef567890';
    repo.insertEventSync({
      eventType: 'memory.write.completed',
      requestId: 'w1',
      ownerId: 'u1',
      outcome: 'success',
      extraData: { content_hash: hash, memory_type: 'semantic', is_duplicate: false }
    });
    expect(repo.hasPriorWriteCompletedWithContentHash('u1', hash, since)).toBe(true);
    expect(repo.hasPriorWriteCompletedWithContentHash('u2', hash, since)).toBe(false);
  });
});
