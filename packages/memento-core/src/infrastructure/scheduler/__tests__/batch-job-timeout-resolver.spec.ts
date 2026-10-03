import { describe, expect, it } from 'vitest';
import type { BatchJobConfig } from '../batch-scheduler/batch-scheduler-types.js';
import {
  isJobTimeoutError,
  resolveBatchJobTimeout,
} from '../batch-scheduler/batch-job-timeout-resolver.js';

const baseConfig = {
  jobTimeout: 5 * 60 * 1000,
} as BatchJobConfig;

describe('batch-job-timeout-resolver', () => {
  it('uses jobTimeout for all jobs', () => {
    expect(resolveBatchJobTimeout('quality_measurement_batch', baseConfig)).toBe(5 * 60 * 1000);
    expect(resolveBatchJobTimeout('cleanup', baseConfig)).toBe(5 * 60 * 1000);
  });

  it('detects timeout errors', () => {
    expect(isJobTimeoutError(new Error('Job timeout after 300000ms'))).toBe(true);
    expect(isJobTimeoutError(new Error('network failure'))).toBe(false);
  });
});
