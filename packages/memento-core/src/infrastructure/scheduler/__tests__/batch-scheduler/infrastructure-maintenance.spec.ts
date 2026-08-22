import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BatchScheduler } from '../../batch-scheduler/batch-scheduler.js';
import * as batchSchedulerFacade from '../../batch-scheduler.js';

describe('BatchScheduler infrastructure maintenance', () => {
  const schedulers: BatchScheduler[] = [];

  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(schedulers.map(scheduler => scheduler.stop()));
  });

  it('keeps the public facade limited to singleton access', () => {
    expect(Object.keys(batchSchedulerFacade).sort()).toEqual([
      'getBatchScheduler',
      'resetBatchScheduler'
    ]);
  });

  it('owns WAL, lock, and reflexion recurring jobs', async () => {
    vi.useFakeTimers();
    const db = new Database(':memory:');
    const walCheckpoint = vi.fn().mockResolvedValue({ success: true });
    const lockProbe = vi.fn().mockResolvedValue(undefined);
    const reflexionCleanup = vi.fn();
    const reflexionHealthProbe = vi.fn();
    const scheduler = new BatchScheduler({
      walCheckpointInterval: 60_000,
      lockMonitorInterval: 60_000,
      reflexionCleanupInterval: 60_000,
      reflexionHealthCheckInterval: 60_000,
      enableLogging: false
    });
    schedulers.push(scheduler);
    scheduler.setDatabaseMaintenance({ checkpointNow: walCheckpoint }, { probe: lockProbe });

    await scheduler.start(db, {
      getStatus: () => ({
        isRunning: true,
        activeWorkers: 0,
        queueSize: 0,
        processedCount: 0,
        failedCount: 0,
        restartCount: 0
      }),
      queueFailureEvent: vi.fn().mockResolvedValue(true),
      cleanupDuplicateWindow: reflexionCleanup,
      performHealthCheck: reflexionHealthProbe
    }, false);

    expect(scheduler.getStatus().activeJobs).toEqual(expect.arrayContaining([
      'wal_checkpoint',
      'lock_monitor',
      'reflexion_cleanup',
      'reflexion_healthcheck'
    ]));

    await vi.advanceTimersByTimeAsync(4_100);

    expect(walCheckpoint).toHaveBeenCalled();
    expect(lockProbe).toHaveBeenCalled();
    expect(reflexionCleanup).toHaveBeenCalled();
    expect(reflexionHealthProbe).toHaveBeenCalled();
    await scheduler.stop();
    db.close();
  });
});
