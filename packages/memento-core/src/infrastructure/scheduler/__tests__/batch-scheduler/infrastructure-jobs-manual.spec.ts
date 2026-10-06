import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BatchScheduler } from '../../batch-scheduler/batch-scheduler.js';

describe('BatchScheduler infrastructure jobs manual control', () => {
  const schedulers: BatchScheduler[] = [];

  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(schedulers.map(scheduler => scheduler.stop()));
  });

  async function startSchedulerWithWal(
    walCheckpoint = vi.fn().mockResolvedValue({ success: true })
  ): Promise<{ scheduler: BatchScheduler; walCheckpoint: ReturnType<typeof vi.fn> }> {
    const db = new Database(':memory:');
    const scheduler = new BatchScheduler({
      walCheckpointInterval: 60_000,
      enableLogging: false,
    });
    schedulers.push(scheduler);
    scheduler.setDatabaseMaintenance({ checkpointNow: walCheckpoint }, null);
    await scheduler.start(db, undefined, false);
    return { scheduler, walCheckpoint };
  }

  async function startSchedulerWithLockMonitor(
    lockProbe = vi.fn().mockResolvedValue(undefined)
  ): Promise<{ scheduler: BatchScheduler; lockProbe: ReturnType<typeof vi.fn> }> {
    const db = new Database(':memory:');
    const scheduler = new BatchScheduler({
      lockMonitorInterval: 60_000,
      enableLogging: false,
    });
    schedulers.push(scheduler);
    scheduler.setDatabaseMaintenance(null, { probe: lockProbe });
    await scheduler.start(db, undefined, false);
    return { scheduler, lockProbe };
  }

  it('isManualRunnable returns true for wal_checkpoint and cleanup after start', async () => {
    const { scheduler } = await startSchedulerWithWal();
    expect(scheduler.isManualRunnable('wal_checkpoint')).toBe(true);
    expect(scheduler.isManualRunnable('cleanup')).toBe(true);
    expect(scheduler.isManualRunnable('nope')).toBe(false);
  });

  it('runJob(wal_checkpoint) invokes checkpointNow and returns success', async () => {
    const walCheckpoint = vi.fn().mockResolvedValue({ success: true });
    const { scheduler } = await startSchedulerWithWal(walCheckpoint);

    const result = await scheduler.runJob('wal_checkpoint');

    expect(walCheckpoint).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      jobType: 'wal_checkpoint',
      success: true,
      processed: 1,
      errors: [],
      warnings: [],
    });
  });

  it('runJob(wal_checkpoint) returns failure when checkpointNow reports busy', async () => {
    const walCheckpoint = vi.fn().mockResolvedValue({
      success: false,
      error: new Error('busy'),
    });
    const { scheduler } = await startSchedulerWithWal(walCheckpoint);

    const result = await scheduler.runJob('wal_checkpoint');

    expect(result.success).toBe(false);
    expect(result.errors).toContain('busy');
  });

  it('pauseJob and resumeJob manage lock_monitor interval and paused state', async () => {
    const { scheduler } = await startSchedulerWithLockMonitor();

    expect(scheduler.getStatus().activeJobs).toContain('lock_monitor');

    const pauseResult = scheduler.pauseJob('lock_monitor');
    expect(pauseResult).toEqual({ ok: true });
    expect(scheduler.isJobPaused('lock_monitor')).toBe(true);
    expect(scheduler.getPausedJobNames()).toContain('lock_monitor');
    expect(scheduler.getStatus().activeJobs).not.toContain('lock_monitor');

    const resumeResult = scheduler.resumeJob('lock_monitor');
    expect(resumeResult).toEqual({ ok: true });
    expect(scheduler.isJobPaused('lock_monitor')).toBe(false);
    expect(scheduler.getStatus().activeJobs).toContain('lock_monitor');
  });

  it('runJob rejects unknown job names', async () => {
    const { scheduler } = await startSchedulerWithWal();
    await expect(scheduler.runJob('nope')).rejects.toThrow('unknown_job');
  });
});
