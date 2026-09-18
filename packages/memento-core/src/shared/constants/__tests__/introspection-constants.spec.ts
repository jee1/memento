import { describe, expect, it } from 'vitest';
import {
  INTROSPECTION_HINT_SUFFIX,
  buildIntrospectionHint,
} from '../introspection-constants.js';

describe('buildIntrospectionHint', () => {
  it('T5: uses totals not capped ID-list length (#997 ceiling regression guard)', () => {
    // Scan cache keeps lowConfidenceMemoryIds: ['a'] (length 1) while totals reflect full counts.
    const cappedIdListLength = 1;

    const hint = buildIntrospectionHint({
      result: {
        summary: '저신뢰 2212건, 고실패 502건',
        lowConfidenceTotal: 2212,
        highFailureTotal: 502,
      },
      scanned_at: '2026-09-18T00:00:00.000Z',
    });

    expect(hint).toBeDefined();
    expect(hint!.low_confidence_count).toBe(2212);
    expect(hint!.low_confidence_count).not.toBe(cappedIdListLength);
    expect(hint!.high_failure_count).toBe(502);
  });

  it('T6: appends INTROSPECTION_HINT_SUFFIX to summary', () => {
    const hint = buildIntrospectionHint({
      result: {
        summary: '저신뢰 3건',
        lowConfidenceTotal: 3,
        highFailureTotal: 0,
      },
      scanned_at: '2026-09-18T00:00:00.000Z',
    });

    expect(hint).toBeDefined();
    expect(hint!.summary).toBe(`저신뢰 3건${INTROSPECTION_HINT_SUFFIX}`);
  });

  it('T7: returns undefined for null input', () => {
    expect(buildIntrospectionHint(null)).toBeUndefined();
  });

  it('T8: returns undefined when both totals are zero even if ID lists are non-empty', () => {
    // Totals gate the hint — non-empty lowConfidenceMemoryIds/highFailureMemoryIds do not matter.
    const hint = buildIntrospectionHint({
      result: {
        summary: '플래그 없음',
        lowConfidenceTotal: 0,
        highFailureTotal: 0,
      },
      scanned_at: '2026-09-18T00:00:00.000Z',
    });

    expect(hint).toBeUndefined();
  });
});
