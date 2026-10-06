import { describe, expect, it } from 'vitest';
import { REGISTERED_MANUAL_BATCH_JOB_TYPES } from '../batch-scheduler/batch-scheduler-job-runners.js';
import { mergeBatchSchedulerJobConfig } from '../batch-scheduler/batch-scheduler-default-config.js';

describe('weekly_relation_validation removal (#1265)', () => {
  it('excludes weekly_relation_validation from manual batch job types', () => {
    expect(REGISTERED_MANUAL_BATCH_JOB_TYPES).not.toContain('weekly_relation_validation');
  });

  it('default batch config has no relation validation keys', () => {
    const config = mergeBatchSchedulerJobConfig();
    expect(config).not.toHaveProperty('relationValidationInterval');
    expect(config).not.toHaveProperty('relationValidationDayOfWeek');
    expect(config).not.toHaveProperty('relationValidationHour');
    expect(config).not.toHaveProperty('weeklyRelationValidationTimeout');
  });
});
