import { describe, expect, it } from 'vitest';
import {
  buildMemoryReviewCandidatesRunDiagnosticsPayload,
  MEMORY_REVIEW_CANDIDATES_RUN_EVENT_TYPE
} from '../memory-review-candidates-run-diagnostics.js';
import type { BatchJobResult } from '../batch-scheduler-types.js';

function baseResult(over: Partial<BatchJobResult> = {}): BatchJobResult {
  const start = new Date('2026-05-09T10:00:00.000Z');
  const end = new Date('2026-05-09T10:00:01.500Z');
  return {
    jobType: 'memory_review_candidates',
    startTime: start,
    endTime: end,
    duration: end.getTime() - start.getTime(),
    success: true,
    processed: 3,
    errors: [],
    warnings: [],
    ...over
  };
}

describe('buildMemoryReviewCandidatesRunDiagnosticsPayload', () => {
  it('성공 시 삽입·갱신·에러 카운트 키를 포함한다', () => {
    const payload = buildMemoryReviewCandidatesRunDiagnosticsPayload(
      baseResult({
        details: {
          inserted: 2,
          updated: 1,
          expired: 4,
          pendingBefore: 8,
          pendingAfter: 6,
          skippedForBacklog: false
        }
      })
    );

    expect(payload.type).toBe(MEMORY_REVIEW_CANDIDATES_RUN_EVENT_TYPE);
    expect(payload.schema_version).toBe(1);
    expect(payload.job_name).toBe('memory_review_candidates');
    expect(payload.result).toBe('success');
    expect(payload.inserted).toBe(2);
    expect(payload.updated).toBe(1);
    expect(payload.expired).toBe(4);
    expect(payload.pending_before).toBe(8);
    expect(payload.pending_after).toBe(6);
    expect(payload.skipped_for_backlog).toBe(false);
    expect(payload.error_count).toBe(0);
    expect(payload.selected_count).toBe(3);
    expect(payload.first_error).toBeNull();
    expect(payload.started_at).toBe('2026-05-09T10:00:00.000Z');
    expect(payload.finished_at).toBe('2026-05-09T10:00:01.500Z');
    expect(payload.duration_ms).toBe(1500);
  });

  it('실패 시에도 동일 키를 유지하고 first_error를 채운다', () => {
    const payload = buildMemoryReviewCandidatesRunDiagnosticsPayload(
      baseResult({
        success: false,
        errors: ['db closed'],
        details: undefined,
        processed: 0
      })
    );

    expect(payload.result).toBe('failure');
    expect(payload.inserted).toBe(0);
    expect(payload.updated).toBe(0);
    expect(payload.error_count).toBe(1);
    expect(payload.first_error).toBe('db closed');
  });
});
