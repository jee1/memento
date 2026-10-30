import { describe, expect, it } from 'vitest';
import { REGISTERED_MANUAL_BATCH_JOB_TYPES } from '../batch-scheduler-job-runners.js';
import {
  BATCH_SCHEDULER_JOB_DESCRIPTIONS,
  resolveBatchSchedulerJobDescription,
} from '../batch-scheduler-job-descriptions.js';

describe('batch-scheduler-job-descriptions (#1464)', () => {
  it('covers every registered manual schedule job name', () => {
    for (const name of REGISTERED_MANUAL_BATCH_JOB_TYPES) {
      expect(BATCH_SCHEDULER_JOB_DESCRIPTIONS[name], name).toBeTruthy();
    }
  });

  it('returns null for unknown job names', () => {
    expect(resolveBatchSchedulerJobDescription('not_a_real_job')).toBeNull();
    expect(resolveBatchSchedulerJobDescription('')).toBeNull();
  });
});
