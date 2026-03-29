import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelemetryCleanupBatchJob } from './telemetry-cleanup-batch-job.js';
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
});
