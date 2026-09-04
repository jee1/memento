/**
 * #813 T012: triple extraction success metadata skip aggregates
 */

import { describe, expect, it } from 'vitest';
import { buildTripleExtractionSuccessMetadata } from './triple-extraction-metadata.js';

describe('buildTripleExtractionSuccessMetadata (#813 skips)', () => {
  const now = new Date('2024-06-01T00:00:00.000Z');

  it('omits skip keys when no aggregates provided', () => {
    const metadata = buildTripleExtractionSuccessMetadata(now, 2);
    expect(metadata).toEqual({
      triple_count: 2,
      extracted_at: '2024-06-01T00:00:00.000Z',
    });
  });

  it('records predicate_skip_count and reasons when skips > 0', () => {
    const metadata = buildTripleExtractionSuccessMetadata(now, 1, 0.9, {
      predicateSkipCount: 2,
      predicateSkipReasons: {
        predicate_canonicalize_failed: 1,
        predicate_empty: 1,
      },
    });
    expect(metadata.triple_count).toBe(1);
    expect(metadata.confidence_avg).toBe(0.9);
    expect(metadata.predicate_skip_count).toBe(2);
    expect(metadata.predicate_skip_reasons).toEqual({
      predicate_canonicalize_failed: 1,
      predicate_empty: 1,
    });
  });

  it('all-skip soft success: triple_count 0 with non-zero skips', () => {
    const metadata = buildTripleExtractionSuccessMetadata(now, 0, undefined, {
      predicateSkipCount: 3,
      predicateSkipReasons: {
        predicate_canonicalize_failed: 2,
        predicate_reassembly_failed: 1,
      },
    });
    expect(metadata.triple_count).toBe(0);
    expect(metadata.predicate_skip_count).toBe(3);
    expect(metadata.predicate_skip_reasons).toEqual({
      predicate_canonicalize_failed: 2,
      predicate_reassembly_failed: 1,
    });
    expect(metadata.failureReason).toBeUndefined();
  });

  it('does not add skip keys when predicateSkipCount is 0', () => {
    const metadata = buildTripleExtractionSuccessMetadata(now, 1, undefined, {
      predicateSkipCount: 0,
      predicateSkipReasons: {},
    });
    expect(metadata.predicate_skip_count).toBeUndefined();
    expect(metadata.predicate_skip_reasons).toBeUndefined();
  });
});
