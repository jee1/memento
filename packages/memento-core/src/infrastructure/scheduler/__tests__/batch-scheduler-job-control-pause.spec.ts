import { describe, it, expect, vi } from 'vitest';
import {
  pauseBatchSchedulerJob,
  stopBatchSchedulerJob,
  buildRestartHandlerNamesForTest,
} from '../batch-scheduler/batch-scheduler-job-control.js';

describe('pauseBatchSchedulerJob (#834)', () => {
  it('stops interval and records paused set; idempotent', () => {
    const intervals = new Map<string, ReturnType<typeof setInterval>>();
    const id = setInterval(() => {}, 60_000);
    intervals.set('cleanup', id);
    const paused = new Set<string>();
    const log = vi.fn();

    const first = pauseBatchSchedulerJob(intervals, paused, log, 'cleanup');
    expect(first.ok).toBe(true);
    expect(intervals.has('cleanup')).toBe(false);
    expect(paused.has('cleanup')).toBe(true);

    const second = pauseBatchSchedulerJob(intervals, paused, log, 'cleanup');
    expect(second.ok).toBe(true);
    expect(paused.has('cleanup')).toBe(true);
  });

  it('rejects unknown jobType', () => {
    const result = pauseBatchSchedulerJob(new Map(), new Set(), vi.fn(), 'nope');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unknown_job');
  });

  it('stopJob does not force-kill — pause only clears interval', () => {
    const intervals = new Map<string, ReturnType<typeof setInterval>>();
    const id = setInterval(() => {}, 60_000);
    intervals.set('monitoring', id);
    const stopped = stopBatchSchedulerJob(intervals, vi.fn(), 'monitoring');
    expect(stopped).toBe(true);
    expect(intervals.has('monitoring')).toBe(false);
  });
});

describe('restart registry coverage (#834)', () => {
  it('exposes schedule-name handlers beyond the Phase-2 four', () => {
    const names = buildRestartHandlerNamesForTest();
    expect(names).toContain('cleanup');
    expect(names).toContain('monitoring');
    expect(names).toContain('healthcheck');
    expect(names).toContain('memory_review_candidates');
    expect(names).toContain('triple_extraction_batch');
    expect(names).toContain('log_rotation');
    expect(names).toContain('anchor_auto_refresh');
    expect(names).toContain('job_run_cleanup_batch');
  });
});
