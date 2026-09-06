import { describe, it, expect } from 'vitest';
import {
  REGISTERED_MANUAL_BATCH_JOB_TYPES,
  isRegisteredManualBatchJobType,
  createBatchSchedulerJobRunners,
  runManualBatchSchedulerJob,
} from '../batch-scheduler/batch-scheduler-job-runners.js';

describe('ManualBatchSchedulerJobType registry (#834)', () => {
  it('includes prior whitelist and newly widened schedule names', () => {
    expect(REGISTERED_MANUAL_BATCH_JOB_TYPES).toContain('cleanup');
    expect(REGISTERED_MANUAL_BATCH_JOB_TYPES).toContain('monitoring');
    expect(REGISTERED_MANUAL_BATCH_JOB_TYPES).toContain('memory_review_candidates');
    expect(REGISTERED_MANUAL_BATCH_JOB_TYPES).toContain('healthcheck');
    expect(REGISTERED_MANUAL_BATCH_JOB_TYPES).toContain('triple_extraction_batch');
    expect(REGISTERED_MANUAL_BATCH_JOB_TYPES).toContain('log_rotation');
    expect(REGISTERED_MANUAL_BATCH_JOB_TYPES).toContain('telemetry_cleanup_batch');
    expect(REGISTERED_MANUAL_BATCH_JOB_TYPES).toContain('anchor_auto_refresh');
    expect(REGISTERED_MANUAL_BATCH_JOB_TYPES).toContain('job_run_cleanup_batch');
  });

  it('isRegisteredManualBatchJobType rejects unknown names', () => {
    expect(isRegisteredManualBatchJobType('cleanup')).toBe(true);
    expect(isRegisteredManualBatchJobType('not_a_job')).toBe(false);
    expect(isRegisteredManualBatchJobType(null)).toBe(false);
  });

  it('runManualBatchSchedulerJob dispatches every registered type without orphan', async () => {
    const calls: string[] = [];
    const fakeResult = {
      jobType: 'x',
      startTime: new Date(),
      endTime: new Date(),
      duration: 1,
      success: true,
      processed: 0,
      errors: [] as string[],
      warnings: [] as string[],
    };

    const runners = createBatchSchedulerJobRunners({} as never);
    const patched = Object.fromEntries(
      Object.keys(runners).map(key => [
        key,
        async () => {
          calls.push(key);
          return { ...fakeResult, jobType: key };
        },
      ]),
    ) as typeof runners;

    for (const jobType of REGISTERED_MANUAL_BATCH_JOB_TYPES) {
      await runManualBatchSchedulerJob(jobType, patched);
    }

    expect(calls.length).toBe(REGISTERED_MANUAL_BATCH_JOB_TYPES.length);
  });
});
