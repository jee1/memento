import Database from 'better-sqlite3';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelemetryCleanupBatchJob, USAGE_COUNT_RETENTION_DAYS } from './telemetry-cleanup-batch-job.js';
import { TelemetryRepository as RealTelemetryRepository } from '../../../domains/telemetry/repositories/telemetry-repository.js';
import { usageDailyCountDdl } from '../../database/sqlite/migration/migrations/069-usage-daily-count.js';
import type { TelemetryRepository } from '../../../domains/telemetry/repositories/telemetry-repository.js';

describe('TelemetryCleanupBatchJob', () => {
  const prev = process.env.TELEMETRY_RETENTION_DAYS;

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.TELEMETRY_RETENTION_DAYS;
    } else {
      process.env.TELEMETRY_RETENTION_DAYS = prev;
    }
    vi.restoreAllMocks();
  });

  it('deleteExpiredEvents를 retention 일로 호출하고 삭제 건수를 반영한다', async () => {
    process.env.TELEMETRY_RETENTION_DAYS = '30';
    const deleteExpiredEvents = vi.fn().mockReturnValue(42);
    const insertEventSync = vi.fn();
    const repo = { deleteExpiredEvents, insertEventSync } as unknown as TelemetryRepository;
    const job = new TelemetryCleanupBatchJob({ repository: repo });
    const r = await job.execute();
    expect(r.success).toBe(true);
    expect(r.processed).toBe(42);
    expect(deleteExpiredEvents).toHaveBeenCalledWith(30);
    expect(r.details).toMatchObject({ retentionDays: 30, deleted: 42 });
    expect(insertEventSync).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'telemetry.cleanup.performed',
        outcome: 'success',
        latencyMs: expect.any(Number) as number
      })
    );
  });

  it('예외 시 success false 및 errors에 메시지', async () => {
    const insertEventSync = vi.fn();
    const repo = {
      deleteExpiredEvents: vi.fn(() => {
        throw new Error('boom');
      }),
      insertEventSync
    } as unknown as TelemetryRepository;
    const job = new TelemetryCleanupBatchJob({ repository: repo });
    const r = await job.execute();
    expect(r.success).toBe(false);
    expect(r.errors).toContain('boom');
    expect(insertEventSync).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'telemetry.cleanup.performed',
        outcome: 'failure'
      })
    );
  });

  describe('사용 집계 보관 정리 (#1768)', () => {
    const base = {
      client_name: 'claude-code',
      client_version: '2.1.327',
      connection_method: 'stdio',
      era: 'modern',
      request_kind: 'tools/call',
      tool: 'recall',
      outcome: 'success',
      error_code: 0,
      count: 1,
    };
    const insertUsage = (db: Database.Database, day: string) =>
      db
        .prepare(
          `INSERT INTO usage_daily_count (day, client_name, client_version, connection_method, era, request_kind, tool, outcome, error_code, count)
           VALUES (@day, @client_name, @client_version, @connection_method, @era, @request_kind, @tool, @outcome, @error_code, @count)`,
        )
        .run({ ...base, day });
    const dayOffset = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

    it('보관 기간(365일)이 지난 행만 지운다', async () => {
      const db = new Database(':memory:');
      db.exec(usageDailyCountDdl());
      db.exec(`CREATE TABLE telemetry_events (id TEXT, event_type TEXT, request_id TEXT, owner_id TEXT, latency_ms INTEGER, outcome TEXT, error_code TEXT, extra_data TEXT, created_at TEXT)`);
      insertUsage(db, dayOffset(USAGE_COUNT_RETENTION_DAYS + 1));
      insertUsage(db, dayOffset(USAGE_COUNT_RETENTION_DAYS - 1));
      insertUsage(db, dayOffset(0));

      const repo = new RealTelemetryRepository(db);
      const r = await new TelemetryCleanupBatchJob({ repository: repo }).execute();

      expect(r.success).toBe(true);
      expect((r.details as { usageCountsDeleted: number }).usageCountsDeleted).toBe(1);
      expect(db.prepare('SELECT COUNT(*) AS n FROM usage_daily_count').get()).toEqual({ n: 2 });
      db.close();
    });

    it('집계 표가 없어도 기존 텔레메트리 정리는 성공으로 기록된다', async () => {
      const deleteExpiredEvents = vi.fn().mockReturnValue(7);
      const insertEventSync = vi.fn();
      const deleteExpiredUsageCounts = vi.fn(() => {
        throw new Error('no such table: usage_daily_count');
      });
      const repo = { deleteExpiredEvents, deleteExpiredUsageCounts, insertEventSync } as unknown as TelemetryRepository;

      const r = await new TelemetryCleanupBatchJob({ repository: repo }).execute();

      expect(r.success).toBe(true);
      expect(r.processed).toBe(7);
      expect(r.errors).toEqual([]);
      expect(r.warnings.join(' ')).toContain('usage_daily_count cleanup failed');
      expect(deleteExpiredUsageCounts).toHaveBeenCalledWith(USAGE_COUNT_RETENTION_DAYS);
      expect(insertEventSync).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success' }));
    });

    it('이벤트 정리가 실패해도 사용 집계 보관 정리는 건너뛰지 않는다', async () => {
      const deleteExpiredUsageCounts = vi.fn().mockReturnValue(3);
      const repo = {
        deleteExpiredEvents: vi.fn(() => {
          throw new Error('locked');
        }),
        deleteExpiredUsageCounts,
        insertEventSync: vi.fn(),
      } as unknown as TelemetryRepository;

      const r = await new TelemetryCleanupBatchJob({ repository: repo }).execute();

      expect(r.success).toBe(false);
      expect(r.errors).toContain('locked');
      expect(deleteExpiredUsageCounts).toHaveBeenCalledTimes(1);
    });
  });
});
