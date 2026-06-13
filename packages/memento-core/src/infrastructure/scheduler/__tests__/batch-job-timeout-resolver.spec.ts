import { describe, expect, it } from 'vitest';
import type { BatchJobConfig } from '../batch-scheduler-types.js';
import {
  isJobTimeoutError,
  isTripleExtractionQueueJob,
  resolveBatchJobTimeout,
} from '../batch-job-timeout-resolver.js';

const baseConfig = {
  jobTimeout: 5 * 60 * 1000,
  tripleExtractionJobTimeout: 30 * 60 * 1000,
} as BatchJobConfig;

describe('batch-job-timeout-resolver', () => {
  it('detects per-memory triple extraction queue jobs', () => {
    expect(isTripleExtractionQueueJob('triple_extraction_mem_123')).toBe(true);
    expect(isTripleExtractionQueueJob('triple_extraction_batch')).toBe(true);
    expect(isTripleExtractionQueueJob('cleanup')).toBe(false);
  });

  it('uses tripleExtractionJobTimeout for triple_extraction_* jobs', () => {
    expect(resolveBatchJobTimeout('triple_extraction_mem_abc', baseConfig)).toBe(
      30 * 60 * 1000
    );
  });

  it('falls back to jobTimeout when tripleExtractionJobTimeout is unset', () => {
    const config = { ...baseConfig, tripleExtractionJobTimeout: undefined };
    expect(resolveBatchJobTimeout('triple_extraction_mem_abc', config)).toBe(5 * 60 * 1000);
  });

  it('uses jobTimeout for non-triple jobs', () => {
    expect(resolveBatchJobTimeout('quality_measurement_batch', baseConfig)).toBe(5 * 60 * 1000);
  });

  it('detects timeout errors', () => {
    expect(isJobTimeoutError(new Error('Job timeout after 300000ms'))).toBe(true);
    expect(isJobTimeoutError(new Error('network failure'))).toBe(false);
  });
});
