import { describe, expect, it } from 'vitest';
import { SEARCH_QUALITY_EXTRA_KEYS } from './extra-keys.js';
import { rejectionGateTelemetryExtra } from './build-reranked-extra.js';

const verdictKey = SEARCH_QUALITY_EXTRA_KEYS.rejection_gate_verdict;
const scoreKey = SEARCH_QUALITY_EXTRA_KEYS.rejection_gate_top_score;

describe('rejectionGateTelemetryExtra', () => {
  it('omits both keys when the gate did not run', () => {
    expect(rejectionGateTelemetryExtra(undefined)).toEqual({});
  });

  it('writes both keys when the gate returned a score', () => {
    expect(rejectionGateTelemetryExtra({ verdict: 'rejected', top_score: 0.05 })).toEqual({
      [verdictKey]: 'rejected',
      [scoreKey]: 0.05,
    });
  });

  it('keeps a null top score instead of substituting 0', () => {
    expect(rejectionGateTelemetryExtra({ verdict: 'fail_open', top_score: null })).toEqual({
      [verdictKey]: 'fail_open',
      [scoreKey]: null,
    });
    expect(rejectionGateTelemetryExtra({ verdict: 'off', top_score: null })).toEqual({
      [verdictKey]: 'off',
      [scoreKey]: null,
    });
  });
});
