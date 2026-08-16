import { describe, expect, it } from 'vitest';
import {
  fillUnderfilledVectorResults,
  filterByVectorThreshold,
} from './hybrid-search-outcome-utils.js';

const RAW = [
  { id: 'high', similarity: 0.9 },
  { id: 'edge', similarity: 0.38 },
  { id: 'mid', similarity: 0.2 },
  { id: 'low', similarity: 0.05 },
];

describe('vector threshold and under-fill (#789)', () => {
  it('keeps every candidate at threshold 0', () => {
    expect(filterByVectorThreshold(RAW, 0).map((item) => item.id)).toEqual([
      'high',
      'edge',
      'mid',
      'low',
    ]);
  });

  it('keeps 0.2 and above at threshold 0.2', () => {
    expect(filterByVectorThreshold(RAW, 0.2).map((item) => item.id)).toEqual([
      'high',
      'edge',
      'mid',
    ]);
  });

  it('keeps 0.38 and above at threshold 0.38', () => {
    expect(filterByVectorThreshold(RAW, 0.38).map((item) => item.id)).toEqual([
      'high',
      'edge',
    ]);
  });

  it('fills under-threshold raw hits until minCount when the thresholded pool is short', () => {
    const thresholded = filterByVectorThreshold(RAW, 0.38);
    const filled = fillUnderfilledVectorResults(thresholded, RAW, 4);

    expect(thresholded.map((item) => item.id)).toEqual(['high', 'edge']);
    expect(filled.map((item) => item.id)).toEqual(['high', 'edge', 'mid', 'low']);
  });

  it('does not add extra hits when the thresholded pool already meets minCount', () => {
    const thresholded = filterByVectorThreshold(RAW, 0.38);
    const filled = fillUnderfilledVectorResults(thresholded, RAW, 2);

    expect(filled.map((item) => item.id)).toEqual(['high', 'edge']);
  });
});
