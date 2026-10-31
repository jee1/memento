import { describe, expect, it } from 'vitest';
import {
  jobRunSummaryFieldsFromBatchJobResult,
  jobRunSummaryFieldsFromOutcome,
  serializeJobRunDetailsJson,
} from '../batch-job-result-job-run-summary.js';
import type { BatchJobResult } from '../batch-scheduler-types.js';

describe('jobRunSummaryFieldsFromOutcome (#1559)', () => {
  it('maps BatchJobResult processed, error_count, and details_json', () => {
    const outcome: BatchJobResult = {
      jobType: 'sleep_consolidation_batch',
      startTime: new Date(),
      endTime: new Date(),
      duration: 10,
      success: true,
      processed: 4,
      errors: [],
      warnings: [],
      details: { clustersProcessed: 4, clustersSkipped: 1 },
    };

    expect(jobRunSummaryFieldsFromOutcome(true, outcome)).toEqual({
      processed: 4,
      error_count: 0,
      details_json: JSON.stringify({ clustersProcessed: 4, clustersSkipped: 1 }),
    });
  });

  it('keeps error_count when success=true and errors coexist (partial errors)', () => {
    const outcome: BatchJobResult = {
      jobType: 'quality_measurement_batch',
      startTime: new Date(),
      endTime: new Date(),
      duration: 1,
      success: true,
      processed: 2,
      errors: ['one cluster deferred'],
      warnings: [],
    };

    const fields = jobRunSummaryFieldsFromOutcome(true, outcome);
    expect(fields.processed).toBe(2);
    expect(fields.error_count).toBe(1);
  });

  it('records failure message when job threw (no BatchJobResult)', () => {
    const fields = jobRunSummaryFieldsFromOutcome(false, undefined, 'boom');
    expect(fields.error_count).toBe(1);
    expect(JSON.parse(fields.details_json!)).toEqual({ error: 'boom' });
  });

  it('treats void success as processed=0', () => {
    expect(jobRunSummaryFieldsFromOutcome(true, undefined)).toEqual({
      processed: 0,
      error_count: 0,
      details_json: null,
    });
  });

  it('caps unbounded arrays in details_json', () => {
    const huge = serializeJobRunDetailsJson(Array.from({ length: 200 }, (_, i) => i));
    expect(huge).not.toBeNull();
    const parsed = JSON.parse(huge!) as { items: number[]; truncatedCount: number };
    expect(parsed.items).toHaveLength(32);
    expect(parsed.truncatedCount).toBe(168);
  });
});

describe('jobRunSummaryFieldsFromBatchJobResult', () => {
  it('matches manual persistManualRun mapping', () => {
    const result: BatchJobResult = {
      jobType: 'cleanup',
      startTime: new Date(),
      endTime: new Date(),
      duration: 5,
      success: false,
      processed: 0,
      errors: ['a', 'b'],
      warnings: [],
      details: { note: 'x' },
    };
    expect(jobRunSummaryFieldsFromBatchJobResult(result)).toEqual({
      processed: 0,
      error_count: 2,
      details_json: JSON.stringify({ note: 'x' }),
    });
  });
});
